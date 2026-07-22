use git2::{BranchType, DiffDelta, DiffOptions, Oid, Repository, Sort, Status, StatusOptions};
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    cell::RefCell,
    collections::HashSet,
    io::{self, Read, Write},
    net::TcpStream,
    path::Path,
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::State;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct AppState {
    repo: Option<Repository>,
    repo_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct CommitInfo {
    id: String,
    short_id: String,
    message: String,
    author_name: String,
    author_email: String,
    timestamp: i64,
    parent_ids: Vec<String>,
    is_unpushed: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct BranchInfo {
    name: String,
    is_head: bool,
    commit_id: String,
    is_remote: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct DiffFile {
    old_path: String,
    new_path: String,
    status: String,
    hunks: Vec<DiffHunk>,
}

#[derive(Serialize, Deserialize, Clone)]
struct DiffHunk {
    header: String,
    lines: Vec<DiffLine>,
}

#[derive(Serialize, Deserialize, Clone)]
struct DiffLine {
    content: String,
    line_type: String, // "add", "delete", "context"
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
struct FileTreeEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<FileTreeEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
struct RepoInfo {
    path: String,
    name: String,
    current_branch: String,
    github_owner: Option<String>,
    github_repo: Option<String>,
    branch_count: usize,
    commit_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
struct WorktreeFile {
    path: String,
    status: String,
    staged: bool,
    unstaged: bool,
    conflicted: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct SyncStatus {
    has_origin: bool,
    origin_url: Option<String>,
    current_branch: String,
    upstream: Option<String>,
    unpushed_count: usize,
    can_push: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct SystemInfo {
    os: String,
    distro: String,
    ram_gb: f32,
    gpu_name: String,
    vram_gb: f32,
    recommended_model: String,
    ollama_installed: bool,
    ollama_running: bool,
    installed_models: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct GitIdentity {
    name: String,
    email: String,
    is_current: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct GpgKey {
    key_id: String,
    uid: String,
    is_default: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct GitSettings {
    identities: Vec<GitIdentity>,
    gpg_keys: Vec<GpgKey>,
    current_name: String,
    current_email: String,
    current_signing_key: String,
    gpg_sign_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SmtpSettings {
    enabled: bool,
    host: String,
    port: u16,
    username: String,
    password: String,
    from_email: String,
    to_email: String,
    use_tls: bool,
}

impl Default for SmtpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            host: String::new(),
            port: 587,
            username: String::new(),
            password: String::new(),
            from_email: String::new(),
            to_email: String::new(),
            use_tls: true,
        }
    }
}

fn smtp_config_path() -> Result<std::path::PathBuf, String> {
    let config_dir = dirs::config_dir().ok_or("Could not determine config directory")?;
    let app_dir = config_dir.join("differ");
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Could not create config dir: {}", e))?;
    Ok(app_dir.join("smtp.json"))
}

fn load_smtp_settings() -> SmtpSettings {
    let path = match smtp_config_path() {
        Ok(p) => p,
        Err(_) => return SmtpSettings::default(),
    };
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return SmtpSettings::default(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn save_smtp_settings_to_file(settings: &SmtpSettings) -> Result<(), String> {
    let path = smtp_config_path()?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Could not write SMTP config: {}", e))
}

fn parse_github_remote(remote_url: &str) -> Option<(String, String)> {
    let url = remote_url.trim().trim_end_matches(".git");
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;

    let mut parts = path.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    Some((owner, repo))
}

fn current_branch_name(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
}

fn origin_url(repo: &Repository) -> Option<String> {
    // 1. Try git2 find_remote("origin")
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            return Some(url.to_string());
        }
    }

    // 2. Check git2 remotes() list
    if let Ok(remotes) = repo.remotes() {
        for name in remotes.iter().flatten() {
            if name == "origin" {
                if let Ok(remote) = repo.find_remote(name) {
                    if let Some(url) = remote.url() {
                        return Some(url.to_string());
                    }
                }
            }
        }
        for name in remotes.iter().flatten() {
            if let Ok(remote) = repo.find_remote(name) {
                if let Some(url) = remote.url() {
                    return Some(url.to_string());
                }
            }
        }
    }

    // 3. Fallback to CLI git remote get-url origin
    if let Ok(url) = run_git(repo, &["remote", "get-url", "origin"]) {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Ok(remotes_str) = run_git(repo, &["remote"]) {
        if let Some(first_remote) = remotes_str.lines().next() {
            let first_remote = first_remote.trim();
            if !first_remote.is_empty() {
                if let Ok(url) = run_git(repo, &["remote", "get-url", first_remote]) {
                    let trimmed = url.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

fn unpushed_oids(repo: &Repository) -> HashSet<Oid> {
    let Some(branch_name) = current_branch_name(repo) else {
        return HashSet::new();
    };
    let Ok(branch) = repo.find_branch(&branch_name, BranchType::Local) else {
        return HashSet::new();
    };
    let Some(head_oid) = branch.get().target() else {
        return HashSet::new();
    };
    let Some(upstream_oid) = branch
        .upstream()
        .ok()
        .and_then(|upstream| upstream.get().target())
    else {
        return HashSet::new();
    };
    let Ok(mut revwalk) = repo.revwalk() else {
        return HashSet::new();
    };

    let _ = revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL);
    if revwalk.push(head_oid).is_err() || revwalk.hide(upstream_oid).is_err() {
        return HashSet::new();
    }

    revwalk.filter_map(Result::ok).collect()
}

fn repo_workdir(repo: &Repository) -> Result<&Path, String> {
    repo.workdir().ok_or_else(|| {
        "Working tree operations are not available for bare repositories".to_string()
    })
}

fn normalize_git_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn git_not_found_message() -> String {
    #[cfg(target_os = "windows")]
    {
        "git.exe was not found. Install Git for Windows and make sure it is available in PATH."
            .to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        "git was not found. Install Git and make sure it is available in PATH.".to_string()
    }
}

fn git_command() -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("git");
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("git")
    }
}

fn run_git(repo: &Repository, args: &[&str]) -> Result<String, String> {
    let output = git_command()
        .arg("-C")
        .arg(repo_workdir(repo)?)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .output()
        .map_err(|e| {
            if e.kind() == io::ErrorKind::NotFound {
                git_not_found_message()
            } else {
                format!("git could not be executed: {}", e)
            }
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn status_name(status: Status) -> &'static str {
    if status.contains(Status::CONFLICTED) {
        "conflicted"
    } else if status.contains(Status::WT_NEW) || status.contains(Status::INDEX_NEW) {
        "added"
    } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
        "deleted"
    } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
        "renamed"
    } else if status.contains(Status::WT_TYPECHANGE) || status.contains(Status::INDEX_TYPECHANGE) {
        "typechange"
    } else {
        "modified"
    }
}

fn status_has_staged(status: Status) -> bool {
    status.intersects(
        Status::INDEX_NEW
            | Status::INDEX_MODIFIED
            | Status::INDEX_DELETED
            | Status::INDEX_RENAMED
            | Status::INDEX_TYPECHANGE,
    )
}

fn status_has_unstaged(status: Status) -> bool {
    status.intersects(
        Status::WT_NEW
            | Status::WT_MODIFIED
            | Status::WT_DELETED
            | Status::WT_RENAMED
            | Status::WT_TYPECHANGE,
    )
}

fn delta_path(delta: DiffDelta<'_>) -> Option<String> {
    delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(normalize_git_path)
}

#[tauri::command]
fn open_repo(path: String, state: State<'_, Mutex<AppState>>) -> Result<RepoInfo, String> {
    let repo = Repository::discover(&path)
        .map_err(|e| format!("Repository could not be opened: {}", e))?;

    let branch_count = repo.branches(None).map_err(|e| e.to_string())?.count();

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().ok();
    let commit_count = revwalk.count();

    let current_branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
        .unwrap_or_else(|| "detached".to_string());

    let workdir = repo
        .workdir()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from(&path));

    let name = workdir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let (github_owner, github_repo) = origin_url(&repo)
        .and_then(|u| parse_github_remote(&u))
        .map(|(owner, repo)| (Some(owner), Some(repo)))
        .unwrap_or((None, None));

    let info = RepoInfo {
        path: workdir.to_string_lossy().to_string(),
        name,
        current_branch,
        github_owner,
        github_repo,
        branch_count,
        commit_count,
    };

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.repo = Some(repo);
    app_state.repo_path = Some(path);

    Ok(info)
}

#[tauri::command]
fn get_commits(
    limit: Option<usize>,
    branch: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<CommitInfo>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(Sort::TIME | Sort::TOPOLOGICAL)
        .map_err(|e| e.to_string())?;

    if let Some(branch_name) = &branch {
        // Try local branch first, then remote
        let reference = repo
            .find_branch(branch_name, BranchType::Local)
            .or_else(|_| repo.find_branch(branch_name, BranchType::Remote))
            .map_err(|e| format!("Branch not found: {}", e))?;
        let oid = reference
            .get()
            .target()
            .ok_or("Branch target was not found")?;
        revwalk.push(oid).map_err(|e| e.to_string())?;
    } else {
        // Push all refs to show everything
        revwalk.push_head().ok();
        let _ = repo.references().map(|refs| {
            for reference in refs.flatten() {
                if let Some(oid) = reference.target() {
                    let _ = revwalk.push(oid);
                }
            }
        });
    }

    let max = limit.unwrap_or(500);
    let unpushed = unpushed_oids(repo);
    let mut commits = Vec::new();

    for (i, oid) in revwalk.enumerate() {
        if i >= max {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

        let short_id = &commit.id().to_string()[..7];

        commits.push(CommitInfo {
            id: commit.id().to_string(),
            short_id: short_id.to_string(),
            message: commit.message().unwrap_or("").trim().to_string(),
            author_name: commit.author().name().unwrap_or("Unknown").to_string(),
            author_email: commit.author().email().unwrap_or("").to_string(),
            timestamp: commit.time().seconds(),
            parent_ids: commit.parent_ids().map(|id| id.to_string()).collect(),
            is_unpushed: unpushed.contains(&commit.id()),
        });
    }

    Ok(commits)
}

#[tauri::command]
fn get_branches(state: State<'_, Mutex<AppState>>) -> Result<Vec<BranchInfo>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let mut branches = Vec::new();
    let mut seen_names = HashSet::new();

    if let Ok(branch_iter) = repo.branches(None) {
        for branch_result in branch_iter {
            if let Ok((branch, branch_type)) = branch_result {
                if let Ok(Some(name)) = branch.name() {
                    let name_str = name.to_string();
                    let is_head = branch.is_head();
                    let commit_id = branch
                        .get()
                        .target()
                        .map(|oid| oid.to_string())
                        .unwrap_or_default();

                    seen_names.insert(name_str.clone());
                    branches.push(BranchInfo {
                        name: name_str,
                        is_head,
                        commit_id,
                        is_remote: branch_type == BranchType::Remote,
                    });
                }
            }
        }
    }

    if let Ok(cli_branches) = run_git(repo, &["branch", "-a"]) {
        for line in cli_branches.lines() {
            let trimmed = line.trim().trim_start_matches('*').trim();
            if trimmed.is_empty() || trimmed.contains("->") {
                continue;
            }
            if trimmed.starts_with("remotes/") {
                let remote_name = trimmed.trim_start_matches("remotes/");
                if !seen_names.contains(remote_name) {
                    seen_names.insert(remote_name.to_string());
                    branches.push(BranchInfo {
                        name: remote_name.to_string(),
                        is_head: false,
                        commit_id: String::new(),
                        is_remote: true,
                    });
                }
            } else if !seen_names.contains(trimmed) {
                seen_names.insert(trimmed.to_string());
                branches.push(BranchInfo {
                    name: trimmed.to_string(),
                    is_head: false,
                    commit_id: String::new(),
                    is_remote: false,
                });
            }
        }
    }

    branches.sort_by(|a, b| {
        b.is_head
            .cmp(&a.is_head)
            .then(a.is_remote.cmp(&b.is_remote))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(branches)
}

#[tauri::command]
fn get_commit_diff(
    commit_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<DiffFile>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let oid = Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let parent_tree = if commit.parent_count() > 0 {
        Some(
            commit
                .parent(0)
                .map_err(|e| e.to_string())?
                .tree()
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    opts.context_lines(3);

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| e.to_string())?;

    let files: RefCell<Vec<DiffFile>> = RefCell::new(Vec::new());

    diff.foreach(
        &mut |delta, _| {
            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "renamed",
                git2::Delta::Copied => "copied",
                _ => "unknown",
            };

            files.borrow_mut().push(DiffFile {
                old_path: delta
                    .old_file()
                    .path()
                    .map(normalize_git_path)
                    .unwrap_or_default(),
                new_path: delta
                    .new_file()
                    .path()
                    .map(normalize_git_path)
                    .unwrap_or_default(),
                status: status.to_string(),
                hunks: Vec::new(),
            });
            true
        },
        None,
        Some(&mut |_delta, hunk| {
            if let Some(file) = files.borrow_mut().last_mut() {
                file.hunks.push(DiffHunk {
                    header: String::from_utf8_lossy(hunk.header()).trim().to_string(),
                    lines: Vec::new(),
                });
            }
            true
        }),
        Some(&mut |_delta, _hunk, line| {
            if let Some(file) = files.borrow_mut().last_mut() {
                if let Some(hunk) = file.hunks.last_mut() {
                    let line_type = match line.origin() {
                        '+' => "add",
                        '-' => "delete",
                        _ => "context",
                    };
                    hunk.lines.push(DiffLine {
                        content: String::from_utf8_lossy(line.content()).to_string(),
                        line_type: line_type.to_string(),
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
            }
            true
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(files.into_inner())
}

#[tauri::command]
fn get_file_tree(
    commit_id: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<FileTreeEntry>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let tree = if let Some(cid) = commit_id {
        let oid = Oid::from_str(&cid).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        commit.tree().map_err(|e| e.to_string())?
    } else {
        let head = repo.head().map_err(|e| e.to_string())?;
        let commit = head.peel_to_commit().map_err(|e| e.to_string())?;
        commit.tree().map_err(|e| e.to_string())?
    };

    fn build_tree(repo: &Repository, tree: &git2::Tree, prefix: &str) -> Vec<FileTreeEntry> {
        let mut entries = Vec::new();
        for entry in tree.iter() {
            let name = entry.name().unwrap_or("unknown").to_string();
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", prefix, name)
            };
            let is_dir = entry.kind() == Some(git2::ObjectType::Tree);
            let children = if is_dir {
                if let Ok(subtree) = repo.find_tree(entry.id()) {
                    build_tree(repo, &subtree, &path)
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            };
            entries.push(FileTreeEntry {
                name: name.clone(),
                path,
                is_dir,
                children,
            });
        }
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        entries
    }

    Ok(build_tree(repo, &tree, ""))
}

#[tauri::command]
fn get_file_content(
    commit_id: String,
    file_path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let oid = Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let entry = tree
        .get_path(std::path::Path::new(&file_path))
        .map_err(|e| format!("File not found: {}", e))?;

    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| format!("Blob could not be read: {}", e))?;

    if blob.is_binary() {
        Ok("[Binary file]".to_string())
    } else {
        Ok(String::from_utf8_lossy(blob.content()).to_string())
    }
}

#[tauri::command]
fn get_worktree_status(state: State<'_, Mutex<AppState>>) -> Result<Vec<WorktreeFile>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Status could not be read: {}", e))?;

    let mut files = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        if status.is_ignored() || status.is_empty() {
            continue;
        }

        let path = entry
            .index_to_workdir()
            .and_then(delta_path)
            .or_else(|| entry.head_to_index().and_then(delta_path));

        let Some(path) = path else {
            continue;
        };

        files.push(WorktreeFile {
            path,
            status: status_name(status).to_string(),
            staged: status_has_staged(status),
            unstaged: status_has_unstaged(status),
            conflicted: status.contains(Status::CONFLICTED),
        });
    }

    files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(files)
}

#[tauri::command]
fn commit_changes(
    paths: Vec<String>,
    message: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    commit_changes_with_options(paths, message, None, None, None, None, None, state)
}

#[tauri::command]
fn commit_changes_with_options(
    paths: Vec<String>,
    message: String,
    author_name: Option<String>,
    author_email: Option<String>,
    gpg_key: Option<String>,
    sign_commit: Option<bool>,
    signed_off_by: Option<bool>,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let mut message = message.trim().to_string();

    if paths.is_empty() {
        return Err("Select at least one file to commit".to_string());
    }
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    if signed_off_by == Some(true) {
        let sign_name;
        let sign_email;
        if let (Some(name), Some(email)) = (&author_name, &author_email) {
            sign_name = name.trim().to_string();
            sign_email = email.trim().to_string();
        } else if let Ok(cfg) = repo.config() {
            sign_name = cfg.get_string("user.name").unwrap_or_default();
            sign_email = cfg.get_string("user.email").unwrap_or_default();
        } else {
            sign_name = String::new();
            sign_email = String::new();
        }
        if !sign_name.is_empty() && !sign_email.is_empty() {
            message.push_str(&format!(
                "\n\nSigned-off-by: {} <{}>",
                sign_name, sign_email
            ));
        }
    }

    let mut add_args = vec!["add", "--"];
    add_args.extend(paths.iter().map(String::as_str));
    run_git(repo, &add_args)?;

    let mut commit_args = vec!["commit", "--only", "-m", &message];

    let author_str;
    if let (Some(name), Some(email)) = (author_name, author_email) {
        let n = name.trim();
        let e = email.trim();
        if !n.is_empty() && !e.is_empty() {
            author_str = format!("{} <{}>", n, e);
            commit_args.push("--author");
            commit_args.push(&author_str);
        }
    }

    let key_arg;
    if let Some(key) = &gpg_key {
        let key_trimmed = key.trim();
        if key_trimmed == "none" {
            commit_args.push("--no-gpg-sign");
        } else if key_trimmed == "default" {
            commit_args.push("-S");
        } else if !key_trimmed.is_empty() {
            key_arg = format!("-S{}", key_trimmed);
            commit_args.push(&key_arg);
        }
    } else if sign_commit == Some(true) {
        commit_args.push("-S");
    }

    commit_args.push("--");
    commit_args.extend(paths.iter().map(String::as_str));
    run_git(repo, &commit_args)
}

#[tauri::command]
fn get_sync_status(state: State<'_, Mutex<AppState>>) -> Result<SyncStatus, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let current_branch = current_branch_name(repo).unwrap_or_else(|| "detached".to_string());
    let origin_url = origin_url(repo);
    let has_origin = origin_url.is_some();

    let (upstream, unpushed_count) =
        if let Ok(branch) = repo.find_branch(&current_branch, BranchType::Local) {
            if let Ok(upstream_branch) = branch.upstream() {
                let upstream_name = upstream_branch.name().ok().flatten().map(str::to_string);
                let count = match (branch.get().target(), upstream_branch.get().target()) {
                    (Some(head), Some(upstream_oid)) => repo
                        .graph_ahead_behind(head, upstream_oid)
                        .map(|(ahead, _)| ahead)
                        .unwrap_or(0),
                    _ => 0,
                };
                (upstream_name, count)
            } else {
                (None, 0)
            }
        } else {
            (None, 0)
        };

    Ok(SyncStatus {
        has_origin,
        origin_url,
        current_branch: current_branch.clone(),
        upstream,
        unpushed_count,
        can_push: has_origin && current_branch != "detached",
    })
}

#[tauri::command]
fn push_origin(state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    if origin_url(repo).is_none() {
        return Err("No origin remote is configured".to_string());
    }

    let branch_name = current_branch_name(repo).ok_or("Active branch was not found")?;
    if branch_name == "detached" {
        return Err("Detached HEAD cannot be pushed".to_string());
    }

    let has_upstream = repo
        .find_branch(&branch_name, BranchType::Local)
        .ok()
        .and_then(|branch| branch.upstream().ok())
        .is_some();

    if has_upstream {
        run_git(repo, &["push"])
    } else {
        run_git(repo, &["push", "-u", "origin", &branch_name])
    }
}

#[tauri::command]
fn add_origin(state: State<'_, Mutex<AppState>>, url: String) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let url_trimmed = url.trim();
    if url_trimmed.is_empty() {
        return Err("Remote URL cannot be empty".to_string());
    }

    run_git(repo, &["remote", "add", "origin", url_trimmed])
}

#[tauri::command]
fn merge_branches(
    state: State<'_, Mutex<AppState>>,
    source: String,
    target: String,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    run_git(repo, &["checkout", &target])?;
    run_git(repo, &["merge", &source])
}

fn detect_os_and_distro() -> (String, String) {
    let os = std::env::consts::OS.to_string();
    let mut distro = String::new();

    if os == "linux" {
        if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
            for line in content.lines() {
                if line.starts_with("PRETTY_NAME=") {
                    distro = line
                        .trim_start_matches("PRETTY_NAME=")
                        .trim_matches('"')
                        .to_string();
                    break;
                } else if line.starts_with("NAME=") && distro.is_empty() {
                    distro = line
                        .trim_start_matches("NAME=")
                        .trim_matches('"')
                        .to_string();
                }
            }
        }
        if distro.is_empty() {
            distro = "Linux Generic".to_string();
        }
    } else if os == "macos" {
        if let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            distro = format!("macOS {}", ver);
        } else {
            distro = "macOS".to_string();
        }
    } else if os == "windows" {
        distro = "Windows".to_string();
    } else {
        distro = os.clone();
    }

    (os, distro)
}

fn detect_ram_gb() -> f32 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
            for line in content.lines() {
                if line.starts_with("MemTotal:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<f32>() {
                            return (kb / 1024.0 / 1024.0 * 10.0).round() / 10.0;
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("sysctl").arg("-n").arg("hw.memsize").output() {
            let bytes_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Ok(bytes) = bytes_str.parse::<f32>() {
                return (bytes / 1024.0 / 1024.0 / 1024.0 * 10.0).round() / 10.0;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("wmic");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd
            .args(&["ComputerSystem", "get", "TotalPhysicalMemory"])
            .output()
        {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Ok(bytes) = line.trim().parse::<f32>() {
                    return (bytes / 1024.0 / 1024.0 / 1024.0 * 10.0).round() / 10.0;
                }
            }
        }
    }

    8.0
}

fn detect_gpu_and_vram() -> (String, f32) {
    let mut cmd = Command::new("nvidia-smi");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd
        .args(&[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(line) = out_str.lines().next() {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let name = parts[0].trim().to_string();
                    let vram_mb: f32 = parts[1].trim().parse().unwrap_or(0.0);
                    return (name, (vram_mb / 1024.0 * 10.0).round() / 10.0);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("lspci").output() {
            let out = String::from_utf8_lossy(&output.stdout);
            for line in out.lines() {
                if line.contains("VGA compatible controller")
                    || line.contains("3D controller")
                    || line.contains("Display controller")
                {
                    let parts: Vec<&str> = line.split(':').collect();
                    let name = parts.last().unwrap_or(&line).trim().to_string();
                    return (name, 4.0);
                }
            }
        }
    }

    ("Standard Graphics".to_string(), 2.0)
}

struct HttpResponse {
    status_code: u16,
    body: String,
}

fn is_success_status(status_code: u16) -> bool {
    (200..300).contains(&status_code)
}

fn short_response_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        "empty response".to_string()
    } else {
        trimmed.chars().take(300).collect::<String>()
    }
}

fn build_http_request(
    method: &str,
    path: &str,
    host_header: &str,
    headers: &[(String, String)],
    body: Option<&str>,
) -> Vec<u8> {
    let body_len = body.map(|b| b.as_bytes().len()).unwrap_or(0);
    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: differ/{}\r\nAccept: application/json\r\nConnection: close\r\n",
        method,
        path,
        host_header,
        env!("CARGO_PKG_VERSION")
    );

    for (name, value) in headers {
        let safe_name = name.replace(['\r', '\n'], "");
        let safe_value = value.replace(['\r', '\n'], "");
        request.push_str(&safe_name);
        request.push_str(": ");
        request.push_str(&safe_value);
        request.push_str("\r\n");
    }

    if body.is_some() {
        request.push_str(&format!("Content-Length: {}\r\n", body_len));
    }

    request.push_str("\r\n");
    let mut bytes = request.into_bytes();
    if let Some(body) = body {
        bytes.extend_from_slice(body.as_bytes());
    }
    bytes
}

fn find_crlf(bytes: &[u8], start: usize) -> Option<usize> {
    bytes
        .get(start..)?
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|pos| start + pos)
}

fn decode_chunked_body(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut pos = 0;
    let mut decoded = Vec::new();

    loop {
        let line_end = find_crlf(bytes, pos).ok_or("Invalid chunked response")?;
        let size_line = std::str::from_utf8(&bytes[pos..line_end])
            .map_err(|e| format!("Invalid chunk size: {}", e))?;
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|e| format!("Invalid chunk size: {}", e))?;
        pos = line_end + 2;

        if size == 0 {
            break;
        }

        if pos + size > bytes.len() {
            return Err("Chunked response ended early".to_string());
        }

        decoded.extend_from_slice(&bytes[pos..pos + size]);
        pos += size;

        if bytes.get(pos..pos + 2) == Some(b"\r\n") {
            pos += 2;
        } else {
            return Err("Invalid chunk terminator".to_string());
        }
    }

    Ok(decoded)
}

fn parse_http_response(raw: &[u8]) -> Result<HttpResponse, String> {
    let header_end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("Invalid HTTP response: missing headers")?;
    let header_bytes = &raw[..header_end];
    let body_bytes = &raw[header_end + 4..];
    let headers_text = std::str::from_utf8(header_bytes)
        .map_err(|e| format!("Invalid HTTP response headers: {}", e))?;

    let mut lines = headers_text.lines();
    let status_line = lines
        .next()
        .ok_or("Invalid HTTP response: missing status line")?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .ok_or("Invalid HTTP response: missing status code")?
        .parse::<u16>()
        .map_err(|e| format!("Invalid HTTP status code: {}", e))?;

    let mut chunked = false;
    let mut content_length = None;

    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            } else if name == "content-length" {
                content_length = value.parse::<usize>().ok();
            }
        }
    }

    let body = if chunked {
        decode_chunked_body(body_bytes)?
    } else if let Some(length) = content_length {
        body_bytes[..body_bytes.len().min(length)].to_vec()
    } else {
        body_bytes.to_vec()
    };

    let body = String::from_utf8(body).map_err(|e| format!("Invalid UTF-8 response: {}", e))?;
    Ok(HttpResponse { status_code, body })
}

fn send_plain_http_request(
    addr: &str,
    host_header: &str,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    let mut stream =
        TcpStream::connect(addr).map_err(|e| format!("Connection to {} failed: {}", addr, e))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("Could not set read timeout: {}", e))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("Could not set write timeout: {}", e))?;

    let request = build_http_request(method, path, host_header, headers, body);
    stream
        .write_all(&request)
        .map_err(|e| format!("HTTP write failed: {}", e))?;
    stream
        .flush()
        .map_err(|e| format!("HTTP flush failed: {}", e))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("HTTP read failed: {}", e))?;
    parse_http_response(&raw)
}

fn send_https_request(
    host: &str,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    let tcp = TcpStream::connect((host, 443))
        .map_err(|e| format!("Connection to {} failed: {}", host, e))?;
    tcp.set_read_timeout(Some(timeout))
        .map_err(|e| format!("Could not set read timeout: {}", e))?;
    tcp.set_write_timeout(Some(timeout))
        .map_err(|e| format!("Could not set write timeout: {}", e))?;

    let connector =
        native_tls::TlsConnector::new().map_err(|e| format!("Could not initialize TLS: {}", e))?;
    let mut stream = connector
        .connect(host, tcp)
        .map_err(|e| format!("TLS connection to {} failed: {}", host, e))?;

    let request = build_http_request(method, path, host, headers, body);
    stream
        .write_all(&request)
        .map_err(|e| format!("HTTPS write failed: {}", e))?;
    stream
        .flush()
        .map_err(|e| format!("HTTPS flush failed: {}", e))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("HTTPS read failed: {}", e))?;
    parse_http_response(&raw)
}

fn google_api_key_header(api_key: &str) -> Result<(String, String), String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key is empty".to_string());
    }
    Ok(("x-goog-api-key".to_string(), key.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_content_length_response() {
        let response =
            parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"ok\":true}xxxx")
                .expect("response should parse");

        assert_eq!(response.status_code, 200);
        assert_eq!(response.body, "{\"ok\":true}xxxx");
    }

    #[test]
    fn parses_chunked_response() {
        let response = parse_http_response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{\"ok\":\r\n5\r\ntrue}\r\n0\r\n\r\n",
        )
        .expect("response should parse");

        assert_eq!(response.status_code, 200);
        assert_eq!(response.body, "{\"ok\":true}");
    }
}

fn check_ollama_cli_and_daemon() -> (bool, bool, Vec<String>) {
    let mut installed = false;
    let mut running = false;
    let mut models = Vec::new();

    let mut cmd = Command::new("ollama");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.arg("--version").output() {
        if output.status.success() {
            installed = true;
        }
    }

    if let Ok(response) = send_plain_http_request(
        "127.0.0.1:11434",
        "127.0.0.1:11434",
        "GET",
        "/api/tags",
        &[],
        None,
        Duration::from_secs(2),
    ) {
        if is_success_status(response.status_code) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                running = true;
                installed = true;
                if let Some(model_list) = json.get("models").and_then(|m| m.as_array()) {
                    for m in model_list {
                        if let Some(name) = m.get("name").and_then(|n| n.as_str()) {
                            models.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    (installed, running, models)
}

#[tauri::command]
fn get_system_info() -> Result<SystemInfo, String> {
    let (os, distro) = detect_os_and_distro();
    let ram_gb = detect_ram_gb();
    let (gpu_name, vram_gb) = detect_gpu_and_vram();
    let (ollama_installed, ollama_running, installed_models) = check_ollama_cli_and_daemon();

    // Default top recommendation requested by user: gemma4:12b
    let recommended_model = if ram_gb >= 12.0 || vram_gb >= 8.0 {
        "gemma4:12b".to_string()
    } else if ram_gb >= 8.0 || vram_gb >= 4.0 {
        "gemma2:9b".to_string()
    } else {
        "gemma:2b".to_string()
    };

    Ok(SystemInfo {
        os,
        distro,
        ram_gb,
        gpu_name,
        vram_gb,
        recommended_model,
        ollama_installed,
        ollama_running,
        installed_models,
    })
}

#[tauri::command]
fn check_ollama_status() -> Result<SystemInfo, String> {
    get_system_info()
}

#[tauri::command]
fn install_ollama() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://ollama.com/install.sh | sh")
            .output()
            .map_err(|e| format!("Failed to run install script: {}", e))?;

        if output.status.success() {
            Ok("Ollama installed successfully.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(if !stderr.is_empty() { stderr } else { stdout })
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("powershell");
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd
            .args(&[
                "-Command",
                "winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements",
            ])
            .output()
            .map_err(|e| format!("Failed to execute winget: {}", e))?;

        if output.status.success() {
            Ok("Ollama installed successfully via winget.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(stderr)
        }
    }
}

#[tauri::command]
fn pull_ollama_model(model_name: String) -> Result<String, String> {
    let model = model_name.trim();
    if model.is_empty() {
        return Err("Model name cannot be empty".to_string());
    }

    let mut cmd = Command::new("ollama");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .args(&["pull", model])
        .output()
        .map_err(|e| format!("Failed to execute ollama pull: {}", e))?;

    if output.status.success() {
        Ok(format!("Model {} pulled successfully.", model))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

#[tauri::command]
async fn generate_ai_commit_message(
    diff: Option<String>,
    paths: Option<Vec<String>>,
    model: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut actual_diff = diff.unwrap_or_default();

    if actual_diff.trim().is_empty() {
        let diff_result = {
            let app_state = state.lock().map_err(|e| e.to_string())?;
            if let Some(repo) = app_state.repo.as_ref() {
                let mut diff_builder = String::new();
                if let Some(p_vec) = &paths {
                    if !p_vec.is_empty() {
                        for path in p_vec {
                            let d_head =
                                run_git(repo, &["diff", "HEAD", "--", path]).unwrap_or_default();
                            if !d_head.trim().is_empty() {
                                diff_builder.push_str(&d_head);
                                diff_builder.push('\n');
                            } else {
                                let d_staged = run_git(repo, &["diff", "--cached", "--", path])
                                    .unwrap_or_default();
                                if !d_staged.trim().is_empty() {
                                    diff_builder.push_str(&d_staged);
                                    diff_builder.push('\n');
                                } else {
                                    if let Some(workdir) = repo.workdir() {
                                        let full_path = workdir.join(path);
                                        if full_path.exists() && full_path.is_file() {
                                            if let Ok(content) = std::fs::read_to_string(&full_path)
                                            {
                                                let snippet: String = content
                                                    .lines()
                                                    .take(40)
                                                    .collect::<Vec<_>>()
                                                    .join("\n");
                                                diff_builder.push_str(&format!(
                                                    "+++ Added untracked file {}\n{}\n",
                                                    path, snippet
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                    }
                } else {
                    diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                }
                Some(diff_builder)
            } else {
                None
            }
        }; // Mutex dropped here!
        if let Some(d) = diff_result {
            actual_diff = d;
        }
    }

    if actual_diff.trim().is_empty() {
        return Err("No diff or changed files found for selected items.".to_string());
    }

    if actual_diff.len() > 6000 {
        actual_diff.truncate(6000);
        actual_diff.push_str("\n...[diff truncated for length]");
    }

    let raw_model = model.unwrap_or_else(|| "gemma4:12b".to_string());
    let model_name = raw_model
        .split_whitespace()
        .next()
        .unwrap_or("gemma4:12b")
        .to_string();

    let prompt = format!(
        "You are a commit message generator. Output ONLY the commit message line. Nothing else.

Rules:
- Output exactly ONE line in format: type(scope): description
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Scope is optional, use only if the change clearly belongs to a specific module
- Description must be imperative mood, lowercase first letter, no period at end
- Max 72 characters total
- Do NOT include any explanation, reasoning, markdown, backticks, quotes, or multiple options
- Do NOT start with Here is, This commit, Based on, The diff, Option, Let me, I will
- Do NOT include any text before or after the commit line
- If unsure about scope, omit it: feat: add user authentication

Diff:
{}",
        actual_diff
    );

    let payload = serde_json::json!({
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": "You are a commit message generator. Output ONLY the commit message line. No explanations, no reasoning, no markdown, no backticks."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "stream": false,
        "options": {
            "num_ctx": 4096,
            "temperature": 0.2,
            "top_p": 0.9,
            "repeat_penalty": 1.3
        }
    });

    let payload_str = payload.to_string();

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_plain_http_request(
            "127.0.0.1:11434",
            "127.0.0.1:11434",
            "POST",
            "/api/chat",
            &[("Content-Type".to_string(), "application/json".to_string())],
            Some(&payload_str),
            Duration::from_secs(90),
        )
        .map_err(|e| format!("Ollama request execution error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let resp_str = response.body;

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&resp_str) {
        if let Some(err_msg) = json.get("error").and_then(|e| e.as_str()) {
            return Err(format!("Ollama Model Error: {}", err_msg));
        }

        let mut combined = String::new();

        // 1. First priority: assistant message.content
        if let Some(msg_obj) = json.get("message") {
            if let Some(c) = msg_obj.get("content").and_then(|c| c.as_str()) {
                if !c.trim().is_empty() {
                    combined.push_str(c);
                    combined.push('\n');
                }
            }
        }

        // 2. Second priority: top-level response field
        if combined.trim().is_empty() {
            if let Some(r) = json.get("response").and_then(|r| r.as_str()) {
                if !r.trim().is_empty() {
                    combined.push_str(r);
                    combined.push('\n');
                }
            }
        }

        // 3. Fallback: message.thinking field (only if content is completely empty)
        if combined.trim().is_empty() {
            if let Some(msg_obj) = json.get("message") {
                if let Some(th) = msg_obj.get("thinking").and_then(|t| t.as_str()) {
                    combined.push_str(th);
                    combined.push('\n');
                }
            }
        }

        let types = [
            "feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore",
        ];
        let raw_lines: Vec<&str> = combined.lines().collect();

        // Comprehensive blacklist of conversational/meta phrases produced by reasoning models
        let is_meta = |s: &str| -> bool {
            let l = s.to_lowercase().trim().to_string();
            if l.is_empty() || l.len() < 8 {
                return true;
            }
            // Lines that are clearly not commit messages
            l.contains("specifically")
                || l.contains("they involve")
                || l.contains("this diff")
                || l.contains("in summary")
                || l.contains("input:")
                || l.contains("file:")
                || l.contains("option ")
                || l.contains("let's look")
                || l.contains("lets look")
                || l.contains("look at the content")
                || l.contains("here is a commit")
                || l.contains("it adds new")
                || l.contains("this commit")
                || l.contains("based on")
                || l.contains("the change")
                || l.contains("the code")
                || l.contains("the diff shows")
                || l.contains("i will")
                || l.contains("we need")
                || l.contains("we should")
                || l.contains("we can")
                || l.contains("the file")
                || l.contains("a new ")
                || l.contains("added ")
                || l.contains("removes ")
                || l.contains("updates ")
                || l.contains("modifies ")
                || l.contains("introduces ")
                || l.contains("implements ")
                || l.contains("creates ")
                || l.contains("refactors ")
                || l.contains("improves ")
                || l.contains("enhances ")
                || l.contains("changes ")
                || l.contains("removes ")
                || l.contains("deletes ")
                || l.contains("fixes ")
                || l.contains("resolves ")
                || l.contains("adds a ")
                || l.contains("adds the ")
                || l.contains("adds support")
                || l.contains("adds new ")
                || l.contains("adds a new")
                || l.contains("removes the ")
                || l.contains("updates the ")
                || l.contains("modifies the ")
                || l.contains("introduces a ")
                || l.contains("implements a ")
                || l.contains("creates a ")
                || l.contains("refactors the ")
                || l.contains("improves the ")
                || l.contains("enhances the ")
                || l.contains("the changes")
                || l.contains("this change")
                || l.contains("this file")
                || l.contains("this code")
                || l.contains("this pr")
                || l.contains("this pull")
                || l.contains("the commit")
                || l.contains("summary:")
                || l.contains("description:")
                || l.contains("explanation:")
                || l.contains("reasoning:")
                || l.contains("analysis:")
                || l.contains("thinking:")
                || l.contains("step ")
                || l.contains("first,")
                || l.contains("second,")
                || l.contains("third,")
                || l.contains("finally,")
                || l.contains("note:")
                || l.contains("important:")
                || l.contains("warning:")
                || l.contains("tip:")
                || l.contains("hint:")
                || l.contains("example:")
                || l.contains("e.g.")
                || l.contains("i.e.")
                || l.contains("etc.")
                || l.contains("see ")
                || l.contains("ref ")
                || l.contains("refer")
                || l.contains("http")
                || l.contains("url")
                || l.contains("link")
                || l.contains("test")
                || l.contains("todo")
                || l.contains("fixme")
                || l.contains("hack")
                || l.contains("workaround")
                || l.contains("temp ")
                || l.contains("temporary")
                || l.contains("note that")
                || l.contains("please ")
                || l.contains("make sure")
                || l.contains("ensure that")
                || l.contains("as shown")
                || l.contains("as described")
                || l.contains("as mentioned")
                || l.contains("according to")
                || l.contains("in order to")
                || l.contains("for the purpose")
                || l.contains("with respect to")
                || l.contains("in terms of")
                || l.contains("on the other hand")
                || l.contains("in addition")
                || l.contains("furthermore")
                || l.contains("moreover")
                || l.contains("additionally")
                || l.contains("consequently")
                || l.contains("therefore")
                || l.contains("thus ")
                || l.contains("hence ")
                || l.contains("however ")
                || l.contains("nevertheless")
                || l.contains("nonetheless")
                || l.contains("despite ")
                || l.contains("although ")
                || l.contains("while ")
                || l.contains("since ")
                || l.contains("because ")
                || l.contains("due to")
                || l.contains("as a result")
                || l.contains("in conclusion")
                || l.contains("to summarize")
                || l.contains("in brief")
                || l.contains("in short")
                || l.contains("basically")
                || l.contains("essentially")
                || l.contains("overall ")
                || l.contains("in general")
                || l.contains("for example")
                || l.contains("for instance")
                || l.contains("such as ")
                || l.contains("namely ")
                || l.contains("specifically ")
                || l.contains("particularly ")
                || l.contains("especially ")
                || l.contains("mainly ")
                || l.contains("primarily ")
                || l.contains("chiefly ")
                || l.contains("principally ")
                || l.contains("essentially ")
                || l.contains("fundamentally ")
                || l.contains("basically ")
                || l.contains("simply ")
                || l.contains("merely ")
                || l.contains("just ")
                || l.contains("only ")
                || l.contains("the purpose")
                || l.contains("the goal")
                || l.contains("the objective")
                || l.contains("the intention")
                || l.contains("the aim")
                || l.contains("the intent")
                || l.contains("this is a")
                || l.contains("this pull request")
                || l.contains("this merge request")
                || l.contains("this issue")
                || l.contains("this feature")
                || l.contains("this bug")
                || l.contains("this fix")
                || l.contains("this update")
                || l.contains("this improvement")
                || l.contains("this enhancement")
                || l.contains("this refactor")
                || l.contains("this change")
                || l.contains("this modification")
                || l.contains("this patch")
                || l.contains("this commit")
                || l.contains("this diff")
                || l.contains("the following")
                || l.contains("below is")
                || l.contains("above is")
                || l.contains("here's")
                || l.contains("here is")
                || l.contains("here are")
                || l.contains("let me")
                || l.contains("let us")
                || l.contains("i'll ")
                || l.contains("i will ")
                || l.contains("we'll ")
                || l.contains("we will ")
                || l.contains("you can")
                || l.contains("you should")
                || l.contains("you may")
                || l.contains("you might")
                || l.contains("it is ")
                || l.contains("it's ")
                || l.contains("there is ")
                || l.contains("there are ")
                || l.contains("there were ")
                || l.contains("there was ")
                || l.contains("this was ")
                || l.contains("these were ")
                || l.contains("those were ")
                || l.contains("the commit message")
                || l.contains("the git commit")
                || l.contains("a commit message")
                || l.contains("an appropriate")
                || l.contains("a suitable")
                || l.contains("a proper")
                || l.contains("a good")
                || l.contains("a better")
                || l.contains("a more")
                || l.contains("a concise")
                || l.contains("a clear")
                || l.contains("a descriptive")
                || l.contains("a meaningful")
                || l.contains("a relevant")
                || l.contains("an accurate")
                || l.contains("an informative")
                || l.contains("an effective")
                || l.contains("an appropriate commit")
        };

        // Helper closure to clean candidate string
        let clean_candidate = |line: &str| -> String {
            let mut cleaned = line.trim();
            // Strip leading markdown/quote/bullet chars
            while cleaned.starts_with('*')
                || cleaned.starts_with('-')
                || cleaned.starts_with('`')
                || cleaned.starts_with('"')
                || cleaned.starts_with('\'')
                || cleaned.starts_with('#')
                || cleaned.starts_with('>')
                || cleaned.starts_with('[')
            {
                cleaned = cleaned
                    .trim_start_matches('*')
                    .trim_start_matches('-')
                    .trim_start_matches('`')
                    .trim_start_matches('"')
                    .trim_start_matches('\'')
                    .trim_start_matches('#')
                    .trim_start_matches('>')
                    .trim_start_matches('[')
                    .trim();
            }
            // Strip trailing markdown/quote chars
            while cleaned.ends_with('}')
                || cleaned.ends_with('`')
                || cleaned.ends_with('"')
                || cleaned.ends_with('\'')
                || cleaned.ends_with('.')
                || cleaned.ends_with(')')
                || cleaned.ends_with(']')
            {
                cleaned = cleaned
                    .trim_end_matches('}')
                    .trim_end_matches('`')
                    .trim_end_matches('"')
                    .trim_end_matches('\'')
                    .trim_end_matches('.')
                    .trim_end_matches(')')
                    .trim_end_matches(']')
                    .trim();
            }

            // Strip Option/Title/Result prefixes
            if let Some(pos) = cleaned.find(':') {
                let prefix = cleaned[..pos].trim().to_lowercase();
                if prefix.starts_with("option")
                    || prefix.starts_with("choice")
                    || prefix == "title"
                    || prefix == "result"
                    || prefix == "output"
                    || prefix == "commit"
                    || prefix == "message"
                    || prefix == "answer"
                    || prefix == "response"
                    || prefix == "suggestion"
                    || prefix == "recommended"
                {
                    cleaned = cleaned[pos + 1..].trim();
                }
            }

            // Strip backtick formatting inside output like `feat(ui): ...`
            if cleaned.starts_with('`') && cleaned.ends_with('`') && cleaned.len() > 2 {
                cleaned = &cleaned[1..cleaned.len() - 1];
            }

            // Strip "scope:" patterns that are redundant
            // e.g. "scope: ui" -> skip if no type prefix

            cleaned.to_string()
        };

        let strip_duplicate_prefixes = |mut input: String| -> String {
            loop {
                let mut changed = false;
                let lower = input.to_lowercase();
                for t1 in &types {
                    let p1_colon = format!("{}:", t1);
                    let p1_paren = format!("{}(", t1);
                    let has_p1 = lower.starts_with(&p1_colon) || lower.starts_with(&p1_paren);

                    if has_p1 {
                        let rest_offset = if lower.starts_with(&p1_colon) {
                            p1_colon.len()
                        } else {
                            if let Some(close_paren) = input.find("):") {
                                close_paren + 2
                            } else {
                                0
                            }
                        };

                        if rest_offset > 0 && rest_offset < input.len() {
                            let rest = input[rest_offset..].trim();
                            let rest_lower = rest.to_lowercase();
                            for t2 in &types {
                                if rest_lower.starts_with(&format!("{}:", t2))
                                    || rest_lower.starts_with(&format!("{}(", t2))
                                {
                                    input = rest.to_string();
                                    changed = true;
                                    break;
                                }
                            }
                        }
                    }
                    if changed {
                        break;
                    }
                }
                if !changed {
                    break;
                }
            }
            input
        };

        // Validate that a string looks like a proper conventional commit
        let is_valid_conventional_commit = |s: &str| -> bool {
            let lower = s.to_lowercase();
            let has_type = types.iter().any(|t| {
                lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t))
            });
            if !has_type {
                return false;
            }
            // Must have content after "type: " or "type(scope): "
            let after_prefix = if let Some(pos) = s.find("):") {
                s[pos + 2..].trim()
            } else if let Some(pos) = s.find(':') {
                s[pos + 1..].trim()
            } else {
                ""
            };
            !after_prefix.is_empty() && after_prefix.len() >= 3
        };

        // Pass 1: Search bottom-up for a line that is already a valid conventional commit
        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);

            if is_meta(&cleaned) {
                continue;
            }

            if is_valid_conventional_commit(&cleaned) {
                let mut result = strip_duplicate_prefixes(cleaned);
                if result.len() > 72 {
                    let header_end = result.find(':').map(|i| i + 1).unwrap_or(0);
                    if let Some(last_space) = result[..72].rfind(' ') {
                        if last_space > header_end {
                            result.truncate(last_space);
                        } else {
                            result.truncate(72);
                        }
                    } else {
                        result.truncate(72);
                    }
                }
                return Ok(result);
            }
        }

        // Pass 2: Search for any line starting with a type prefix (even if not fully valid)
        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            let lower = cleaned.to_lowercase();

            if is_meta(&cleaned) {
                continue;
            }

            for t in &types {
                if lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t)) {
                    let mut result = strip_duplicate_prefixes(cleaned);
                    if result.len() > 72 {
                        let header_end = result.find(':').map(|i| i + 1).unwrap_or(0);
                        if let Some(last_space) = result[..72].rfind(' ') {
                            if last_space > header_end {
                                result.truncate(last_space);
                            } else {
                                result.truncate(72);
                            }
                        } else {
                            result.truncate(72);
                        }
                    }
                    return Ok(result);
                }
            }
        }

        // Pass 3: Last resort - find the most "commit-like" line and try to salvage it
        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            if cleaned.is_empty() || is_meta(&cleaned) || cleaned.len() < 10 {
                continue;
            }

            // Heuristic: pick the line that looks most like a subject line
            // (short, no sentences, no commas, no complex structure)
            let lower = cleaned.to_lowercase();
            let word_count = cleaned.split_whitespace().count();
            let has_period = cleaned.contains('.');
            let has_comma = cleaned.contains(',');
            let looks_like_subject = word_count <= 10
                && !has_period
                && !has_comma
                && !lower.starts_with("the ")
                && !lower.starts_with("a ")
                && !lower.starts_with("an ")
                && !lower.starts_with("this ")
                && !lower.starts_with("it ");

            if !looks_like_subject {
                continue;
            }

            // Guess the type from keywords
            let prefix = if lower.contains("fix")
                || lower.contains("bug")
                || lower.contains("error")
                || lower.contains("crash")
                || lower.contains("overflow")
                || lower.contains("null")
                || lower.contains("panic")
            {
                "fix: "
            } else if lower.contains("style")
                || lower.contains("css")
                || lower.contains("format")
                || lower.contains("lint")
                || lower.contains("whitespace")
                || lower.contains("indent")
            {
                "style: "
            } else if lower.contains("test") || lower.contains("spec") || lower.contains("assert") {
                "test: "
            } else if lower.contains("doc")
                || lower.contains("readme")
                || lower.contains("comment")
                || lower.contains("typo")
            {
                "docs: "
            } else if lower.contains("remove")
                || lower.contains("delete")
                || lower.contains("clean")
                || lower.contains("deprecat")
            {
                "chore: "
            } else if lower.contains("perf")
                || lower.contains("speed")
                || lower.contains("optim")
                || lower.contains("cache")
                || lower.contains("lazy")
            {
                "perf: "
            } else if lower.contains("refactor")
                || lower.contains("restructure")
                || lower.contains("reorganiz")
            {
                "refactor: "
            } else {
                "feat: "
            };

            let mut result = format!("{}{}", prefix, cleaned);
            result = strip_duplicate_prefixes(result);
            if result.len() > 72 {
                if let Some(last_space) = result[..72].rfind(' ') {
                    result.truncate(last_space);
                } else {
                    result.truncate(72);
                }
            }
            return Ok(result);
        }
    }

    if !is_success_status(response.status_code) {
        return Err(format!(
            "Ollama HTTP request error: HTTP {}: {}",
            response.status_code,
            short_response_body(&resp_str)
        ));
    }

    Err(format!(
        "Ollama response parsing error: {}",
        short_response_body(&resp_str)
    ))
}

#[tauri::command]
async fn generate_ai_commit_message_gemini(
    diff: Option<String>,
    paths: Option<Vec<String>>,
    model: Option<String>,
    api_key: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut actual_diff = diff.unwrap_or_default();

    if actual_diff.trim().is_empty() {
        let diff_result = {
            let app_state = state.lock().map_err(|e| e.to_string())?;
            if let Some(repo) = app_state.repo.as_ref() {
                let mut diff_builder = String::new();
                if let Some(p_vec) = &paths {
                    if !p_vec.is_empty() {
                        for path in p_vec {
                            let d_head =
                                run_git(repo, &["diff", "HEAD", "--", path]).unwrap_or_default();
                            if !d_head.trim().is_empty() {
                                diff_builder.push_str(&d_head);
                                diff_builder.push('\n');
                            } else {
                                let d_staged = run_git(repo, &["diff", "--cached", "--", path])
                                    .unwrap_or_default();
                                if !d_staged.trim().is_empty() {
                                    diff_builder.push_str(&d_staged);
                                    diff_builder.push('\n');
                                } else {
                                    if let Some(workdir) = repo.workdir() {
                                        let full_path = workdir.join(path);
                                        if full_path.exists() && full_path.is_file() {
                                            if let Ok(content) = std::fs::read_to_string(&full_path)
                                            {
                                                let snippet: String = content
                                                    .lines()
                                                    .take(40)
                                                    .collect::<Vec<_>>()
                                                    .join("\n");
                                                diff_builder.push_str(&format!(
                                                    "+++ Added untracked file {}\n{}\n",
                                                    path, snippet
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                    }
                } else {
                    diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                }
                Some(diff_builder)
            } else {
                None
            }
        };
        if let Some(d) = diff_result {
            actual_diff = d;
        }
    }

    if actual_diff.trim().is_empty() {
        return Err("No diff or changed files found for selected items.".to_string());
    }

    if actual_diff.len() > 6000 {
        actual_diff.truncate(6000);
        actual_diff.push_str("\n...[diff truncated for length]");
    }

    let gemini_model = model
        .unwrap_or_else(|| "gemini-2.5-flash".to_string())
        .trim()
        .trim_start_matches("models/")
        .to_string();

    let prompt = format!(
        "You are a commit message generator. Output ONLY the commit message line. Nothing else.

Rules:
- Output exactly ONE line in format: type(scope): description
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Scope is optional, use only if the change clearly belongs to a specific module
- Description must be imperative mood, lowercase first letter, no period at end
- Max 72 characters total
- Do NOT include any explanation, reasoning, markdown, backticks, quotes, or multiple options
- Do NOT start with Here is, This commit, Based on, The diff, Option, Let me, I will
- Do NOT include any text before or after the commit line
- If unsure about scope, omit it: feat: add user authentication

Diff:
{}",
        actual_diff
    );

    let payload = serde_json::json!({
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": "You are a commit message generator. Output ONLY the commit message line. No explanations, no reasoning, no markdown, no backticks."}]
        },
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.9,
            "maxOutputTokens": 100
        }
    });

    let api_path = format!("/v1beta/models/{}:generateContent", gemini_model);
    let api_key_header = google_api_key_header(&api_key)?;
    let payload_str = payload.to_string();

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_https_request(
            "generativelanguage.googleapis.com",
            "POST",
            &api_path,
            &[
                api_key_header,
                ("Content-Type".to_string(), "application/json".to_string()),
            ],
            Some(&payload_str),
            Duration::from_secs(30),
        )
        .map_err(|e| format!("Gemini request execution error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let resp_str = response.body;

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&resp_str) {
        if let Some(err_msg) = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return Err(format!("Gemini API Error: {}", err_msg));
        }

        let mut combined = String::new();

        if let Some(candidates) = json.get("candidates").and_then(|c| c.as_array()) {
            for candidate in candidates {
                if let Some(content) = candidate.get("content") {
                    if let Some(parts) = content.get("parts").and_then(|p| p.as_array()) {
                        for part in parts {
                            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                if !text.trim().is_empty() {
                                    combined.push_str(text);
                                    combined.push('\n');
                                }
                            }
                        }
                    }
                }
            }
        }

        if combined.trim().is_empty() {
            return Err(format!(
                "Gemini returned empty response: {}",
                resp_str.chars().take(200).collect::<String>()
            ));
        }

        let types = [
            "feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore",
        ];
        let raw_lines: Vec<&str> = combined.lines().collect();

        let is_meta = |s: &str| -> bool {
            let l = s.to_lowercase().trim().to_string();
            if l.is_empty() || l.len() < 8 {
                return true;
            }
            l.contains("specifically")
                || l.contains("they involve")
                || l.contains("this diff")
                || l.contains("in summary")
                || l.contains("input:")
                || l.contains("file:")
                || l.contains("option ")
                || l.contains("let's look")
                || l.contains("lets look")
                || l.contains("look at the content")
                || l.contains("here is a commit")
                || l.contains("it adds new")
                || l.contains("this commit")
                || l.contains("based on")
                || l.contains("the change")
                || l.contains("the code")
                || l.contains("the diff shows")
                || l.contains("i will")
                || l.contains("we need")
                || l.contains("we should")
                || l.contains("we can")
                || l.contains("the file")
                || l.contains("a new ")
                || l.contains("added ")
                || l.contains("removes ")
                || l.contains("updates ")
                || l.contains("modifies ")
                || l.contains("introduces ")
                || l.contains("implements ")
                || l.contains("creates ")
                || l.contains("refactors ")
                || l.contains("improves ")
                || l.contains("enhances ")
                || l.contains("changes ")
                || l.contains("deletes ")
                || l.contains("fixes ")
                || l.contains("resolves ")
                || l.contains("adds a ")
                || l.contains("adds the ")
                || l.contains("adds support")
                || l.contains("adds new ")
                || l.contains("adds a new")
                || l.contains("the changes")
                || l.contains("this change")
                || l.contains("this file")
                || l.contains("this code")
                || l.contains("this pr")
                || l.contains("this pull")
                || l.contains("the commit")
                || l.contains("summary:")
                || l.contains("description:")
                || l.contains("explanation:")
                || l.contains("reasoning:")
                || l.contains("analysis:")
                || l.contains("thinking:")
                || l.contains("step ")
                || l.contains("first,")
                || l.contains("second,")
                || l.contains("note:")
                || l.contains("important:")
                || l.contains("example:")
                || l.contains("e.g.")
                || l.contains("i.e.")
                || l.contains("see ")
                || l.contains("ref ")
                || l.contains("http")
                || l.contains("todo")
                || l.contains("fixme")
                || l.contains("please ")
                || l.contains("make sure")
                || l.contains("ensure that")
                || l.contains("in order to")
                || l.contains("furthermore")
                || l.contains("moreover")
                || l.contains("additionally")
                || l.contains("consequently")
                || l.contains("therefore")
                || l.contains("however ")
                || l.contains("nevertheless")
                || l.contains("in conclusion")
                || l.contains("to summarize")
                || l.contains("in brief")
                || l.contains("in short")
                || l.contains("basically")
                || l.contains("essentially")
                || l.contains("overall ")
                || l.contains("in general")
                || l.contains("for example")
                || l.contains("for instance")
                || l.contains("the purpose")
                || l.contains("the goal")
                || l.contains("the objective")
                || l.contains("this is a")
                || l.contains("this pull request")
                || l.contains("this feature")
                || l.contains("this bug")
                || l.contains("this fix")
                || l.contains("this update")
                || l.contains("this improvement")
                || l.contains("this enhancement")
                || l.contains("this refactor")
                || l.contains("this modification")
                || l.contains("this patch")
                || l.contains("this diff")
                || l.contains("the following")
                || l.contains("below is")
                || l.contains("here's")
                || l.contains("here is")
                || l.contains("here are")
                || l.contains("let me")
                || l.contains("let us")
                || l.contains("i'll ")
                || l.contains("i will ")
                || l.contains("we'll ")
                || l.contains("we will ")
                || l.contains("you can")
                || l.contains("you should")
                || l.contains("it is ")
                || l.contains("it's ")
                || l.contains("there is ")
                || l.contains("there are ")
                || l.contains("the commit message")
                || l.contains("a commit message")
                || l.contains("an appropriate")
                || l.contains("a suitable")
                || l.contains("a proper")
                || l.contains("a good")
                || l.contains("a better")
                || l.contains("a concise")
                || l.contains("a clear")
                || l.contains("a descriptive")
                || l.contains("a meaningful")
                || l.contains("an accurate")
                || l.contains("an effective")
                || l.contains("an appropriate commit")
        };

        let clean_candidate = |line: &str| -> String {
            let mut cleaned = line.trim();
            while cleaned.starts_with('*')
                || cleaned.starts_with('-')
                || cleaned.starts_with('`')
                || cleaned.starts_with('"')
                || cleaned.starts_with('\'')
                || cleaned.starts_with('#')
                || cleaned.starts_with('>')
                || cleaned.starts_with('[')
            {
                cleaned = cleaned
                    .trim_start_matches('*')
                    .trim_start_matches('-')
                    .trim_start_matches('`')
                    .trim_start_matches('"')
                    .trim_start_matches('\'')
                    .trim_start_matches('#')
                    .trim_start_matches('>')
                    .trim_start_matches('[')
                    .trim();
            }
            while cleaned.ends_with('}')
                || cleaned.ends_with('`')
                || cleaned.ends_with('"')
                || cleaned.ends_with('\'')
                || cleaned.ends_with('.')
                || cleaned.ends_with(')')
                || cleaned.ends_with(']')
            {
                cleaned = cleaned
                    .trim_end_matches('}')
                    .trim_end_matches('`')
                    .trim_end_matches('"')
                    .trim_end_matches('\'')
                    .trim_end_matches('.')
                    .trim_end_matches(')')
                    .trim_end_matches(']')
                    .trim();
            }
            if let Some(pos) = cleaned.find(':') {
                let prefix = cleaned[..pos].trim().to_lowercase();
                if prefix.starts_with("option")
                    || prefix.starts_with("choice")
                    || prefix == "title"
                    || prefix == "result"
                    || prefix == "output"
                    || prefix == "commit"
                    || prefix == "message"
                    || prefix == "answer"
                    || prefix == "response"
                    || prefix == "suggestion"
                    || prefix == "recommended"
                {
                    cleaned = cleaned[pos + 1..].trim();
                }
            }
            if cleaned.starts_with('`') && cleaned.ends_with('`') && cleaned.len() > 2 {
                cleaned = &cleaned[1..cleaned.len() - 1];
            }
            cleaned.to_string()
        };

        let strip_duplicate_prefixes = |mut input: String| -> String {
            loop {
                let mut changed = false;
                let lower = input.to_lowercase();
                for t1 in &types {
                    let p1_colon = format!("{}:", t1);
                    let p1_paren = format!("{}(", t1);
                    let has_p1 = lower.starts_with(&p1_colon) || lower.starts_with(&p1_paren);
                    if has_p1 {
                        let rest_offset = if lower.starts_with(&p1_colon) {
                            p1_colon.len()
                        } else {
                            if let Some(close_paren) = input.find("):") {
                                close_paren + 2
                            } else {
                                0
                            }
                        };
                        if rest_offset > 0 && rest_offset < input.len() {
                            let rest = input[rest_offset..].trim();
                            let rest_lower = rest.to_lowercase();
                            for t2 in &types {
                                if rest_lower.starts_with(&format!("{}:", t2))
                                    || rest_lower.starts_with(&format!("{}(", t2))
                                {
                                    input = rest.to_string();
                                    changed = true;
                                    break;
                                }
                            }
                        }
                    }
                    if changed {
                        break;
                    }
                }
                if !changed {
                    break;
                }
            }
            input
        };

        let is_valid_conventional_commit = |s: &str| -> bool {
            let lower = s.to_lowercase();
            let has_type = types.iter().any(|t| {
                lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t))
            });
            if !has_type {
                return false;
            }
            let after_prefix = if let Some(pos) = s.find("):") {
                s[pos + 2..].trim()
            } else if let Some(pos) = s.find(':') {
                s[pos + 1..].trim()
            } else {
                ""
            };
            !after_prefix.is_empty() && after_prefix.len() >= 3
        };

        let truncate_to_72 = |result: &mut String| {
            if result.len() > 72 {
                let header_end = result.find(':').map(|i| i + 1).unwrap_or(0);
                if let Some(last_space) = result[..72].rfind(' ') {
                    if last_space > header_end {
                        result.truncate(last_space);
                    } else {
                        result.truncate(72);
                    }
                } else {
                    result.truncate(72);
                }
            }
        };

        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            if is_meta(&cleaned) {
                continue;
            }
            if is_valid_conventional_commit(&cleaned) {
                let mut result = strip_duplicate_prefixes(cleaned);
                truncate_to_72(&mut result);
                return Ok(result);
            }
        }

        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            let lower = cleaned.to_lowercase();
            if is_meta(&cleaned) {
                continue;
            }
            for t in &types {
                if lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t)) {
                    let mut result = strip_duplicate_prefixes(cleaned);
                    truncate_to_72(&mut result);
                    return Ok(result);
                }
            }
        }

        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            if cleaned.is_empty() || is_meta(&cleaned) || cleaned.len() < 10 {
                continue;
            }
            let lower = cleaned.to_lowercase();
            let word_count = cleaned.split_whitespace().count();
            let has_period = cleaned.contains('.');
            let has_comma = cleaned.contains(',');
            let looks_like_subject = word_count <= 10
                && !has_period
                && !has_comma
                && !lower.starts_with("the ")
                && !lower.starts_with("a ")
                && !lower.starts_with("an ")
                && !lower.starts_with("this ")
                && !lower.starts_with("it ");
            if !looks_like_subject {
                continue;
            }
            let prefix = if lower.contains("fix")
                || lower.contains("bug")
                || lower.contains("error")
                || lower.contains("crash")
            {
                "fix: "
            } else if lower.contains("style")
                || lower.contains("css")
                || lower.contains("format")
                || lower.contains("lint")
            {
                "style: "
            } else if lower.contains("test") || lower.contains("spec") {
                "test: "
            } else if lower.contains("doc") || lower.contains("readme") || lower.contains("comment")
            {
                "docs: "
            } else if lower.contains("remove")
                || lower.contains("delete")
                || lower.contains("clean")
            {
                "chore: "
            } else if lower.contains("perf") || lower.contains("speed") || lower.contains("optim") {
                "perf: "
            } else if lower.contains("refactor") || lower.contains("restructure") {
                "refactor: "
            } else {
                "feat: "
            };
            let mut result = format!("{}{}", prefix, cleaned);
            result = strip_duplicate_prefixes(result);
            truncate_to_72(&mut result);
            return Ok(result);
        }
    }

    if !is_success_status(response.status_code) {
        return Err(format!(
            "Gemini HTTP error: HTTP {}: {}",
            response.status_code,
            short_response_body(&resp_str)
        ));
    }

    Err(format!(
        "Gemini response error: {}",
        short_response_body(&resp_str)
    ))
}

#[tauri::command]
async fn list_gemini_models(api_key: String) -> Result<Vec<String>, String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let api_key_header = google_api_key_header(&api_key)?;

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_https_request(
            "generativelanguage.googleapis.com",
            "GET",
            "/v1beta/models",
            &[api_key_header],
            None,
            Duration::from_secs(15),
        )
        .map_err(|e| format!("Gemini model request error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Request error: {}", e))?;

    let resp_str = response.body;

    let json: serde_json::Value =
        serde_json::from_str(&resp_str).map_err(|e| format!("Invalid JSON response: {}", e))?;

    if let Some(err) = json.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Gemini API error: {}", msg));
    }

    if !is_success_status(response.status_code) {
        return Err(format!(
            "Gemini HTTP error: HTTP {}: {}",
            response.status_code,
            short_response_body(&resp_str)
        ));
    }

    let models_array = json
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or_else(|| {
            format!(
                "Unexpected response structure: {}",
                resp_str.chars().take(200).collect::<String>()
            )
        })?;

    let mut model_ids: Vec<String> = models_array
        .iter()
        .filter_map(|model| {
            let name = model.get("name")?.as_str()?;
            let methods = model.get("supportedGenerationMethods")?.as_array()?;
            let supports_generate = methods
                .iter()
                .any(|m| m.as_str() == Some("generateContent"));
            if !supports_generate {
                return None;
            }
            let id = name.strip_prefix("models/").unwrap_or(name);
            Some(id.to_string())
        })
        .collect();

    model_ids.sort();
    Ok(model_ids)
}

fn get_gpg_keys() -> Vec<GpgKey> {
    let mut keys = Vec::new();
    let mut gpg_cmd = Command::new("gpg");
    #[cfg(target_os = "windows")]
    gpg_cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = gpg_cmd
        .args(&["--list-secret-keys", "--keyid-format", "LONG"])
        .output()
    {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let mut current_key_id = String::new();
            for line in out_str.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("sec") {
                    if let Some(pos) = trimmed.find('/') {
                        let after_slash = &trimmed[pos + 1..];
                        let key_id = after_slash.split_whitespace().next().unwrap_or("");
                        current_key_id = key_id.to_string();
                    }
                } else if trimmed.starts_with("uid") && !current_key_id.is_empty() {
                    let uid = trimmed.trim_start_matches("uid").trim().to_string();
                    keys.push(GpgKey {
                        key_id: current_key_id.clone(),
                        uid,
                        is_default: false,
                    });
                    current_key_id.clear();
                }
            }
        }
    }

    keys
}

#[tauri::command]
fn get_git_settings(state: State<'_, Mutex<AppState>>) -> Result<GitSettings, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo_ref = app_state.repo.as_ref();

    let mut current_name = String::new();
    let mut current_email = String::new();
    let mut current_signing_key = String::new();
    let mut gpg_sign_enabled = false;

    if let Some(repo) = repo_ref {
        if let Ok(cfg) = repo.config() {
            current_name = cfg.get_string("user.name").unwrap_or_default();
            current_email = cfg.get_string("user.email").unwrap_or_default();
            current_signing_key = cfg.get_string("user.signingkey").unwrap_or_default();
            gpg_sign_enabled = cfg.get_bool("commit.gpgsign").unwrap_or(false);
        }
    }

    if current_name.is_empty() {
        if let Ok(out) = Command::new("git")
            .args(&["config", "--global", "user.name"])
            .output()
        {
            current_name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    if current_email.is_empty() {
        if let Ok(out) = Command::new("git")
            .args(&["config", "--global", "user.email"])
            .output()
        {
            current_email = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    if current_signing_key.is_empty() {
        if let Ok(out) = Command::new("git")
            .args(&["config", "--global", "user.signingkey"])
            .output()
        {
            current_signing_key = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }

    let mut identities = Vec::new();
    if !current_name.is_empty() || !current_email.is_empty() {
        identities.push(GitIdentity {
            name: current_name.clone(),
            email: current_email.clone(),
            is_current: true,
        });
    }

    if let Some(repo) = repo_ref {
        if let Ok(mut revwalk) = repo.revwalk() {
            revwalk.push_head().ok();
            for oid in revwalk.take(40).flatten() {
                if let Ok(commit) = repo.find_commit(oid) {
                    let name = commit.author().name().unwrap_or("").to_string();
                    let email = commit.author().email().unwrap_or("").to_string();
                    if !name.is_empty() && !email.is_empty() {
                        if !identities.iter().any(|i| i.email == email) {
                            identities.push(GitIdentity {
                                name,
                                email,
                                is_current: false,
                            });
                        }
                    }
                }
            }
        }
    }

    let mut gpg_keys = get_gpg_keys();
    for key in &mut gpg_keys {
        if !current_signing_key.is_empty() && key.key_id.contains(&current_signing_key) {
            key.is_default = true;
        }
    }

    Ok(GitSettings {
        identities,
        gpg_keys,
        current_name,
        current_email,
        current_signing_key,
        gpg_sign_enabled,
    })
}

#[tauri::command]
fn save_git_settings(
    state: State<'_, Mutex<AppState>>,
    name: String,
    email: String,
    signing_key: String,
    gpg_sign: bool,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let name = name.trim();
    let email = email.trim();
    let signing_key = signing_key.trim();

    if !name.is_empty() {
        run_git(repo, &["config", "user.name", name])?;
    }
    if !email.is_empty() {
        run_git(repo, &["config", "user.email", email])?;
    }
    if !signing_key.is_empty() {
        run_git(repo, &["config", "user.signingkey", signing_key])?;
    }
    run_git(
        repo,
        &[
            "config",
            "commit.gpgsign",
            if gpg_sign { "true" } else { "false" },
        ],
    )?;

    Ok("Settings saved successfully".to_string())
}

#[tauri::command]
fn get_smtp_settings() -> Result<SmtpSettings, String> {
    Ok(load_smtp_settings())
}

#[tauri::command]
fn save_smtp_settings(settings: SmtpSettings) -> Result<String, String> {
    save_smtp_settings_to_file(&settings)?;
    Ok("SMTP settings saved successfully".to_string())
}

#[tauri::command]
async fn send_patch_email(state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let smtp = load_smtp_settings();
    if !smtp.enabled {
        return Err("SMTP email notifications are not enabled".to_string());
    }
    if smtp.host.is_empty() || smtp.from_email.is_empty() || smtp.to_email.is_empty() {
        return Err("SMTP host, from email, and to email are required".to_string());
    }

    let patch_content = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
        let workdir = repo_workdir(repo)?;

        let output = Command::new("git")
            .args(&["format-patch", "-1", "HEAD", "--stdout"])
            .current_dir(workdir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("Failed to run git format-patch: {}", e))?;

        if !output.status.success() {
            return Err("Failed to generate patch from HEAD".to_string());
        }
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    if patch_content.trim().is_empty() {
        return Err("Generated patch is empty".to_string());
    }

    let subject = patch_content
        .lines()
        .find(|l| l.starts_with("Subject: "))
        .map(|l| l.trim_start_matches("Subject: ").trim().to_string())
        .unwrap_or_else(|| "Git patch".to_string());

    let from_name = smtp.from_email.split('@').next().unwrap_or("differ");
    let from_addr = format!("{} <{}>", from_name, smtp.from_email);

    let email = Message::builder()
        .from(
            from_addr
                .parse()
                .map_err(|e| format!("Invalid from address: {}", e))?,
        )
        .to(smtp
            .to_email
            .parse()
            .map_err(|e| format!("Invalid to address: {}", e))?)
        .subject(format!("[differ] {}", subject))
        .header(ContentType::TEXT_PLAIN)
        .body(patch_content)
        .map_err(|e| format!("Failed to build email: {}", e))?;

    let creds = if !smtp.username.is_empty() {
        Credentials::new(smtp.username, smtp.password)
    } else {
        Credentials::new(String::new(), String::new())
    };

    let transport = if smtp.use_tls {
        SmtpTransport::starttls_relay(&smtp.host)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(smtp.port)
            .credentials(creds)
            .build()
    } else {
        SmtpTransport::relay(&smtp.host)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(smtp.port)
            .credentials(creds)
            .build()
    };

    transport
        .send(&email)
        .map_err(|e| format!("SMTP send error: {}", e))?;

    Ok(format!("Patch email sent to {}", smtp.to_email))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(AppState {
            repo: None,
            repo_path: None,
        }))
        .invoke_handler(tauri::generate_handler![
            open_repo,
            get_commits,
            get_branches,
            get_commit_diff,
            get_file_tree,
            get_file_content,
            get_worktree_status,
            commit_changes,
            commit_changes_with_options,
            get_sync_status,
            push_origin,
            add_origin,
            merge_branches,
            get_system_info,
            check_ollama_status,
            install_ollama,
            pull_ollama_model,
            generate_ai_commit_message,
            generate_ai_commit_message_gemini,
            list_gemini_models,
            get_git_settings,
            save_git_settings,
            get_smtp_settings,
            save_smtp_settings,
            send_patch_email,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use git2::{BranchType, DiffDelta, DiffOptions, Oid, Repository, Sort, Status, StatusOptions};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{cell::RefCell, collections::HashSet, io, path::Path, process::Command, sync::Mutex};
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
    repo.find_remote("origin")
        .ok()
        .and_then(|remote| remote.url().map(str::to_string))
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

    let (github_owner, github_repo) = repo
        .find_remote("origin")
        .ok()
        .and_then(|remote| remote.url().and_then(parse_github_remote))
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

    for branch_result in repo.branches(None).map_err(|e| e.to_string())? {
        let (branch, branch_type) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("unknown")
            .to_string();
        let is_head = branch.is_head();
        let commit_id = branch
            .get()
            .target()
            .map(|oid| oid.to_string())
            .unwrap_or_default();

        branches.push(BranchInfo {
            name,
            is_head,
            commit_id,
            is_remote: branch_type == BranchType::Remote,
        });
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
        // Sort: directories first, then files, alphabetically
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
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let message = message.trim();

    if paths.is_empty() {
        return Err("Select at least one file to commit".to_string());
    }
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    let mut add_args = vec!["add", "--"];
    add_args.extend(paths.iter().map(String::as_str));
    run_git(repo, &add_args)?;

    let mut commit_args = vec!["commit", "--only", "-m", message, "--"];
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

    // 1. Checkout target branch first
    run_git(repo, &["checkout", &target])?;

    // 2. Perform merge
    run_git(repo, &["merge", &source])
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
            get_sync_status,
            push_origin,
            add_origin,
            merge_branches,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

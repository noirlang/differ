//! Opening repositories and reading commits, branches, diffs and files.

use crate::*;

#[tauri::command]
pub async fn is_git_repository(path: String) -> Result<bool, String> {
    Ok(Repository::discover(&path).is_ok())
}

#[tauri::command]
pub async fn init_repository(
    path: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<RepoInfo, String> {
    let repo = Repository::init(&path)
        .map_err(|e| format!("Failed to initialize Git repository: {}", e))?;
    let info = get_repo_info_from_repository(&repo, &path)?;

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.repo = Some(repo);
    app_state.repo_path = Some(path);

    Ok(info)
}

#[tauri::command]
pub async fn open_repo(path: String, state: State<'_, Mutex<AppState>>) -> Result<RepoInfo, String> {
    let repo = Repository::discover(&path)
        .map_err(|e| format!("Repository could not be opened: {}", e))?;

    let info = get_repo_info_from_repository(&repo, &path)?;

    let mut app_state = state.lock().map_err(|e| e.to_string())?;
    app_state.repo = Some(repo);
    app_state.repo_path = Some(path);

    Ok(info)
}

#[tauri::command]
pub async fn get_commits(
    limit: Option<usize>,
    branch: Option<String>,
    target_remote: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<CommitInfo>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(Sort::TIME | Sort::TOPOLOGICAL)
        .map_err(|e| e.to_string())?;

    if let Some(branch_name) = &branch {
        let reference = repo
            .find_branch(branch_name, BranchType::Local)
            .or_else(|_| repo.find_branch(branch_name, BranchType::Remote));

        if let Ok(b) = reference {
            if let Some(oid) = b.get().target() {
                let _ = revwalk.push(oid);
            }
        }
    } else {
        let _ = revwalk.push_head();
        let _ = repo.references().map(|refs| {
            for reference in refs.flatten() {
                if let Some(oid) = reference.target() {
                    let _ = revwalk.push(oid);
                }
            }
        });
    }

    let max = limit.unwrap_or(500);
    let unpushed = unpushed_oids(repo, branch.as_deref(), target_remote.as_deref());
    let mut commits = Vec::new();

    for (i, oid) in revwalk.enumerate() {
        if i >= max {
            break;
        }
        let oid = oid.map_err(|e| e.to_string())?;
        commits.push(commit_info(repo, oid, &unpushed)?);
    }

    Ok(commits)
}

pub fn commit_info(repo: &Repository, oid: Oid, unpushed: &HashSet<Oid>) -> Result<CommitInfo, String> {
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let id = commit.id().to_string();
    let author = commit.author();
    Ok(CommitInfo {
        short_id: id[..7].to_string(),
        id,
        message: commit.message().unwrap_or("").trim().to_string(),
        author_name: author.name().unwrap_or("Unknown").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        timestamp: commit.time().seconds(),
        parent_ids: commit.parent_ids().map(|id| id.to_string()).collect(),
        is_unpushed: unpushed.contains(&commit.id()),
    })
}

#[tauri::command]
pub async fn get_branches(state: State<'_, Mutex<AppState>>) -> Result<Vec<BranchInfo>, String> {
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
                        is_tag: false,
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
                    let cid = repo
                        .revparse_single(trimmed)
                        .ok()
                        .and_then(|obj| obj.as_commit().map(|c| c.id().to_string()))
                        .unwrap_or_default();
                    branches.push(BranchInfo {
                        name: remote_name.to_string(),
                        is_head: false,
                        commit_id: cid,
                        is_remote: true,
                        is_tag: false,
                    });
                }
            } else if !seen_names.contains(trimmed) {
                seen_names.insert(trimmed.to_string());
                let cid = repo
                    .revparse_single(trimmed)
                    .ok()
                    .and_then(|obj| obj.as_commit().map(|c| c.id().to_string()))
                    .unwrap_or_default();
                branches.push(BranchInfo {
                    name: trimmed.to_string(),
                    is_head: false,
                    commit_id: cid,
                    is_remote: false,
                    is_tag: false,
                });
            }
        }
    }

    if let Ok(tag_out) = run_git(
        repo,
        &["tag", "-l", "--format=%(refname:short)|%(objectname)"],
    ) {
        for line in tag_out.lines() {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() == 2 && !parts[0].is_empty() {
                let tag_name = parts[0].trim();
                if !tag_name.starts_with("commit-") {
                    branches.push(BranchInfo {
                        name: tag_name.to_string(),
                        is_head: false,
                        commit_id: parts[1].trim().to_string(),
                        is_remote: false,
                        is_tag: true,
                    });
                }
            }
        }
    }

    if branches.is_empty() {
        let default_branch_name = repo
            .config()
            .ok()
            .and_then(|cfg| cfg.get_string("init.defaultBranch").ok())
            .unwrap_or_else(|| "main".to_string());

        branches.push(BranchInfo {
            name: default_branch_name,
            is_head: true,
            commit_id: String::new(),
            is_remote: false,
            is_tag: false,
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
pub async fn get_commit_diff(
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
pub async fn get_file_tree(
    commit_id: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<FileTreeEntry>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let tree_result = if let Some(cid) = commit_id {
        let oid = Oid::from_str(&cid).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        commit.tree().map_err(|e| e.to_string())
    } else {
        match repo.head().and_then(|h| h.peel_to_commit()) {
            Ok(commit) => commit.tree().map_err(|e| e.to_string()),
            Err(_) => return Ok(Vec::new()),
        }
    };

    let tree = match tree_result {
        Ok(t) => t,
        Err(_) => return Ok(Vec::new()),
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
pub async fn get_file_content(
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
pub async fn get_worktree_status(
    state: State<'_, Mutex<AppState>>,
) -> Result<Vec<WorktreeFile>, String> {
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
pub async fn get_repo_fingerprint(state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let mut parts: Vec<String> = Vec::new();

    match repo.head() {
        Ok(head) => parts.push(format!(
            "HEAD={}",
            head.target()
                .map(|o| o.to_string())
                .unwrap_or_else(|| "unborn".to_string())
        )),
        Err(_) => parts.push("HEAD=unborn".to_string()),
    }

    if let Ok(refs) = repo.references() {
        let mut ref_parts: Vec<String> = Vec::new();
        for r in refs.flatten() {
            if let (Some(name), Some(target)) = (r.name(), r.target()) {
                ref_parts.push(format!("{name}={target}"));
            }
        }
        ref_parts.sort();
        parts.push(ref_parts.join(","));
    }

    match run_git(repo, &["status", "--porcelain"]) {
        Ok(s) => parts.push(format!("status:{s}")),
        Err(_) => parts.push("status:?".to_string()),
    }

    Ok(parts.join("\n"))
}

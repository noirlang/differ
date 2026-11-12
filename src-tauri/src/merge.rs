//! Merging, conflict resolution and cherry-picking.

use crate::*;

#[tauri::command]
pub async fn merge_branches(
    state: State<'_, Mutex<AppState>>,
    source: String,
    target: String,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    run_git(repo, &["checkout", &target])?;
    run_git(repo, &["merge", &source])
}

#[tauri::command]
pub async fn get_merge_conflicts(state: State<'_, Mutex<AppState>>) -> Result<Vec<String>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let out = run_git(repo, &["diff", "--name-only", "--diff-filter=U"])?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

#[tauri::command]
pub async fn resolve_conflicts(
    state: State<'_, Mutex<AppState>>,
    side: String,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let side = side.trim().to_lowercase();
    if side != "ours" && side != "theirs" {
        return Err("Side must be \"ours\" or \"theirs\"".to_string());
    }

    let out = run_git(repo, &["diff", "--name-only", "--diff-filter=U", "-z"])?;
    let files: Vec<String> = out
        .split_terminator('\0')
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if files.is_empty() {
        return Err("No conflicted files to resolve".to_string());
    }

    let flag = if side == "ours" { "--ours" } else { "--theirs" };
    let mut checkout_args: Vec<String> =
        vec!["checkout".to_string(), flag.to_string(), "--".to_string()];
    checkout_args.extend(files.clone());
    let checkout_refs: Vec<&str> = checkout_args.iter().map(|s| s.as_str()).collect();
    run_git(repo, &checkout_refs)?;

    let mut add_args: Vec<String> = vec!["add".to_string(), "--".to_string()];
    add_args.extend(files.clone());
    let add_refs: Vec<&str> = add_args.iter().map(|s| s.as_str()).collect();
    run_git(repo, &add_refs)?;

    let git_dir = repo.path();
    if git_dir.join("MERGE_HEAD").exists() {
        run_git(repo, &["commit", "--no-edit"])?;
        Ok(format!(
            "Merge completed keeping {} version ({} file(s)).",
            side,
            files.len()
        ))
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        run_git(repo, &["cherry-pick", "--continue"])?;
        Ok(format!(
            "Cherry-pick completed keeping {} version ({} file(s)).",
            side,
            files.len()
        ))
    } else if git_dir.join("REVERT_HEAD").exists() {
        run_git(repo, &["revert", "--continue"])?;
        Ok(format!(
            "Revert completed keeping {} version ({} file(s)).",
            side,
            files.len()
        ))
    } else {
        Err("No merge or cherry-pick in progress".to_string())
    }
}

#[tauri::command]
pub async fn get_conflict_diff(
    state: State<'_, Mutex<AppState>>,
    file_path: String,
) -> Result<DiffFile, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    build_conflict_diff(repo, file_path.trim())
}

pub fn build_conflict_diff(repo: &Repository, path: &str) -> Result<DiffFile, String> {
    if path.is_empty() {
        return Err("File path cannot be empty".to_string());
    }

    // Conflict stages from the index: 2 = ours (target branch), 3 = theirs (incoming).
    let index = repo.index().map_err(|e| e.to_string())?;
    let blob_content = |stage: i32| -> Option<Vec<u8>> {
        index
            .get_path(std::path::Path::new(path), stage)
            .and_then(|entry| repo.find_blob(entry.id).ok())
            .map(|blob| blob.content().to_vec())
    };

    let ours = blob_content(2);
    let theirs = blob_content(3);

    if ours.is_none() && theirs.is_none() {
        return Err(format!("No conflict stages found for: {path}"));
    }

    let ours_blob = match &ours {
        Some(content) => Some(
            repo.blob(content)
                .and_then(|oid| repo.find_blob(oid))
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };
    let theirs_blob = match &theirs {
        Some(content) => Some(
            repo.blob(content)
                .and_then(|oid| repo.find_blob(oid))
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };

    let mut opts = DiffOptions::new();
    opts.context_lines(3);

    let files: RefCell<Vec<DiffFile>> = RefCell::new(Vec::new());
    files.borrow_mut().push(DiffFile {
        old_path: path.to_string(),
        new_path: path.to_string(),
        status: "modified".to_string(),
        hunks: Vec::new(),
    });

    repo.diff_blobs(
        ours_blob.as_ref(),
        Some(path),
        theirs_blob.as_ref(),
        Some(path),
        Some(&mut opts),
        None,
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

    files
        .into_inner()
        .into_iter()
        .next()
        .ok_or_else(|| "Diff could not be built".to_string())
}


#[tauri::command]
pub async fn abort_in_progress(state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let git_dir = repo.path();
    if git_dir.join("MERGE_HEAD").exists() {
        run_git(repo, &["merge", "--abort"])?;
        Ok("Merge aborted.".to_string())
    } else if git_dir.join("CHERRY_PICK_HEAD").exists() {
        run_git(repo, &["cherry-pick", "--abort"])?;
        Ok("Cherry-pick aborted.".to_string())
    } else if git_dir.join("REVERT_HEAD").exists() {
        run_git(repo, &["revert", "--abort"])?;
        Ok("Revert aborted.".to_string())
    } else {
        Err("No merge or cherry-pick in progress".to_string())
    }
}

#[tauri::command]
pub async fn get_unmerged_commits(
    state: State<'_, Mutex<AppState>>,
    target_branch: String,
    source_branch: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let target_name = target_branch.trim();
    if target_name.is_empty() {
        return Err("Target branch cannot be empty".to_string());
    }

    let target = repo
        .find_branch(target_name, BranchType::Local)
        .or_else(|_| repo.find_branch(target_name, BranchType::Remote))
        .map_err(|_| format!("Branch not found: {target_name}"))?;

    let target_oid = target
        .get()
        .target()
        .ok_or_else(|| format!("Branch has no commits: {target_name}"))?;

    // Source: the viewed branch, or HEAD when none is selected.
    let mut source_oid = None;
    if let Some(name) = source_branch.filter(|s| !s.trim().is_empty()) {
        let name = name.trim();
        if let Ok(branch) = repo
            .find_branch(name, BranchType::Local)
            .or_else(|_| repo.find_branch(name, BranchType::Remote))
        {
            source_oid = branch.get().target();
        }
    }
    if source_oid.is_none() {
        source_oid = repo.head().ok().and_then(|head| head.target());
    }

    let Some(source_oid) = source_oid else {
        return Ok(Vec::new());
    };

    // `git cherry` compares patches, not just hashes: commits whose patch
    // already exists upstream are marked `-` and only `+` commits are truly
    // unmerged. This way an already cherry-picked commit stops showing up.
    let mut unmerged_ids: Vec<Oid> = Vec::new();
    match run_git(
        repo,
        &["cherry", &target_oid.to_string(), &source_oid.to_string()],
    ) {
        Ok(out) => {
            for line in out.lines() {
                if unmerged_ids.len() >= 200 {
                    break;
                }
                if let Some(sha) = line.trim().strip_prefix('+') {
                    if let Ok(oid) = Oid::from_str(sha.trim()) {
                        unmerged_ids.push(oid);
                    }
                }
            }
        }
        Err(_) => {
            // No merge base (unrelated histories): fall back to reachability.
            if let Ok(mut revwalk) = repo.revwalk() {
                let _ = revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL);
                if revwalk.push(source_oid).is_ok() {
                    let _ = revwalk.hide(target_oid);
                    for oid in revwalk.take(200).flatten() {
                        unmerged_ids.push(oid);
                    }
                }
            }
        }
    }

    let unpushed = unpushed_oids(repo, None, None);
    let mut commits = Vec::new();

    for oid in unmerged_ids {
        let Ok(commit) = repo.find_commit(oid) else {
            continue;
        };

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

    // Newest first, independent of `git cherry` output order.
    commits.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(commits)
}

#[tauri::command]
pub async fn cherry_pick_commit(
    state: State<'_, Mutex<AppState>>,
    commit_id: String,
    target_branch: Option<String>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let id_trimmed = commit_id.trim();
    if id_trimmed.is_empty() {
        return Err("Commit id cannot be empty".to_string());
    }

    // Verify the commit exists before touching the worktree.
    let oid = Oid::from_str(id_trimmed).map_err(|_| format!("Invalid commit id: {id_trimmed}"))?;
    repo.find_commit(oid)
        .map_err(|_| format!("Commit not found: {id_trimmed}"))?;

    // A previous failed cherry-pick/merge leaves the repo locked in that state;
    // a new cherry-pick cannot start until it is resolved.
    let git_dir = repo.path();
    for lock_file in ["CHERRY_PICK_HEAD", "MERGE_HEAD", "REVERT_HEAD"] {
        if git_dir.join(lock_file).exists() {
            return Err("Another cherry-pick or merge is already in progress. Resolve it in your terminal first (git cherry-pick --continue / --abort), then try again.".to_string());
        }
    }

    // Cherry-pick applies onto the target branch: check it out first when needed.
    if let Some(target) = target_branch
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
    {
        if repo.find_branch(&target, BranchType::Local).is_err() {
            return Err(format!("Target branch not found: {target}"));
        }
        let current = current_branch_name(repo).unwrap_or_default();
        if current != target {
            // A dirty worktree blocks checkout — fail early with a clear message
            // instead of a cryptic git checkout error.
            let status = run_git(repo, &["status", "--porcelain"])?;
            if !status.trim().is_empty() {
                let count = status.lines().count();
                let sample: Vec<&str> = status.lines().take(5).map(|l| l.trim()).collect();
                return Err(format!(
                    "Uncommitted changes would be overwritten by switching to {target} ({count} file(s): {}). Commit or stash your changes first, then try again.",
                    sample.join(", ")
                ));
            }
            run_git(repo, &["checkout", &target])?;
        }
    }

    match run_git(repo, &["cherry-pick", id_trimmed]) {
        Ok(out) => Ok(out),
        Err(err) => {
            // Commit content already exists on the target — nothing to apply.
            if err.contains("empty") {
                let _ = run_git(repo, &["cherry-pick", "--quit"]);
                return Ok(format!(
                    "Commit {id_trimmed} is already applied on this branch — nothing to cherry-pick."
                ));
            }
            // Conflicts leave the repo in CHERRY_PICKING state on purpose so the
            // user can resolve them; surface git's message with guidance.
            Err(format!(
                "{err}\n\nResolve the conflicts in your terminal, then run \"git cherry-pick --continue\" or \"git cherry-pick --abort\"."
            ))
        }
    }
}

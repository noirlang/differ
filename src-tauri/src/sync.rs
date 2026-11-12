//! Remotes, sync status, push and fetch.

use crate::*;

#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, Mutex<AppState>>,
    target_remote: Option<String>,
) -> Result<SyncStatus, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let current_branch = current_branch_name(repo).unwrap_or_else(|| "detached".to_string());
    let resolved_remote = resolve_target_remote(repo, target_remote.as_deref());

    let Some(r_name) = resolved_remote else {
        return Ok(SyncStatus {
            has_origin: false,
            origin_url: None,
            current_branch,
            upstream: None,
            unpushed_count: 0,
            can_push: false,
        });
    };

    let remote_url_val = repo
        .find_remote(&r_name)
        .ok()
        .and_then(|r| r.url().map(str::to_string))
        .or_else(|| origin_url(repo));

    let has_remote = remote_url_val.is_some();

    if current_branch == "detached" {
        return Ok(SyncStatus {
            has_origin: has_remote,
            origin_url: remote_url_val,
            current_branch,
            upstream: None,
            unpushed_count: 0,
            can_push: false,
        });
    }

    let mut upstream_name = None;
    if let Ok(local_branch) = repo.find_branch(&current_branch, BranchType::Local) {
        if let Ok(upstream_branch) = local_branch.upstream() {
            if let Some(up_name) = upstream_branch.name().ok().flatten() {
                upstream_name = Some(up_name.to_string());
            }
        }
    }

    if upstream_name.is_none() {
        let remote_branch_ref = format!("refs/remotes/{}/{}", r_name, current_branch);
        if repo.find_reference(&remote_branch_ref).is_ok() {
            upstream_name = Some(format!("{}/{}", r_name, current_branch));
        }
    }

    let unpushed_set = unpushed_oids(repo, Some(&current_branch), Some(&r_name));
    let unpushed_count = unpushed_set.len();

    Ok(SyncStatus {
        has_origin: has_remote,
        origin_url: remote_url_val,
        current_branch,
        upstream: upstream_name,
        unpushed_count,
        can_push: has_remote,
    })
}

#[tauri::command]
pub async fn push_origin(
    state: State<'_, Mutex<AppState>>,
    target_remote: Option<String>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let r_name = resolve_target_remote(repo, target_remote.as_deref())
        .unwrap_or_else(|| "origin".to_string());

    let branch_name = current_branch_name(repo).ok_or("Active branch was not found")?;
    if branch_name == "detached" {
        return Err("Detached HEAD cannot be pushed".to_string());
    }

    run_git(repo, &["push", "-u", &r_name, &branch_name])
}

#[tauri::command]
pub async fn add_origin(state: State<'_, Mutex<AppState>>, url: String) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let url_trimmed = url.trim();
    if url_trimmed.is_empty() {
        return Err("Remote URL cannot be empty".to_string());
    }

    run_git(repo, &["remote", "add", "origin", url_trimmed])
}


#[tauri::command]
pub async fn get_git_remotes(state: State<'_, Mutex<AppState>>) -> Result<Vec<GitRemoteInfo>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let mut result = Vec::new();
    let mut seen_names = HashSet::new();

    if let Ok(remotes) = repo.remotes() {
        for name in remotes.iter().flatten() {
            if seen_names.insert(name.to_string()) {
                let url = repo
                    .find_remote(name)
                    .ok()
                    .and_then(|r| r.url().map(str::to_string))
                    .or_else(|| {
                        run_git(repo, &["remote", "get-url", name])
                            .ok()
                            .map(|s| s.trim().to_string())
                    })
                    .unwrap_or_default();

                let (is_github, github_owner, github_repo) =
                    if let Some((owner, repo_name)) = parse_github_remote(&url) {
                        (true, Some(owner), Some(repo_name))
                    } else {
                        (false, None, None)
                    };

                result.push(GitRemoteInfo {
                    name: name.to_string(),
                    url,
                    is_github,
                    github_owner,
                    github_repo,
                });
            }
        }
    }

    if result.is_empty() {
        if let Ok(out) = run_git(repo, &["remote", "-v"]) {
            for line in out.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let name = parts[0];
                    let url = parts[1];
                    if seen_names.insert(name.to_string()) {
                        let (is_github, github_owner, github_repo) =
                            if let Some((owner, repo_name)) = parse_github_remote(url) {
                                (true, Some(owner), Some(repo_name))
                            } else {
                                (false, None, None)
                            };
                        result.push(GitRemoteInfo {
                            name: name.to_string(),
                            url: url.to_string(),
                            is_github,
                            github_owner,
                            github_repo,
                        });
                    }
                }
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn fetch_remote(
    state: State<'_, Mutex<AppState>>,
    remote_name: String,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let r_name = if remote_name.is_empty() {
        "origin"
    } else {
        &remote_name
    };
    run_git(repo, &["fetch", r_name])
}

#[tauri::command]
pub async fn add_git_remote(
    state: State<'_, Mutex<AppState>>,
    name: String,
    url: String,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let name_trimmed = name.trim();
    let url_trimmed = url.trim();
    if name_trimmed.is_empty() || url_trimmed.is_empty() {
        return Err("Remote name and URL are required".to_string());
    }
    run_git(repo, &["remote", "add", name_trimmed, url_trimmed])
}

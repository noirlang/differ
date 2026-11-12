//! Branch management: create, checkout, rename and delete.

use crate::*;

pub fn validate_branch_name(repo: &Repository, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    run_git(repo, &["check-ref-format", "--branch", name])
        .map(|_| ())
        .map_err(|_| format!("'{}' is not a valid branch name", name))
}

/// Splits "origin/feature/x" into ("origin", "feature/x") using the repo's
/// configured remotes (remote names may themselves contain slashes).
pub fn split_remote_branch(repo: &Repository, full: &str) -> Option<(String, String)> {
    let remotes = repo.remotes().ok()?;
    remotes
        .iter()
        .flatten()
        .filter(|r| full.starts_with(&format!("{}/", r)))
        .max_by_key(|r| r.len())
        .map(|r| (r.to_string(), full[r.len() + 1..].to_string()))
}

#[tauri::command]
pub async fn create_branch(
    state: State<'_, Mutex<AppState>>,
    name: String,
    start_point: Option<String>,
    checkout: bool,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let name = name.trim();
    validate_branch_name(repo, name)?;

    let start = start_point
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("HEAD");

    if checkout {
        run_git(repo, &["switch", "-c", name, start])
    } else {
        run_git(repo, &["branch", name, start])
    }
}

/// Checks out a local branch, or creates a tracking branch for a remote one.
#[tauri::command]
pub async fn checkout_branch(
    state: State<'_, Mutex<AppState>>,
    name: String,
    is_remote: bool,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    if !is_remote {
        return run_git(repo, &["switch", &name]);
    }

    let (_, local_name) = split_remote_branch(repo, &name)
        .ok_or_else(|| format!("Could not determine the remote of '{}'", name))?;

    if repo.find_branch(&local_name, BranchType::Local).is_ok() {
        // A local branch with that name already exists: just switch to it.
        run_git(repo, &["switch", &local_name])
    } else {
        run_git(repo, &["switch", "--track", &name])
    }
}

#[tauri::command]
pub async fn rename_branch(
    state: State<'_, Mutex<AppState>>,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let new_name = new_name.trim();
    validate_branch_name(repo, new_name)?;
    run_git(repo, &["branch", "-m", &old_name, new_name])
}

/// Deletes a local branch. Without `force`, git refuses to delete a branch
/// whose commits are not merged anywhere; the error is returned as-is so the
/// UI can ask the user whether to force it.
#[tauri::command]
pub async fn delete_branch(
    state: State<'_, Mutex<AppState>>,
    name: String,
    force: bool,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    if current_branch_name(repo).as_deref() == Some(name.as_str()) {
        return Err(
            "The current branch cannot be deleted. Switch to another branch first.".to_string(),
        );
    }
    run_git(repo, &["branch", if force { "-D" } else { "-d" }, &name])
}

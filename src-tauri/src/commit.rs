//! Creating commits.

use crate::*;

#[tauri::command]
pub async fn commit_changes(
    paths: Vec<String>,
    message: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    commit_changes_with_options(paths, message, None, None, None, None, None, None, state).await
}

#[tauri::command]
pub async fn commit_changes_with_options(
    paths: Vec<String>,
    message: String,
    author_name: Option<String>,
    author_email: Option<String>,
    gpg_key: Option<String>,
    sign_commit: Option<bool>,
    signed_off_by: Option<bool>,
    amend: Option<bool>,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let mut message = message.trim().to_string();

    let is_amend = amend == Some(true);

    if paths.is_empty() && !is_amend {
        return Err("Select at least one file to commit".to_string());
    }
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }

    if signed_off_by == Some(true) && !message.contains("Signed-off-by:") {
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

    if !paths.is_empty() {
        let mut add_args = vec!["add", "--"];
        add_args.extend(paths.iter().map(String::as_str));
        run_git(repo, &add_args)?;
    }

    let mut commit_args = vec!["commit"];

    if is_amend {
        commit_args.push("--amend");
    }

    if !paths.is_empty() {
        commit_args.push("--only");
    }

    commit_args.push("-m");
    commit_args.push(&message);

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

    if !paths.is_empty() {
        commit_args.push("--");
        commit_args.extend(paths.iter().map(String::as_str));
    }

    run_git(repo, &commit_args)
}

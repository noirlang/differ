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

mod models;
mod git_util;
mod http;
mod system;
mod repo;
mod commit;
mod sync;
mod merge;
mod ai;
mod settings;
mod github;
mod update;
mod editor;
mod secrets;
mod branches;
#[cfg(test)]
mod tests;

use models::*;
use git_util::*;
use http::*;
use system::*;
use repo::*;
use commit::*;
use sync::*;
use merge::*;
use ai::*;
use settings::*;
use github::*;
use update::*;
use editor::*;
use secrets::*;
use branches::*;

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
            is_git_repository,
            init_repository,
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
            get_merge_conflicts,
            resolve_conflicts,
            abort_in_progress,
            get_conflict_diff,
            get_repo_fingerprint,
            get_unmerged_commits,
            cherry_pick_commit,
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
            check_gh_auth,
            get_github_issues,
            get_github_prs,
            get_github_actions,
            get_action_log,
            get_app_version,
            check_app_update,
            get_pr_diff,
            get_pr_commits,
            merge_github_pr,
            get_pr_create_context,
            create_github_pr,
            get_secret_status,
            save_gemini_api_key,
            create_branch,
            checkout_branch,
            rename_branch,
            delete_branch,
            detect_installed_editors,
            open_in_editor,
            get_git_remotes,
            fetch_remote,
            add_git_remote,
            check_lm_studio_status,
            generate_ai_commit_message_lm_studio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

//! Shared data types passed between the backend and the frontend.

use crate::*;

pub struct AppState {
    pub repo: Option<Repository>,
    pub repo_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub parent_ids: Vec<String>,
    pub is_unpushed: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub commit_id: String,
    pub is_remote: bool,
    #[serde(default)]
    pub is_tag: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiffFile {
    pub old_path: String,
    pub new_path: String,
    pub status: String,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DiffLine {
    pub content: String,
    pub line_type: String, // "add", "delete", "context"
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileTreeEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileTreeEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub current_branch: String,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub branch_count: usize,
    pub commit_count: usize,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WorktreeFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SyncStatus {
    pub has_origin: bool,
    pub origin_url: Option<String>,
    pub current_branch: String,
    pub upstream: Option<String>,
    pub unpushed_count: usize,
    pub can_push: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub url: String,
    pub is_github: bool,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemInfo {
    pub os: String,
    pub distro: String,
    pub ram_gb: f32,
    pub gpu_name: String,
    pub vram_gb: f32,
    pub recommended_model: String,
    pub ollama_installed: bool,
    pub ollama_running: bool,
    pub installed_models: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LmStudioInfo {
    pub running: bool,
    pub models: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
    pub is_current: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GpgKey {
    pub key_id: String,
    pub uid: String,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitSettings {
    pub identities: Vec<GitIdentity>,
    pub gpg_keys: Vec<GpgKey>,
    pub current_name: String,
    pub current_email: String,
    pub current_signing_key: String,
    pub gpg_sign_enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmtpSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub from_email: String,
    pub to_email: String,
    pub use_tls: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssue {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub author: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub labels: Vec<String>,
    pub comments: u64,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubPr {
    pub number: u64,
    pub title: String,
    pub state: String,
    pub author: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub head_ref: String,
    pub base_ref: String,
    pub labels: Vec<String>,
    pub reviews: u64,
    pub is_draft: bool,
    pub mergeable: String,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubPrCommit {
    pub oid: String,
    pub message_headline: String,
    pub author_name: String,
    pub author_email: String,
    pub authors: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GithubAction {
    pub id: u64,
    pub name: String,
    pub status: String,
    pub conclusion: String,
    pub workflow_name: String,
    pub branch: String,
    pub event: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub head_commit_message: String,
    pub head_sha: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GhAuthStatus {
    pub authenticated: bool,
    pub user: String,
    pub token_scopes: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub tag_name: String,
    pub release_name: String,
    pub release_notes: String,
    pub html_url: String,
    pub has_update: bool,
    pub published_at: String,
    pub assets: Vec<ReleaseAsset>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEditor {
    pub id: String,
    pub name: String,
    pub cmd: String,
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

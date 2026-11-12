//! Commit search over the full history using `git log`.

use crate::*;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CommitSearch {
    /// Free text: matched against the commit message or the author.
    pub text: String,
    pub author: String,
    pub hash: String,
    pub path: String,
    pub since: String,
    pub until: String,
}

/// Which field the free text is matched against in one `git log` run.
#[derive(Clone, Copy, PartialEq)]
pub enum TextField {
    Message,
    Author,
}

/// Builds the `git log` arguments for a search. Patterns are literal
/// (`-F`) and case-insensitive. git ANDs `--grep` with `--author`, so free
/// text without an author filter is searched twice (message, then author)
/// and the results are merged by the caller.
pub fn build_search_args(
    search: &CommitSearch,
    text_field: TextField,
    branch: Option<&str>,
    limit: usize,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "log".into(),
        "--format=%H".into(),
        format!("--max-count={}", limit),
        "--regexp-ignore-case".into(),
        "--fixed-strings".into(),
    ];

    let text = search.text.trim();
    let author = search.author.trim();
    if !text.is_empty() {
        match text_field {
            TextField::Message => args.push(format!("--grep={}", text)),
            TextField::Author => args.push(format!("--author={}", text)),
        }
    }
    if !author.is_empty() {
        args.push(format!("--author={}", author));
    }
    if !search.since.trim().is_empty() {
        args.push(format!("--since={}", search.since.trim()));
    }
    if !search.until.trim().is_empty() {
        args.push(format!("--until={}", search.until.trim()));
    }

    match branch.map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => args.push(b.to_string()),
        None => args.push("--all".into()),
    }

    let path = search.path.trim();
    if !path.is_empty() {
        args.push("--".into());
        args.push(path.to_string());
    }
    args
}

/// Runs the search and returns matching commit ids, newest first.
pub fn search_commit_ids(
    repo: &Repository,
    search: &CommitSearch,
    branch: Option<&str>,
    limit: usize,
) -> Result<Vec<Oid>, String> {
    let mut fields = vec![TextField::Message];
    if !search.text.trim().is_empty() && search.author.trim().is_empty() {
        fields.push(TextField::Author);
    }

    let mut seen = HashSet::new();
    let mut found: Vec<(i64, Oid)> = Vec::new();
    for field in fields {
        let args = build_search_args(search, field, branch, limit);
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        for line in run_git(repo, &arg_refs)?.lines() {
            let Ok(oid) = Oid::from_str(line.trim()) else { continue };
            if seen.insert(oid) {
                let time = repo.find_commit(oid).map(|c| c.time().seconds()).unwrap_or(0);
                found.push((time, oid));
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.truncate(limit);
    Ok(found.into_iter().map(|(_, oid)| oid).collect())
}

#[tauri::command]
pub async fn search_commits(
    state: State<'_, Mutex<AppState>>,
    search: CommitSearch,
    branch: Option<String>,
    target_remote: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<CommitInfo>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
    let unpushed = unpushed_oids(repo, branch.as_deref(), target_remote.as_deref());

    let hash = search.hash.trim();
    if !hash.is_empty() {
        // A hash (or prefix) identifies one commit; other filters don't apply.
        return Ok(match repo.revparse_single(hash).and_then(|o| o.peel_to_commit()) {
            Ok(commit) => vec![commit_info(repo, commit.id(), &unpushed)?],
            Err(_) => Vec::new(),
        });
    }

    let limit = limit.unwrap_or(500).min(5000);
    search_commit_ids(repo, &search, branch.as_deref(), limit)?
        .into_iter()
        .map(|oid| commit_info(repo, oid, &unpushed))
        .collect()
}

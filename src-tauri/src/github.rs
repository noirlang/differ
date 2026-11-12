//! GitHub integration through the gh CLI.

use crate::*;

pub fn run_gh(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new("gh");
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.args(args);
    let output = cmd
        .output()
        .map_err(|e| format!("gh CLI not found or failed: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

#[tauri::command]
pub async fn check_gh_auth(state: State<'_, Mutex<AppState>>) -> Result<GhAuthStatus, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);

    let status_out = run_gh(&["auth", "status", "--hostname", "github.com"], cwd);
    match status_out {
        Err(e) => {
            if e.contains("not logged into")
                || e.contains("not authenticated")
                || e.contains("You are not logged")
            {
                Ok(GhAuthStatus {
                    authenticated: false,
                    user: String::new(),
                    token_scopes: vec![],
                })
            } else {
                Ok(GhAuthStatus {
                    authenticated: false,
                    user: String::new(),
                    token_scopes: vec![],
                })
            }
        }
        Ok(out) => {
            let authenticated = out.contains("Logged in")
                || out.contains("✓ Logged in")
                || out.contains("github.com");
            let user = out
                .lines()
                .find(|l| l.contains("Logged in to") || l.contains("account") || l.contains("as "))
                .and_then(|l| l.split_whitespace().last())
                .unwrap_or("")
                .trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                .to_string();
            Ok(GhAuthStatus {
                authenticated,
                user,
                token_scopes: vec![],
            })
        }
    }
}

#[tauri::command]
pub async fn get_github_issues(
    state: State<'_, Mutex<AppState>>,
    filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GithubIssue>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let limit_str = limit.unwrap_or(30).to_string();
    let filter_str = filter.as_deref().unwrap_or("all");

    let out = run_gh(
        &[
            "issue",
            "list",
            "--state",
            filter_str,
            "--limit",
            &limit_str,
            "--json",
            "number,title,state,author,createdAt,updatedAt,url,labels,comments,body",
        ],
        cwd,
    )?;

    let raw: Vec<serde_json::Value> = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let issues = raw
        .iter()
        .map(|v| GithubIssue {
            number: v["number"].as_u64().unwrap_or(0),
            title: v["title"].as_str().unwrap_or("").to_string(),
            state: v["state"].as_str().unwrap_or("").to_lowercase(),
            author: v["author"]["login"].as_str().unwrap_or("").to_string(),
            created_at: v["createdAt"].as_str().unwrap_or("").to_string(),
            updated_at: v["updatedAt"].as_str().unwrap_or("").to_string(),
            url: v["url"].as_str().unwrap_or("").to_string(),
            labels: v["labels"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| l["name"].as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            comments: v["comments"].as_u64().unwrap_or(0),
            body: v["body"].as_str().unwrap_or("").chars().take(300).collect(),
        })
        .collect();
    Ok(issues)
}

#[tauri::command]
pub async fn get_github_prs(
    state: State<'_, Mutex<AppState>>,
    filter: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<GithubPr>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let limit_str = limit.unwrap_or(30).to_string();
    let filter_str = filter.as_deref().unwrap_or("open");

    let out = run_gh(
        &[
            "pr", "list",
            "--state", filter_str,
            "--limit", &limit_str,
            "--json", "number,title,state,author,createdAt,updatedAt,url,headRefName,baseRefName,labels,reviews,isDraft,mergeable,body",
        ],
        cwd,
    )?;

    let raw: Vec<serde_json::Value> = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let prs = raw
        .iter()
        .map(|v| GithubPr {
            number: v["number"].as_u64().unwrap_or(0),
            title: v["title"].as_str().unwrap_or("").to_string(),
            state: v["state"].as_str().unwrap_or("").to_lowercase(),
            author: v["author"]["login"].as_str().unwrap_or("").to_string(),
            created_at: v["createdAt"].as_str().unwrap_or("").to_string(),
            updated_at: v["updatedAt"].as_str().unwrap_or("").to_string(),
            url: v["url"].as_str().unwrap_or("").to_string(),
            head_ref: v["headRefName"].as_str().unwrap_or("").to_string(),
            base_ref: v["baseRefName"].as_str().unwrap_or("").to_string(),
            labels: v["labels"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| l["name"].as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            reviews: v["reviews"].as_array().map(|r| r.len() as u64).unwrap_or(0),
            is_draft: v["isDraft"].as_bool().unwrap_or(false),
            mergeable: v["mergeable"].as_str().unwrap_or("").to_string(),
            body: v["body"].as_str().unwrap_or("").chars().take(300).collect(),
        })
        .collect();
    Ok(prs)
}

#[tauri::command]
pub async fn get_github_actions(
    state: State<'_, Mutex<AppState>>,
    limit: Option<u32>,
    branch: Option<String>,
) -> Result<Vec<GithubAction>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let limit_str = limit.unwrap_or(20).to_string();

    let mut gh_args = vec![
        "run", "list",
        "--limit", &limit_str,
        "--json", "databaseId,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,updatedAt,url,headSha,number",
    ];

    let branch_owned = branch.unwrap_or_default();
    if !branch_owned.is_empty() {
        gh_args.push("--branch");
        gh_args.push(&branch_owned);
    }

    let out = run_gh(&gh_args, cwd)?;

    let raw: Vec<serde_json::Value> = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let actions = raw
        .iter()
        .map(|v| GithubAction {
            id: v["databaseId"].as_u64().unwrap_or(0),
            name: v["displayTitle"].as_str().unwrap_or("").to_string(),
            status: v["status"].as_str().unwrap_or("").to_lowercase(),
            conclusion: v["conclusion"].as_str().unwrap_or("").to_string(),
            workflow_name: v["workflowName"].as_str().unwrap_or("").to_string(),
            branch: v["headBranch"].as_str().unwrap_or("").to_string(),
            event: v["event"].as_str().unwrap_or("").to_string(),
            created_at: v["createdAt"].as_str().unwrap_or("").to_string(),
            updated_at: v["updatedAt"].as_str().unwrap_or("").to_string(),
            url: v["url"].as_str().unwrap_or("").to_string(),
            head_commit_message: v["displayTitle"].as_str().unwrap_or("").to_string(),
            head_sha: v["headSha"]
                .as_str()
                .unwrap_or("")
                .chars()
                .take(7)
                .collect(),
        })
        .collect();
    Ok(actions)
}

#[tauri::command]
pub async fn get_pr_diff(state: State<'_, Mutex<AppState>>, pr_number: u64) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let num_str = pr_number.to_string();
    run_gh(&["pr", "diff", &num_str], cwd)
}

#[tauri::command]
pub async fn get_pr_commits(
    state: State<'_, Mutex<AppState>>,
    pr_number: u64,
) -> Result<Vec<GithubPrCommit>, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let num_str = pr_number.to_string();
    let out = run_gh(&["pr", "view", &num_str, "--json", "commits"], cwd)?;

    let v: serde_json::Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    if let Some(arr) = v["commits"].as_array() {
        for item in arr {
            let oid = item["oid"].as_str().unwrap_or("").to_string();
            let message_headline = item["messageHeadline"].as_str().unwrap_or("").to_string();
            let authors_arr = item["authors"].as_array();
            let mut author_name = String::new();
            let mut author_email = String::new();
            let mut authors_list = Vec::new();
            if let Some(auths) = authors_arr {
                for a in auths {
                    let name = a["name"]
                        .as_str()
                        .or_else(|| a["login"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let email = a["email"].as_str().unwrap_or("").to_string();
                    if author_name.is_empty() {
                        author_name = name.clone();
                        author_email = email.clone();
                    }
                    authors_list.push(name);
                }
            }
            list.push(GithubPrCommit {
                oid,
                message_headline,
                author_name,
                author_email,
                authors: authors_list,
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn merge_github_pr(
    state: State<'_, Mutex<AppState>>,
    pr_number: u64,
    merge_method: Option<String>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let num_str = pr_number.to_string();
    let method = merge_method.unwrap_or_else(|| "merge".to_string());

    let method_flag = match method.as_str() {
        "squash" => "--squash",
        "rebase" => "--rebase",
        _ => "--merge",
    };

    run_gh(
        &[
            "pr",
            "merge",
            &num_str,
            method_flag,
            "--delete-branch=false",
        ],
        cwd,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCreateContext {
    pub current_branch: String,
    pub default_branch: String,
    pub branches: Vec<String>,
}

#[tauri::command]
pub async fn get_pr_create_context(
    state: State<'_, Mutex<AppState>>,
) -> Result<PrCreateContext, String> {
    let (repo_path, current_branch) = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
        (
            app_state.repo_path.clone(),
            current_branch_name(repo).unwrap_or_default(),
        )
    };
    let cwd = repo_path.as_deref().map(Path::new);

    let default_branch = run_gh(
        &["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
        cwd,
    )
    .unwrap_or_else(|_| "main".to_string());

    let branches_out = run_gh(
        &["api", "repos/{owner}/{repo}/branches", "--paginate", "-q", ".[].name"],
        cwd,
    )
    .unwrap_or_default();
    let mut branches: Vec<String> = branches_out
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    if !branches.contains(&default_branch) {
        branches.insert(0, default_branch.clone());
    }

    Ok(PrCreateContext {
        current_branch,
        default_branch,
        branches,
    })
}

#[tauri::command]
pub async fn create_github_pr(
    state: State<'_, Mutex<AppState>>,
    base: String,
    head: String,
    title: String,
    body: String,
    draft: bool,
) -> Result<String, String> {
    if title.trim().is_empty() {
        return Err("PR title cannot be empty".to_string());
    }
    if base == head {
        return Err("Base and head branches must be different".to_string());
    }
    let repo_path = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        app_state.repo_path.clone()
    };
    let cwd = repo_path.as_deref().map(Path::new);

    let mut args = vec![
        "pr", "create", "--base", &base, "--head", &head, "--title", &title, "--body", &body,
    ];
    if draft {
        args.push("--draft");
    }
    // gh prints the new PR URL on stdout
    run_gh(&args, cwd)
}

#[tauri::command]
pub async fn get_action_log(state: State<'_, Mutex<AppState>>, run_id: u64) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);
    let id_str = run_id.to_string();
    run_gh(&["run", "view", &id_str, "--log"], cwd)
}

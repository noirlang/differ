//! AI commit message generation (Ollama, LM Studio, Gemini).

use crate::*;

pub fn check_ollama_cli_and_daemon() -> (bool, bool, Vec<String>) {
    let mut installed = false;
    let mut running = false;
    let mut models = Vec::new();

    let mut cmd = Command::new("ollama");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd.arg("--version").output() {
        if output.status.success() {
            installed = true;
        }
    }

    if let Ok(response) = send_plain_http_request(
        "127.0.0.1:11434",
        "127.0.0.1:11434",
        "GET",
        "/api/tags",
        &[],
        None,
        Duration::from_secs(2),
    ) {
        if is_success_status(response.status_code) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                running = true;
                installed = true;
                if let Some(model_list) = json.get("models").and_then(|m| m.as_array()) {
                    for m in model_list {
                        if let Some(name) = m.get("name").and_then(|n| n.as_str()) {
                            models.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    (installed, running, models)
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let (os, distro) = detect_os_and_distro();
    let ram_gb = detect_ram_gb();
    let (gpu_name, vram_gb) = detect_gpu_and_vram();
    let (ollama_installed, ollama_running, installed_models) = check_ollama_cli_and_daemon();

    // Default top recommendation requested by user: gemma4:12b
    let recommended_model = if ram_gb >= 12.0 || vram_gb >= 8.0 {
        "gemma4:12b".to_string()
    } else if ram_gb >= 8.0 || vram_gb >= 4.0 {
        "gemma2:9b".to_string()
    } else {
        "gemma:2b".to_string()
    };

    Ok(SystemInfo {
        os,
        distro,
        ram_gb,
        gpu_name,
        vram_gb,
        recommended_model,
        ollama_installed,
        ollama_running,
        installed_models,
    })
}

#[tauri::command]
pub async fn check_ollama_status() -> Result<SystemInfo, String> {
    get_system_info().await
}

#[tauri::command]
pub async fn install_ollama() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://ollama.com/install.sh | sh")
            .output()
            .map_err(|e| format!("Failed to run install script: {}", e))?;

        if output.status.success() {
            Ok("Ollama installed successfully.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(if !stderr.is_empty() { stderr } else { stdout })
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("powershell");
        cmd.creation_flags(CREATE_NO_WINDOW);
        let output = cmd
            .args(&[
                "-Command",
                "winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements",
            ])
            .output()
            .map_err(|e| format!("Failed to execute winget: {}", e))?;

        if output.status.success() {
            Ok("Ollama installed successfully via winget.".to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(stderr)
        }
    }
}

#[tauri::command]
pub async fn pull_ollama_model(model_name: String) -> Result<String, String> {
    let model = model_name.trim();
    if model.is_empty() {
        return Err("Model name cannot be empty".to_string());
    }

    let mut cmd = Command::new("ollama");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .args(&["pull", model])
        .output()
        .map_err(|e| format!("Failed to execute ollama pull: {}", e))?;

    if output.status.success() {
        Ok(format!("Model {} pulled successfully.", model))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else { stdout })
    }
}

#[tauri::command]
pub async fn check_lm_studio_status() -> Result<LmStudioInfo, String> {
    let mut running = false;
    let mut models = Vec::new();

    if let Ok(response) = send_plain_http_request(
        "127.0.0.1:1234",
        "127.0.0.1:1234",
        "GET",
        "/v1/models",
        &[],
        None,
        Duration::from_secs(2),
    ) {
        if is_success_status(response.status_code) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
                running = true;
                if let Some(data_list) = json.get("data").and_then(|d| d.as_array()) {
                    for m in data_list {
                        if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                            models.push(id.to_string());
                        }
                    }
                }
            }
        }
    }

    Ok(LmStudioInfo { running, models })
}

#[tauri::command]
pub async fn generate_ai_commit_message_lm_studio(
    diff: Option<String>,
    paths: Option<Vec<String>>,
    model: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut actual_diff = diff.unwrap_or_default();

    if actual_diff.trim().is_empty() {
        let diff_result = {
            let app_state = state.lock().map_err(|e| e.to_string())?;
            if let Some(repo) = app_state.repo.as_ref() {
                let mut diff_builder = String::new();
                if let Some(p_vec) = &paths {
                    if !p_vec.is_empty() {
                        for path in p_vec {
                            let d_head =
                                run_git(repo, &["diff", "HEAD", "--", path]).unwrap_or_default();
                            if !d_head.trim().is_empty() {
                                diff_builder.push_str(&d_head);
                                diff_builder.push('\n');
                            } else {
                                let d_staged = run_git(repo, &["diff", "--cached", "--", path])
                                    .unwrap_or_default();
                                if !d_staged.trim().is_empty() {
                                    diff_builder.push_str(&d_staged);
                                    diff_builder.push('\n');
                                } else {
                                    if let Some(workdir) = repo.workdir() {
                                        let full_path = workdir.join(path);
                                        if full_path.exists() && full_path.is_file() {
                                            if let Ok(content) = std::fs::read_to_string(&full_path)
                                            {
                                                let snippet: String = content
                                                    .lines()
                                                    .take(40)
                                                    .collect::<Vec<_>>()
                                                    .join("\n");
                                                diff_builder.push_str(&format!(
                                                    "+++ Added untracked file {}\n{}\n",
                                                    path, snippet
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                    }
                } else {
                    diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                }
                Some(diff_builder)
            } else {
                None
            }
        };
        if let Some(d) = diff_result {
            actual_diff = d;
        }
    }

    if actual_diff.trim().is_empty() {
        return Err("No diff or changed files found for selected items.".to_string());
    }

    if actual_diff.len() > 6000 {
        actual_diff.truncate(6000);
        actual_diff.push_str("\n...[diff truncated for length]");
    }

    let raw_model = model.unwrap_or_else(|| "local-model".to_string());
    let model_name = raw_model.trim().to_string();

    let prompt = format!(
        "You are a commit message generator. Output ONLY the commit message line. Nothing else.

Rules:
- Output exactly ONE line in format: type(scope): description
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Scope is optional, use only if the change clearly belongs to a specific module
- Description must be imperative mood, lowercase first letter, no period at end
- Max 72 characters total
- Do NOT include any explanation, reasoning, markdown, backticks, quotes, or multiple options
- Do NOT start with Here is, This commit, Based on, The diff, Option, Let me, I will

Diff:
{}",
        actual_diff
    );

    let payload = serde_json::json!({
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": "You are a commit message generator. Output ONLY the commit message line. No explanations, no reasoning, no markdown, no backticks."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.2,
        "stream": false
    });

    let payload_str = payload.to_string();

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_plain_http_request(
            "127.0.0.1:1234",
            "127.0.0.1:1234",
            "POST",
            "/v1/chat/completions",
            &[("Content-Type".to_string(), "application/json".to_string())],
            Some(&payload_str),
            Duration::from_secs(90),
        )
        .map_err(|e| format!("LM Studio HTTP request error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    if is_success_status(response.status_code) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response.body) {
            if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                let trimmed = content.trim().trim_matches('`').trim_matches('"').trim();
                let first_line = trimmed.lines().next().unwrap_or(trimmed).trim();
                if !first_line.is_empty() {
                    return Ok(first_line.to_string());
                }
            }
        }
    }

    Err("Failed to generate commit message via LM Studio. Make sure LM Studio local server is running on http://127.0.0.1:1234 and a model is loaded.".to_string())
}

#[tauri::command]
pub async fn generate_ai_commit_message(
    diff: Option<String>,
    paths: Option<Vec<String>>,
    model: Option<String>,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut actual_diff = diff.unwrap_or_default();

    if actual_diff.trim().is_empty() {
        let diff_result = {
            let app_state = state.lock().map_err(|e| e.to_string())?;
            if let Some(repo) = app_state.repo.as_ref() {
                let mut diff_builder = String::new();
                if let Some(p_vec) = &paths {
                    if !p_vec.is_empty() {
                        for path in p_vec {
                            let d_head =
                                run_git(repo, &["diff", "HEAD", "--", path]).unwrap_or_default();
                            if !d_head.trim().is_empty() {
                                diff_builder.push_str(&d_head);
                                diff_builder.push('\n');
                            } else {
                                let d_staged = run_git(repo, &["diff", "--cached", "--", path])
                                    .unwrap_or_default();
                                if !d_staged.trim().is_empty() {
                                    diff_builder.push_str(&d_staged);
                                    diff_builder.push('\n');
                                } else {
                                    if let Some(workdir) = repo.workdir() {
                                        let full_path = workdir.join(path);
                                        if full_path.exists() && full_path.is_file() {
                                            if let Ok(content) = std::fs::read_to_string(&full_path)
                                            {
                                                let snippet: String = content
                                                    .lines()
                                                    .take(40)
                                                    .collect::<Vec<_>>()
                                                    .join("\n");
                                                diff_builder.push_str(&format!(
                                                    "+++ Added untracked file {}\n{}\n",
                                                    path, snippet
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                    }
                } else {
                    diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                }
                Some(diff_builder)
            } else {
                None
            }
        }; // Mutex dropped here!
        if let Some(d) = diff_result {
            actual_diff = d;
        }
    }

    if actual_diff.trim().is_empty() {
        return Err("No diff or changed files found for selected items.".to_string());
    }

    if actual_diff.len() > 6000 {
        actual_diff.truncate(6000);
        actual_diff.push_str("\n...[diff truncated for length]");
    }

    let raw_model = model.unwrap_or_else(|| "gemma4:12b".to_string());
    let model_name = raw_model
        .split_whitespace()
        .next()
        .unwrap_or("gemma4:12b")
        .to_string();

    let prompt = format!(
        "You are a commit message generator. Output ONLY the commit message line. Nothing else.

Rules:
- Output exactly ONE line in format: type(scope): description
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Scope is optional, use only if the change clearly belongs to a specific module
- Description must be imperative mood, lowercase first letter, no period at end
- Max 72 characters total
- Do NOT include any explanation, reasoning, markdown, backticks, quotes, or multiple options
- Do NOT start with Here is, This commit, Based on, The diff, Option, Let me, I will
- Do NOT include any text before or after the commit line
- If unsure about scope, omit it: feat: add user authentication

Diff:
{}",
        actual_diff
    );

    let payload = serde_json::json!({
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": "You are a commit message generator. Output ONLY the commit message line. No explanations, no reasoning, no markdown, no backticks."
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "stream": false,
        "options": {
            "num_ctx": 4096,
            "temperature": 0.2,
            "top_p": 0.9,
            "repeat_penalty": 1.3
        }
    });

    let payload_str = payload.to_string();

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_plain_http_request(
            "127.0.0.1:11434",
            "127.0.0.1:11434",
            "POST",
            "/api/chat",
            &[("Content-Type".to_string(), "application/json".to_string())],
            Some(&payload_str),
            Duration::from_secs(90),
        )
        .map_err(|e| format!("Ollama request execution error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let resp_str = response.body;

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&resp_str) {
        if let Some(err_msg) = json.get("error").and_then(|e| e.as_str()) {
            return Err(format!("Ollama Model Error: {}", err_msg));
        }

        let mut combined = String::new();

        // 1. First priority: assistant message.content
        if let Some(msg_obj) = json.get("message") {
            if let Some(c) = msg_obj.get("content").and_then(|c| c.as_str()) {
                if !c.trim().is_empty() {
                    combined.push_str(c);
                    combined.push('\n');
                }
            }
        }

        // 2. Second priority: top-level response field
        if combined.trim().is_empty() {
            if let Some(r) = json.get("response").and_then(|r| r.as_str()) {
                if !r.trim().is_empty() {
                    combined.push_str(r);
                    combined.push('\n');
                }
            }
        }

        // 3. Fallback: message.thinking field (only if content is completely empty)
        if combined.trim().is_empty() {
            if let Some(msg_obj) = json.get("message") {
                if let Some(th) = msg_obj.get("thinking").and_then(|t| t.as_str()) {
                    combined.push_str(th);
                    combined.push('\n');
                }
            }
        }

        let types = [
            "feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore",
        ];
        let raw_lines: Vec<&str> = combined.lines().collect();

        // Comprehensive blacklist of conversational/meta phrases produced by reasoning models
        let is_meta = |s: &str| -> bool {
            let l = s.to_lowercase().trim().to_string();
            if l.is_empty() || l.len() < 8 {
                return true;
            }
            // Lines that are clearly not commit messages
            l.contains("specifically")
                || l.contains("they involve")
                || l.contains("this diff")
                || l.contains("in summary")
                || l.contains("input:")
                || l.contains("file:")
                || l.contains("option ")
                || l.contains("let's look")
                || l.contains("lets look")
                || l.contains("look at the content")
                || l.contains("here is a commit")
                || l.contains("it adds new")
                || l.contains("this commit")
                || l.contains("based on")
                || l.contains("the change")
                || l.contains("the code")
                || l.contains("the diff shows")
                || l.contains("i will")
                || l.contains("we need")
                || l.contains("we should")
                || l.contains("we can")
                || l.contains("the file")
                || l.contains("a new ")
                || l.contains("added ")
                || l.contains("removes ")
                || l.contains("updates ")
                || l.contains("modifies ")
                || l.contains("introduces ")
                || l.contains("implements ")
                || l.contains("creates ")
                || l.contains("refactors ")
                || l.contains("improves ")
                || l.contains("enhances ")
                || l.contains("changes ")
                || l.contains("removes ")
                || l.contains("deletes ")
                || l.contains("fixes ")
                || l.contains("resolves ")
                || l.contains("adds a ")
                || l.contains("adds the ")
                || l.contains("adds support")
                || l.contains("adds new ")
                || l.contains("adds a new")
                || l.contains("removes the ")
                || l.contains("updates the ")
                || l.contains("modifies the ")
                || l.contains("introduces a ")
                || l.contains("implements a ")
                || l.contains("creates a ")
                || l.contains("refactors the ")
                || l.contains("improves the ")
                || l.contains("enhances the ")
                || l.contains("the changes")
                || l.contains("this change")
                || l.contains("this file")
                || l.contains("this code")
                || l.contains("this pr")
                || l.contains("this pull")
                || l.contains("the commit")
                || l.contains("summary:")
                || l.contains("description:")
                || l.contains("explanation:")
                || l.contains("reasoning:")
                || l.contains("analysis:")
                || l.contains("thinking:")
                || l.contains("step ")
                || l.contains("first,")
                || l.contains("second,")
                || l.contains("third,")
                || l.contains("finally,")
                || l.contains("note:")
                || l.contains("important:")
                || l.contains("warning:")
                || l.contains("tip:")
                || l.contains("hint:")
                || l.contains("example:")
                || l.contains("e.g.")
                || l.contains("i.e.")
                || l.contains("etc.")
                || l.contains("see ")
                || l.contains("ref ")
                || l.contains("refer")
                || l.contains("http")
                || l.contains("url")
                || l.contains("link")
                || l.contains("test")
                || l.contains("todo")
                || l.contains("fixme")
                || l.contains("hack")
                || l.contains("workaround")
                || l.contains("temp ")
                || l.contains("temporary")
                || l.contains("note that")
                || l.contains("please ")
                || l.contains("make sure")
                || l.contains("ensure that")
                || l.contains("as shown")
                || l.contains("as described")
                || l.contains("as mentioned")
                || l.contains("according to")
                || l.contains("in order to")
                || l.contains("for the purpose")
                || l.contains("with respect to")
                || l.contains("in terms of")
                || l.contains("on the other hand")
                || l.contains("in addition")
                || l.contains("furthermore")
                || l.contains("moreover")
                || l.contains("additionally")
                || l.contains("consequently")
                || l.contains("therefore")
                || l.contains("thus ")
                || l.contains("hence ")
                || l.contains("however ")
                || l.contains("nevertheless")
                || l.contains("nonetheless")
                || l.contains("despite ")
                || l.contains("although ")
                || l.contains("while ")
                || l.contains("since ")
                || l.contains("because ")
                || l.contains("due to")
                || l.contains("as a result")
                || l.contains("in conclusion")
                || l.contains("to summarize")
                || l.contains("in brief")
                || l.contains("in short")
                || l.contains("basically")
                || l.contains("essentially")
                || l.contains("overall ")
                || l.contains("in general")
                || l.contains("for example")
                || l.contains("for instance")
                || l.contains("such as ")
                || l.contains("namely ")
                || l.contains("specifically ")
                || l.contains("particularly ")
                || l.contains("especially ")
                || l.contains("mainly ")
                || l.contains("primarily ")
                || l.contains("chiefly ")
                || l.contains("principally ")
                || l.contains("essentially ")
                || l.contains("fundamentally ")
                || l.contains("basically ")
                || l.contains("simply ")
                || l.contains("merely ")
                || l.contains("just ")
                || l.contains("only ")
                || l.contains("the purpose")
                || l.contains("the goal")
                || l.contains("the objective")
                || l.contains("the intention")
                || l.contains("the aim")
                || l.contains("the intent")
                || l.contains("this is a")
                || l.contains("this pull request")
                || l.contains("this merge request")
                || l.contains("this issue")
                || l.contains("this feature")
                || l.contains("this bug")
                || l.contains("this fix")
                || l.contains("this update")
                || l.contains("this improvement")
                || l.contains("this enhancement")
                || l.contains("this refactor")
                || l.contains("this change")
                || l.contains("this modification")
                || l.contains("this patch")
                || l.contains("this commit")
                || l.contains("this diff")
                || l.contains("the following")
                || l.contains("below is")
                || l.contains("above is")
                || l.contains("here's")
                || l.contains("here is")
                || l.contains("here are")
                || l.contains("let me")
                || l.contains("let us")
                || l.contains("i'll ")
                || l.contains("i will ")
                || l.contains("we'll ")
                || l.contains("we will ")
                || l.contains("you can")
                || l.contains("you should")
                || l.contains("you may")
                || l.contains("you might")
                || l.contains("it is ")
                || l.contains("it's ")
                || l.contains("there is ")
                || l.contains("there are ")
                || l.contains("there were ")
                || l.contains("there was ")
                || l.contains("this was ")
                || l.contains("these were ")
                || l.contains("those were ")
                || l.contains("the commit message")
                || l.contains("the git commit")
                || l.contains("a commit message")
                || l.contains("an appropriate")
                || l.contains("a suitable")
                || l.contains("a proper")
                || l.contains("a good")
                || l.contains("a better")
                || l.contains("a more")
                || l.contains("a concise")
                || l.contains("a clear")
                || l.contains("a descriptive")
                || l.contains("a meaningful")
                || l.contains("a relevant")
                || l.contains("an accurate")
                || l.contains("an informative")
                || l.contains("an effective")
                || l.contains("an appropriate commit")
        };

        // Helper closure to clean candidate string
        let clean_candidate = |line: &str| -> String {
            let mut cleaned = line.trim();
            // Strip leading markdown/quote/bullet chars
            while cleaned.starts_with('*')
                || cleaned.starts_with('-')
                || cleaned.starts_with('`')
                || cleaned.starts_with('"')
                || cleaned.starts_with('\'')
                || cleaned.starts_with('#')
                || cleaned.starts_with('>')
                || cleaned.starts_with('[')
            {
                cleaned = cleaned
                    .trim_start_matches('*')
                    .trim_start_matches('-')
                    .trim_start_matches('`')
                    .trim_start_matches('"')
                    .trim_start_matches('\'')
                    .trim_start_matches('#')
                    .trim_start_matches('>')
                    .trim_start_matches('[')
                    .trim();
            }
            // Strip trailing markdown/quote chars
            while cleaned.ends_with('}')
                || cleaned.ends_with('`')
                || cleaned.ends_with('"')
                || cleaned.ends_with('\'')
                || cleaned.ends_with('.')
                || cleaned.ends_with(')')
                || cleaned.ends_with(']')
            {
                cleaned = cleaned
                    .trim_end_matches('}')
                    .trim_end_matches('`')
                    .trim_end_matches('"')
                    .trim_end_matches('\'')
                    .trim_end_matches('.')
                    .trim_end_matches(')')
                    .trim_end_matches(']')
                    .trim();
            }

            // Strip Option/Title/Result prefixes
            if let Some(pos) = cleaned.find(':') {
                let prefix = cleaned[..pos].trim().to_lowercase();
                if prefix.starts_with("option")
                    || prefix.starts_with("choice")
                    || prefix == "title"
                    || prefix == "result"
                    || prefix == "output"
                    || prefix == "commit"
                    || prefix == "message"
                    || prefix == "answer"
                    || prefix == "response"
                    || prefix == "suggestion"
                    || prefix == "recommended"
                {
                    cleaned = cleaned[pos + 1..].trim();
                }
            }

            // Strip backtick formatting inside output like `feat(ui): ...`
            if cleaned.starts_with('`') && cleaned.ends_with('`') && cleaned.len() > 2 {
                cleaned = &cleaned[1..cleaned.len() - 1];
            }

            // Strip "scope:" patterns that are redundant
            // e.g. "scope: ui" -> skip if no type prefix

            cleaned.to_string()
        };

        let strip_duplicate_prefixes = |mut input: String| -> String {
            loop {
                let mut changed = false;
                let lower = input.to_lowercase();
                for t1 in &types {
                    let p1_colon = format!("{}:", t1);
                    let p1_paren = format!("{}(", t1);
                    let has_p1 = lower.starts_with(&p1_colon) || lower.starts_with(&p1_paren);

                    if has_p1 {
                        let rest_offset = if lower.starts_with(&p1_colon) {
                            p1_colon.len()
                        } else {
                            if let Some(close_paren) = input.find("):") {
                                close_paren + 2
                            } else {
                                0
                            }
                        };

                        if rest_offset > 0 && rest_offset < input.len() {
                            let rest = input[rest_offset..].trim();
                            let rest_lower = rest.to_lowercase();
                            for t2 in &types {
                                if rest_lower.starts_with(&format!("{}:", t2))
                                    || rest_lower.starts_with(&format!("{}(", t2))
                                {
                                    input = rest.to_string();
                                    changed = true;
                                    break;
                                }
                            }
                        }
                    }
                    if changed {
                        break;
                    }
                }
                if !changed {
                    break;
                }
            }
            input
        };

        // Validate that a string looks like a proper conventional commit
        let is_valid_conventional_commit = |s: &str| -> bool {
            let lower = s.to_lowercase();
            let has_type = types.iter().any(|t| {
                lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t))
            });
            if !has_type {
                return false;
            }
            // Must have content after "type: " or "type(scope): "
            let after_prefix = if let Some(pos) = s.find("):") {
                s[pos + 2..].trim()
            } else if let Some(pos) = s.find(':') {
                s[pos + 1..].trim()
            } else {
                ""
            };
            !after_prefix.is_empty() && after_prefix.len() >= 3
        };

        // Pass 1: Search bottom-up for a line that is already a valid conventional commit
        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);

            if is_meta(&cleaned) {
                continue;
            }

            if is_valid_conventional_commit(&cleaned) {
                let mut result = strip_duplicate_prefixes(cleaned);
                if result.len() > 72 {
                    let header_end = result.find(':').map(|i| i + 1).unwrap_or(0);
                    if let Some(last_space) = result[..72].rfind(' ') {
                        if last_space > header_end {
                            result.truncate(last_space);
                        } else {
                            result.truncate(72);
                        }
                    } else {
                        result.truncate(72);
                    }
                }
                return Ok(result);
            }
        }

        // Pass 2: Search for any line starting with a type prefix (even if not fully valid)
        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            let lower = cleaned.to_lowercase();

            if is_meta(&cleaned) {
                continue;
            }

            for t in &types {
                if lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t)) {
                    let mut result = strip_duplicate_prefixes(cleaned);
                    if result.len() > 72 {
                        let header_end = result.find(':').map(|i| i + 1).unwrap_or(0);
                        if let Some(last_space) = result[..72].rfind(' ') {
                            if last_space > header_end {
                                result.truncate(last_space);
                            } else {
                                result.truncate(72);
                            }
                        } else {
                            result.truncate(72);
                        }
                    }
                    return Ok(result);
                }
            }
        }

        // Pass 3: Last resort - find the most "commit-like" line and try to salvage it
        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            if cleaned.is_empty() || is_meta(&cleaned) || cleaned.len() < 10 {
                continue;
            }

            // Heuristic: pick the line that looks most like a subject line
            // (short, no sentences, no commas, no complex structure)
            let lower = cleaned.to_lowercase();
            let word_count = cleaned.split_whitespace().count();
            let has_period = cleaned.contains('.');
            let has_comma = cleaned.contains(',');
            let looks_like_subject = word_count <= 10
                && !has_period
                && !has_comma
                && !lower.starts_with("the ")
                && !lower.starts_with("a ")
                && !lower.starts_with("an ")
                && !lower.starts_with("this ")
                && !lower.starts_with("it ");

            if !looks_like_subject {
                continue;
            }

            // Guess the type from keywords
            let prefix = if lower.contains("fix")
                || lower.contains("bug")
                || lower.contains("error")
                || lower.contains("crash")
                || lower.contains("overflow")
                || lower.contains("null")
                || lower.contains("panic")
            {
                "fix: "
            } else if lower.contains("style")
                || lower.contains("css")
                || lower.contains("format")
                || lower.contains("lint")
                || lower.contains("whitespace")
                || lower.contains("indent")
            {
                "style: "
            } else if lower.contains("test") || lower.contains("spec") || lower.contains("assert") {
                "test: "
            } else if lower.contains("doc")
                || lower.contains("readme")
                || lower.contains("comment")
                || lower.contains("typo")
            {
                "docs: "
            } else if lower.contains("remove")
                || lower.contains("delete")
                || lower.contains("clean")
                || lower.contains("deprecat")
            {
                "chore: "
            } else if lower.contains("perf")
                || lower.contains("speed")
                || lower.contains("optim")
                || lower.contains("cache")
                || lower.contains("lazy")
            {
                "perf: "
            } else if lower.contains("refactor")
                || lower.contains("restructure")
                || lower.contains("reorganiz")
            {
                "refactor: "
            } else {
                "feat: "
            };

            let mut result = format!("{}{}", prefix, cleaned);
            result = strip_duplicate_prefixes(result);
            if result.len() > 72 {
                if let Some(last_space) = result[..72].rfind(' ') {
                    result.truncate(last_space);
                } else {
                    result.truncate(72);
                }
            }
            return Ok(result);
        }
    }

    if !is_success_status(response.status_code) {
        return Err(format!(
            "Ollama HTTP request error: HTTP {}: {}",
            response.status_code,
            short_response_body(&resp_str)
        ));
    }

    Err(format!(
        "Ollama response parsing error: {}",
        short_response_body(&resp_str)
    ))
}

#[tauri::command]
pub async fn generate_ai_commit_message_gemini(
    diff: Option<String>,
    paths: Option<Vec<String>>,
    model: Option<String>,
    api_key: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let mut actual_diff = diff.unwrap_or_default();

    if actual_diff.trim().is_empty() {
        let diff_result = {
            let app_state = state.lock().map_err(|e| e.to_string())?;
            if let Some(repo) = app_state.repo.as_ref() {
                let mut diff_builder = String::new();
                if let Some(p_vec) = &paths {
                    if !p_vec.is_empty() {
                        for path in p_vec {
                            let d_head =
                                run_git(repo, &["diff", "HEAD", "--", path]).unwrap_or_default();
                            if !d_head.trim().is_empty() {
                                diff_builder.push_str(&d_head);
                                diff_builder.push('\n');
                            } else {
                                let d_staged = run_git(repo, &["diff", "--cached", "--", path])
                                    .unwrap_or_default();
                                if !d_staged.trim().is_empty() {
                                    diff_builder.push_str(&d_staged);
                                    diff_builder.push('\n');
                                } else {
                                    if let Some(workdir) = repo.workdir() {
                                        let full_path = workdir.join(path);
                                        if full_path.exists() && full_path.is_file() {
                                            if let Ok(content) = std::fs::read_to_string(&full_path)
                                            {
                                                let snippet: String = content
                                                    .lines()
                                                    .take(40)
                                                    .collect::<Vec<_>>()
                                                    .join("\n");
                                                diff_builder.push_str(&format!(
                                                    "+++ Added untracked file {}\n{}\n",
                                                    path, snippet
                                                ));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                    }
                } else {
                    diff_builder = run_git(repo, &["diff", "HEAD"]).unwrap_or_default();
                }
                Some(diff_builder)
            } else {
                None
            }
        };
        if let Some(d) = diff_result {
            actual_diff = d;
        }
    }

    if actual_diff.trim().is_empty() {
        return Err("No diff or changed files found for selected items.".to_string());
    }

    if actual_diff.len() > 6000 {
        actual_diff.truncate(6000);
        actual_diff.push_str("\n...[diff truncated for length]");
    }

    let gemini_model = model
        .unwrap_or_else(|| "gemini-2.5-flash".to_string())
        .trim()
        .trim_start_matches("models/")
        .to_string();

    let prompt = format!(
        "You are a commit message generator. Output ONLY the commit message line. Nothing else.

Rules:
- Output exactly ONE line in format: type(scope): description
- Valid types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- Scope is optional, use only if the change clearly belongs to a specific module
- Description must be imperative mood, lowercase first letter, no period at end
- Max 72 characters total
- Do NOT include any explanation, reasoning, markdown, backticks, quotes, or multiple options
- Do NOT start with Here is, This commit, Based on, The diff, Option, Let me, I will
- Do NOT include any text before or after the commit line
- If unsure about scope, omit it: feat: add user authentication

Diff:
{}",
        actual_diff
    );

    let payload = serde_json::json!({
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}]
            }
        ],
        "systemInstruction": {
            "parts": [{"text": "You are a commit message generator. Output ONLY the commit message line. No explanations, no reasoning, no markdown, no backticks."}]
        },
        "generationConfig": {
            "temperature": 0.2,
            "topP": 0.9,
            "maxOutputTokens": 100
        }
    });

    let api_path = format!("/v1beta/models/{}:generateContent", gemini_model);
    let api_key_header = google_api_key_header(&api_key)?;
    let payload_str = payload.to_string();

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_https_request(
            "generativelanguage.googleapis.com",
            "POST",
            &api_path,
            &[
                api_key_header,
                ("Content-Type".to_string(), "application/json".to_string()),
            ],
            Some(&payload_str),
            Duration::from_secs(30),
        )
        .map_err(|e| format!("Gemini request execution error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let resp_str = response.body;

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&resp_str) {
        if let Some(err_msg) = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return Err(format!("Gemini API Error: {}", err_msg));
        }

        let mut combined = String::new();

        if let Some(candidates) = json.get("candidates").and_then(|c| c.as_array()) {
            for candidate in candidates {
                if let Some(content) = candidate.get("content") {
                    if let Some(parts) = content.get("parts").and_then(|p| p.as_array()) {
                        for part in parts {
                            if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                                if !text.trim().is_empty() {
                                    combined.push_str(text);
                                    combined.push('\n');
                                }
                            }
                        }
                    }
                }
            }
        }

        if combined.trim().is_empty() {
            return Err(format!(
                "Gemini returned empty response: {}",
                resp_str.chars().take(200).collect::<String>()
            ));
        }

        let types = [
            "feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore",
        ];
        let raw_lines: Vec<&str> = combined.lines().collect();

        let is_meta = |s: &str| -> bool {
            let l = s.to_lowercase().trim().to_string();
            if l.is_empty() || l.len() < 8 {
                return true;
            }
            l.contains("specifically")
                || l.contains("they involve")
                || l.contains("this diff")
                || l.contains("in summary")
                || l.contains("input:")
                || l.contains("file:")
                || l.contains("option ")
                || l.contains("let's look")
                || l.contains("lets look")
                || l.contains("look at the content")
                || l.contains("here is a commit")
                || l.contains("it adds new")
                || l.contains("this commit")
                || l.contains("based on")
                || l.contains("the change")
                || l.contains("the code")
                || l.contains("the diff shows")
                || l.contains("i will")
                || l.contains("we need")
                || l.contains("we should")
                || l.contains("we can")
                || l.contains("the file")
                || l.contains("a new ")
                || l.contains("added ")
                || l.contains("removes ")
                || l.contains("updates ")
                || l.contains("modifies ")
                || l.contains("introduces ")
                || l.contains("implements ")
                || l.contains("creates ")
                || l.contains("refactors ")
                || l.contains("improves ")
                || l.contains("enhances ")
                || l.contains("changes ")
                || l.contains("deletes ")
                || l.contains("fixes ")
                || l.contains("resolves ")
                || l.contains("adds a ")
                || l.contains("adds the ")
                || l.contains("adds support")
                || l.contains("adds new ")
                || l.contains("adds a new")
                || l.contains("the changes")
                || l.contains("this change")
                || l.contains("this file")
                || l.contains("this code")
                || l.contains("this pr")
                || l.contains("this pull")
                || l.contains("the commit")
                || l.contains("summary:")
                || l.contains("description:")
                || l.contains("explanation:")
                || l.contains("reasoning:")
                || l.contains("analysis:")
                || l.contains("thinking:")
                || l.contains("step ")
                || l.contains("first,")
                || l.contains("second,")
                || l.contains("note:")
                || l.contains("important:")
                || l.contains("example:")
                || l.contains("e.g.")
                || l.contains("i.e.")
                || l.contains("see ")
                || l.contains("ref ")
                || l.contains("http")
                || l.contains("todo")
                || l.contains("fixme")
                || l.contains("please ")
                || l.contains("make sure")
                || l.contains("ensure that")
                || l.contains("in order to")
                || l.contains("furthermore")
                || l.contains("moreover")
                || l.contains("additionally")
                || l.contains("consequently")
                || l.contains("therefore")
                || l.contains("however ")
                || l.contains("nevertheless")
                || l.contains("in conclusion")
                || l.contains("to summarize")
                || l.contains("in brief")
                || l.contains("in short")
                || l.contains("basically")
                || l.contains("essentially")
                || l.contains("overall ")
                || l.contains("in general")
                || l.contains("for example")
                || l.contains("for instance")
                || l.contains("the purpose")
                || l.contains("the goal")
                || l.contains("the objective")
                || l.contains("this is a")
                || l.contains("this pull request")
                || l.contains("this feature")
                || l.contains("this bug")
                || l.contains("this fix")
                || l.contains("this update")
                || l.contains("this improvement")
                || l.contains("this enhancement")
                || l.contains("this refactor")
                || l.contains("this modification")
                || l.contains("this patch")
                || l.contains("this diff")
                || l.contains("the following")
                || l.contains("below is")
                || l.contains("here's")
                || l.contains("here is")
                || l.contains("here are")
                || l.contains("let me")
                || l.contains("let us")
                || l.contains("i'll ")
                || l.contains("i will ")
                || l.contains("we'll ")
                || l.contains("we will ")
                || l.contains("you can")
                || l.contains("you should")
                || l.contains("it is ")
                || l.contains("it's ")
                || l.contains("there is ")
                || l.contains("there are ")
                || l.contains("the commit message")
                || l.contains("a commit message")
                || l.contains("an appropriate")
                || l.contains("a suitable")
                || l.contains("a proper")
                || l.contains("a good")
                || l.contains("a better")
                || l.contains("a concise")
                || l.contains("a clear")
                || l.contains("a descriptive")
                || l.contains("a meaningful")
                || l.contains("an accurate")
                || l.contains("an effective")
                || l.contains("an appropriate commit")
        };

        let clean_candidate = |line: &str| -> String {
            let mut cleaned = line.trim();
            while cleaned.starts_with('*')
                || cleaned.starts_with('-')
                || cleaned.starts_with('`')
                || cleaned.starts_with('"')
                || cleaned.starts_with('\'')
                || cleaned.starts_with('#')
                || cleaned.starts_with('>')
                || cleaned.starts_with('[')
            {
                cleaned = cleaned
                    .trim_start_matches('*')
                    .trim_start_matches('-')
                    .trim_start_matches('`')
                    .trim_start_matches('"')
                    .trim_start_matches('\'')
                    .trim_start_matches('#')
                    .trim_start_matches('>')
                    .trim_start_matches('[')
                    .trim();
            }
            while cleaned.ends_with('}')
                || cleaned.ends_with('`')
                || cleaned.ends_with('"')
                || cleaned.ends_with('\'')
                || cleaned.ends_with('.')
                || cleaned.ends_with(')')
                || cleaned.ends_with(']')
            {
                cleaned = cleaned
                    .trim_end_matches('}')
                    .trim_end_matches('`')
                    .trim_end_matches('"')
                    .trim_end_matches('\'')
                    .trim_end_matches('.')
                    .trim_end_matches(')')
                    .trim_end_matches(']')
                    .trim();
            }
            if let Some(pos) = cleaned.find(':') {
                let prefix = cleaned[..pos].trim().to_lowercase();
                if prefix.starts_with("option")
                    || prefix.starts_with("choice")
                    || prefix == "title"
                    || prefix == "result"
                    || prefix == "output"
                    || prefix == "commit"
                    || prefix == "message"
                    || prefix == "answer"
                    || prefix == "response"
                    || prefix == "suggestion"
                    || prefix == "recommended"
                {
                    cleaned = cleaned[pos + 1..].trim();
                }
            }
            if cleaned.starts_with('`') && cleaned.ends_with('`') && cleaned.len() > 2 {
                cleaned = &cleaned[1..cleaned.len() - 1];
            }
            cleaned.to_string()
        };

        let strip_duplicate_prefixes = |mut input: String| -> String {
            loop {
                let mut changed = false;
                let lower = input.to_lowercase();
                for t1 in &types {
                    let p1_colon = format!("{}:", t1);
                    let p1_paren = format!("{}(", t1);
                    let has_p1 = lower.starts_with(&p1_colon) || lower.starts_with(&p1_paren);
                    if has_p1 {
                        let rest_offset = if lower.starts_with(&p1_colon) {
                            p1_colon.len()
                        } else {
                            if let Some(close_paren) = input.find("):") {
                                close_paren + 2
                            } else {
                                0
                            }
                        };
                        if rest_offset > 0 && rest_offset < input.len() {
                            let rest = input[rest_offset..].trim();
                            let rest_lower = rest.to_lowercase();
                            for t2 in &types {
                                if rest_lower.starts_with(&format!("{}:", t2))
                                    || rest_lower.starts_with(&format!("{}(", t2))
                                {
                                    input = rest.to_string();
                                    changed = true;
                                    break;
                                }
                            }
                        }
                    }
                    if changed {
                        break;
                    }
                }
                if !changed {
                    break;
                }
            }
            input
        };

        let is_valid_conventional_commit = |s: &str| -> bool {
            let lower = s.to_lowercase();
            let has_type = types.iter().any(|t| {
                lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t))
            });
            if !has_type {
                return false;
            }
            let after_prefix = if let Some(pos) = s.find("):") {
                s[pos + 2..].trim()
            } else if let Some(pos) = s.find(':') {
                s[pos + 1..].trim()
            } else {
                ""
            };
            !after_prefix.is_empty() && after_prefix.len() >= 3
        };

        let truncate_to_72 = |result: &mut String| {
            if result.len() > 72 {
                let header_end = result.find(':').map(|i| i + 1).unwrap_or(0);
                if let Some(last_space) = result[..72].rfind(' ') {
                    if last_space > header_end {
                        result.truncate(last_space);
                    } else {
                        result.truncate(72);
                    }
                } else {
                    result.truncate(72);
                }
            }
        };

        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            if is_meta(&cleaned) {
                continue;
            }
            if is_valid_conventional_commit(&cleaned) {
                let mut result = strip_duplicate_prefixes(cleaned);
                truncate_to_72(&mut result);
                return Ok(result);
            }
        }

        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            let lower = cleaned.to_lowercase();
            if is_meta(&cleaned) {
                continue;
            }
            for t in &types {
                if lower.starts_with(&format!("{}:", t)) || lower.starts_with(&format!("{}(", t)) {
                    let mut result = strip_duplicate_prefixes(cleaned);
                    truncate_to_72(&mut result);
                    return Ok(result);
                }
            }
        }

        for line in raw_lines.iter().rev() {
            let cleaned = clean_candidate(line);
            if cleaned.is_empty() || is_meta(&cleaned) || cleaned.len() < 10 {
                continue;
            }
            let lower = cleaned.to_lowercase();
            let word_count = cleaned.split_whitespace().count();
            let has_period = cleaned.contains('.');
            let has_comma = cleaned.contains(',');
            let looks_like_subject = word_count <= 10
                && !has_period
                && !has_comma
                && !lower.starts_with("the ")
                && !lower.starts_with("a ")
                && !lower.starts_with("an ")
                && !lower.starts_with("this ")
                && !lower.starts_with("it ");
            if !looks_like_subject {
                continue;
            }
            let prefix = if lower.contains("fix")
                || lower.contains("bug")
                || lower.contains("error")
                || lower.contains("crash")
            {
                "fix: "
            } else if lower.contains("style")
                || lower.contains("css")
                || lower.contains("format")
                || lower.contains("lint")
            {
                "style: "
            } else if lower.contains("test") || lower.contains("spec") {
                "test: "
            } else if lower.contains("doc") || lower.contains("readme") || lower.contains("comment")
            {
                "docs: "
            } else if lower.contains("remove")
                || lower.contains("delete")
                || lower.contains("clean")
            {
                "chore: "
            } else if lower.contains("perf") || lower.contains("speed") || lower.contains("optim") {
                "perf: "
            } else if lower.contains("refactor") || lower.contains("restructure") {
                "refactor: "
            } else {
                "feat: "
            };
            let mut result = format!("{}{}", prefix, cleaned);
            result = strip_duplicate_prefixes(result);
            truncate_to_72(&mut result);
            return Ok(result);
        }
    }

    if !is_success_status(response.status_code) {
        return Err(format!(
            "Gemini HTTP error: HTTP {}: {}",
            response.status_code,
            short_response_body(&resp_str)
        ));
    }

    Err(format!(
        "Gemini response error: {}",
        short_response_body(&resp_str)
    ))
}

#[tauri::command]
pub async fn list_gemini_models(api_key: String) -> Result<Vec<String>, String> {
    if api_key.trim().is_empty() {
        return Err("API key is empty".to_string());
    }

    let api_key_header = google_api_key_header(&api_key)?;

    let response = tauri::async_runtime::spawn_blocking(move || {
        send_https_request(
            "generativelanguage.googleapis.com",
            "GET",
            "/v1beta/models",
            &[api_key_header],
            None,
            Duration::from_secs(15),
        )
        .map_err(|e| format!("Gemini model request error: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
    .map_err(|e| format!("Request error: {}", e))?;

    let resp_str = response.body;

    let json: serde_json::Value =
        serde_json::from_str(&resp_str).map_err(|e| format!("Invalid JSON response: {}", e))?;

    if let Some(err) = json.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Gemini API error: {}", msg));
    }

    if !is_success_status(response.status_code) {
        return Err(format!(
            "Gemini HTTP error: HTTP {}: {}",
            response.status_code,
            short_response_body(&resp_str)
        ));
    }

    let models_array = json
        .get("models")
        .and_then(|m| m.as_array())
        .ok_or_else(|| {
            format!(
                "Unexpected response structure: {}",
                resp_str.chars().take(200).collect::<String>()
            )
        })?;

    let mut model_ids: Vec<String> = models_array
        .iter()
        .filter_map(|model| {
            let name = model.get("name")?.as_str()?;
            let methods = model.get("supportedGenerationMethods")?.as_array()?;
            let supports_generate = methods
                .iter()
                .any(|m| m.as_str() == Some("generateContent"));
            if !supports_generate {
                return None;
            }
            let id = name.strip_prefix("models/").unwrap_or(name);
            Some(id.to_string())
        })
        .collect();

    model_ids.sort();
    Ok(model_ids)
}

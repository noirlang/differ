//! Git identity, GPG and SMTP settings plus patch e-mail.

use crate::*;

pub fn smtp_config_path() -> Result<std::path::PathBuf, String> {
    let config_dir = dirs::config_dir().ok_or("Could not determine config directory")?;
    let app_dir = config_dir.join("differ");
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("Could not create config dir: {}", e))?;
    Ok(app_dir.join("smtp.json"))
}

/// Loads SMTP settings with the password filled in from secret storage.
/// A plaintext password left in smtp.json by older versions is moved into
/// secret storage and removed from the file.
pub fn load_smtp_settings() -> SmtpSettings {
    let path = match smtp_config_path() {
        Ok(p) => p,
        Err(_) => return SmtpSettings::default(),
    };
    let data = match std::fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return SmtpSettings::default(),
    };
    let mut settings: SmtpSettings = serde_json::from_str(&data).unwrap_or_default();

    if !settings.password.is_empty() {
        if set_secret(SMTP_PASSWORD, &settings.password).is_ok() {
            let _ = save_smtp_settings_to_file(&settings);
        }
    } else {
        settings.password = get_secret(SMTP_PASSWORD).unwrap_or_default();
    }
    settings
}

/// Writes smtp.json without the password (it is kept in secret storage).
pub fn save_smtp_settings_to_file(settings: &SmtpSettings) -> Result<(), String> {
    let path = smtp_config_path()?;
    let mut on_disk = settings.clone();
    on_disk.password = String::new();
    on_disk.has_password = false;
    let json = serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Could not write SMTP config: {}", e))
}


pub fn get_gpg_keys() -> Vec<GpgKey> {
    let mut keys = Vec::new();
    let mut gpg_cmd = Command::new("gpg");
    #[cfg(target_os = "windows")]
    gpg_cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = gpg_cmd
        .args(&["--list-secret-keys", "--keyid-format", "LONG"])
        .output()
    {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let mut current_key_id = String::new();
            for line in out_str.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("sec") {
                    if let Some(pos) = trimmed.find('/') {
                        let after_slash = &trimmed[pos + 1..];
                        let key_id = after_slash.split_whitespace().next().unwrap_or("");
                        current_key_id = key_id.to_string();
                    }
                } else if trimmed.starts_with("uid") && !current_key_id.is_empty() {
                    let uid = trimmed.trim_start_matches("uid").trim().to_string();
                    keys.push(GpgKey {
                        key_id: current_key_id.clone(),
                        uid,
                        is_default: false,
                    });
                    current_key_id.clear();
                }
            }
        }
    }

    keys
}

#[tauri::command]
pub async fn get_git_settings(state: State<'_, Mutex<AppState>>) -> Result<GitSettings, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo_ref = app_state.repo.as_ref();

    let mut current_name = String::new();
    let mut current_email = String::new();
    let mut current_signing_key = String::new();
    let mut gpg_sign_enabled = false;

    if let Some(repo) = repo_ref {
        if let Ok(cfg) = repo.config() {
            current_name = cfg.get_string("user.name").unwrap_or_default();
            current_email = cfg.get_string("user.email").unwrap_or_default();
            current_signing_key = cfg.get_string("user.signingkey").unwrap_or_default();
            gpg_sign_enabled = cfg.get_bool("commit.gpgsign").unwrap_or(false);
        }
    }

    if current_name.is_empty() {
        if let Ok(out) = Command::new("git")
            .args(&["config", "--global", "user.name"])
            .output()
        {
            current_name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    if current_email.is_empty() {
        if let Ok(out) = Command::new("git")
            .args(&["config", "--global", "user.email"])
            .output()
        {
            current_email = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }
    if current_signing_key.is_empty() {
        if let Ok(out) = Command::new("git")
            .args(&["config", "--global", "user.signingkey"])
            .output()
        {
            current_signing_key = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
    }

    let mut identities = Vec::new();
    if !current_name.is_empty() || !current_email.is_empty() {
        identities.push(GitIdentity {
            name: current_name.clone(),
            email: current_email.clone(),
            is_current: true,
        });
    }

    if let Some(repo) = repo_ref {
        if let Ok(mut revwalk) = repo.revwalk() {
            revwalk.push_head().ok();
            for oid in revwalk.take(40).flatten() {
                if let Ok(commit) = repo.find_commit(oid) {
                    let name = commit.author().name().unwrap_or("").to_string();
                    let email = commit.author().email().unwrap_or("").to_string();
                    if !name.is_empty() && !email.is_empty() {
                        if !identities.iter().any(|i| i.email == email) {
                            identities.push(GitIdentity {
                                name,
                                email,
                                is_current: false,
                            });
                        }
                    }
                }
            }
        }
    }

    let mut gpg_keys = get_gpg_keys();
    for key in &mut gpg_keys {
        if !current_signing_key.is_empty() && key.key_id.contains(&current_signing_key) {
            key.is_default = true;
        }
    }

    Ok(GitSettings {
        identities,
        gpg_keys,
        current_name,
        current_email,
        current_signing_key,
        gpg_sign_enabled,
    })
}

#[tauri::command]
pub async fn save_git_settings(
    state: State<'_, Mutex<AppState>>,
    name: String,
    email: String,
    signing_key: String,
    gpg_sign: bool,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;

    let name = name.trim();
    let email = email.trim();
    let signing_key = signing_key.trim();

    if !name.is_empty() {
        run_git(repo, &["config", "user.name", name])?;
    }
    if !email.is_empty() {
        run_git(repo, &["config", "user.email", email])?;
    }
    if !signing_key.is_empty() {
        run_git(repo, &["config", "user.signingkey", signing_key])?;
    }
    run_git(
        repo,
        &[
            "config",
            "commit.gpgsign",
            if gpg_sign { "true" } else { "false" },
        ],
    )?;

    Ok("Settings saved successfully".to_string())
}

#[tauri::command]
pub async fn get_smtp_settings() -> Result<SmtpSettings, String> {
    let mut settings = load_smtp_settings();
    settings.has_password = !settings.password.is_empty();
    settings.password = String::new();
    Ok(settings)
}

/// An empty password keeps the stored one; `clear_password` removes it.
#[tauri::command]
pub async fn save_smtp_settings(
    settings: SmtpSettings,
    clear_password: Option<bool>,
) -> Result<String, String> {
    if clear_password.unwrap_or(false) {
        set_secret(SMTP_PASSWORD, "")?;
    } else if !settings.password.is_empty() {
        set_secret(SMTP_PASSWORD, &settings.password)?;
    }
    save_smtp_settings_to_file(&settings)?;
    Ok("SMTP settings saved successfully".to_string())
}

#[tauri::command]
pub async fn send_patch_email(state: State<'_, Mutex<AppState>>) -> Result<String, String> {
    let smtp = load_smtp_settings();
    if !smtp.enabled {
        return Err("SMTP email notifications are not enabled".to_string());
    }
    if smtp.host.is_empty() || smtp.from_email.is_empty() || smtp.to_email.is_empty() {
        return Err("SMTP host, from email, and to email are required".to_string());
    }

    let patch_content = {
        let app_state = state.lock().map_err(|e| e.to_string())?;
        let repo = app_state.repo.as_ref().ok_or("Repository is not open")?;
        let workdir = repo_workdir(repo)?;

        let output = Command::new("git")
            .args(&["format-patch", "-1", "HEAD", "--stdout"])
            .current_dir(workdir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| format!("Failed to run git format-patch: {}", e))?;

        if !output.status.success() {
            return Err("Failed to generate patch from HEAD".to_string());
        }
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    if patch_content.trim().is_empty() {
        return Err("Generated patch is empty".to_string());
    }

    let subject = patch_content
        .lines()
        .find(|l| l.starts_with("Subject: "))
        .map(|l| l.trim_start_matches("Subject: ").trim().to_string())
        .unwrap_or_else(|| "Git patch".to_string());

    let from_name = smtp.from_email.split('@').next().unwrap_or("differ");
    let from_addr = format!("{} <{}>", from_name, smtp.from_email);

    let email = Message::builder()
        .from(
            from_addr
                .parse()
                .map_err(|e| format!("Invalid from address: {}", e))?,
        )
        .to(smtp
            .to_email
            .parse()
            .map_err(|e| format!("Invalid to address: {}", e))?)
        .subject(format!("[differ] {}", subject))
        .header(ContentType::TEXT_PLAIN)
        .body(patch_content)
        .map_err(|e| format!("Failed to build email: {}", e))?;

    let creds = if !smtp.username.is_empty() {
        Credentials::new(smtp.username, smtp.password)
    } else {
        Credentials::new(String::new(), String::new())
    };

    let transport = if smtp.use_tls {
        SmtpTransport::starttls_relay(&smtp.host)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(smtp.port)
            .credentials(creds)
            .build()
    } else {
        SmtpTransport::relay(&smtp.host)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .port(smtp.port)
            .credentials(creds)
            .build()
    };

    transport
        .send(&email)
        .map_err(|e| format!("SMTP send error: {}", e))?;

    Ok(format!("Patch email sent to {}", smtp.to_email))
}

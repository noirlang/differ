//! Secret storage (API keys, passwords).
//!
//! Secrets live in the OS keychain (Secret Service on Linux, Credential
//! Manager on Windows, Keychain on macOS). When no keychain is reachable —
//! e.g. a minimal Linux session without a Secret Service daemon — they fall
//! back to `~/.config/differ/secrets.json`, created with owner-only (0600)
//! permissions. Secrets never go back to the frontend.

use crate::*;
use std::collections::HashMap;

const SERVICE: &str = "differ";
pub const GEMINI_API_KEY: &str = "gemini-api-key";
pub const SMTP_PASSWORD: &str = "smtp-password";

fn fallback_path() -> Result<std::path::PathBuf, String> {
    let dir = dirs::config_dir()
        .ok_or("Could not determine config directory")?
        .join("differ");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create config dir: {}", e))?;
    Ok(dir.join("secrets.json"))
}

fn read_fallback() -> HashMap<String, String> {
    fallback_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default()
}

fn write_fallback(map: &HashMap<String, String>) -> Result<(), String> {
    let path = fallback_path()?;
    if map.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    let json = serde_json::to_string(map).map_err(|e| e.to_string())?;

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts
        .open(&path)
        .map_err(|e| format!("Could not write secrets file: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(std::fs::Permissions::from_mode(0o600));
    }
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Could not write secrets file: {}", e))
}

fn entry(name: &str) -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SERVICE, name)
}

/// Reads a secret. Returns `None` when it is not stored anywhere.
pub fn get_secret(name: &str) -> Option<String> {
    match entry(name).and_then(|e| e.get_password()) {
        Ok(value) if !value.is_empty() => return Some(value),
        _ => {}
    }
    read_fallback().remove(name).filter(|v| !v.is_empty())
}

/// Stores a secret; an empty value deletes it.
pub fn set_secret(name: &str, value: &str) -> Result<(), String> {
    let mut fallback = read_fallback();

    if value.is_empty() {
        if let Ok(e) = entry(name) {
            let _ = e.delete_credential();
        }
        if fallback.remove(name).is_some() {
            write_fallback(&fallback)?;
        }
        return Ok(());
    }

    match entry(name).and_then(|e| e.set_password(value)) {
        Ok(()) => {
            // Keychain worked: make sure no stale copy is left in the file.
            if fallback.remove(name).is_some() {
                write_fallback(&fallback)?;
            }
            Ok(())
        }
        Err(_) => {
            fallback.insert(name.to_string(), value.to_string());
            write_fallback(&fallback)
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub gemini_api_key: bool,
    pub smtp_password: bool,
}

#[tauri::command]
pub async fn get_secret_status() -> Result<SecretStatus, String> {
    // Loading SMTP settings also migrates a plaintext password if one exists.
    let _ = load_smtp_settings();
    Ok(SecretStatus {
        gemini_api_key: get_secret(GEMINI_API_KEY).is_some(),
        smtp_password: get_secret(SMTP_PASSWORD).is_some(),
    })
}

#[tauri::command]
pub async fn save_gemini_api_key(api_key: String) -> Result<(), String> {
    set_secret(GEMINI_API_KEY, api_key.trim())
}

/// Uses the key passed from the settings form if present, else the stored one.
pub fn resolve_gemini_api_key(api_key: Option<String>) -> Result<String, String> {
    api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| get_secret(GEMINI_API_KEY))
        .ok_or_else(|| "Gemini API key is not set".to_string())
}

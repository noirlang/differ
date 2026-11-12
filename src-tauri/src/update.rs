//! Application version and update check.

use crate::*;

pub const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[tauri::command]
pub fn get_app_version() -> String {
    CURRENT_APP_VERSION.to_string()
}

pub fn parse_semver(v: &str) -> (u32, u32, u32) {
    let clean = v
        .trim()
        .trim_start_matches('v')
        .trim_start_matches("commit-");
    let parts: Vec<&str> = clean.split('.').collect();
    let major = parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0);
    let minor = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch = parts
        .get(2)
        .and_then(|s| s.split('-').next().unwrap_or("0").parse().ok())
        .unwrap_or(0);
    (major, minor, patch)
}

pub fn is_version_newer(latest: &str, current: &str) -> bool {
    let (l_maj, l_min, l_pat) = parse_semver(latest);
    let (c_maj, c_min, c_pat) = parse_semver(current);
    if l_maj != c_maj {
        return l_maj > c_maj;
    }
    if l_min != c_min {
        return l_min > c_min;
    }
    if l_pat != c_pat {
        return l_pat > c_pat;
    }
    false
}

#[tauri::command]
pub async fn check_app_update(state: State<'_, Mutex<AppState>>) -> Result<AppUpdateInfo, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let cwd = app_state.repo_path.as_deref().map(Path::new);

    // 1. Try gh release view --repo noirlang/differ
    let gh_res = run_gh(
        &[
            "release",
            "view",
            "--repo",
            "noirlang/differ",
            "--json",
            "tagName,name,body,url,publishedAt,assets",
        ],
        cwd,
    );

    let json_str = match gh_res {
        Ok(out) => out,
        Err(_) => {
            // Fallback: try curl GitHub API
            let curl_out = Command::new("curl")
                .args(&[
                    "-s",
                    "-L",
                    "-H",
                    "User-Agent: differ-app",
                    "https://api.github.com/repos/noirlang/differ/releases/latest",
                ])
                .output()
                .map_err(|e| format!("Could not check updates: {}", e))?;
            if !curl_out.status.success() {
                return Err("Failed to fetch release information from GitHub".to_string());
            }
            String::from_utf8_lossy(&curl_out.stdout).to_string()
        }
    };

    let v: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| format!("Could not parse release JSON: {}", e))?;

    if v.is_null() || v.get("message").and_then(|m| m.as_str()) == Some("Not Found") {
        return Ok(AppUpdateInfo {
            current_version: CURRENT_APP_VERSION.to_string(),
            latest_version: CURRENT_APP_VERSION.to_string(),
            tag_name: format!("v{}", CURRENT_APP_VERSION),
            release_name: "No releases found on github.com/noirlang/differ".to_string(),
            release_notes: "App is running the latest version.".to_string(),
            html_url: "https://github.com/noirlang/differ".to_string(),
            has_update: false,
            published_at: String::new(),
            assets: vec![],
            can_self_update: can_self_update(),
        });
    }

    let tag_name = v["tagName"]
        .as_str()
        .or_else(|| v["tag_name"].as_str())
        .unwrap_or("")
        .to_string();
    let release_name = v["name"].as_str().unwrap_or(&tag_name).to_string();
    let release_notes = v["body"].as_str().unwrap_or("").to_string();
    let html_url = v["url"]
        .as_str()
        .or_else(|| v["html_url"].as_str())
        .unwrap_or("https://github.com/noirlang/differ")
        .to_string();
    let published_at = v["publishedAt"]
        .as_str()
        .or_else(|| v["published_at"].as_str())
        .unwrap_or("")
        .to_string();

    let mut assets = Vec::new();
    if let Some(arr) = v["assets"].as_array() {
        for a in arr {
            let name = a["name"].as_str().unwrap_or("").to_string();
            let download_url = a["url"]
                .as_str()
                .or_else(|| a["browser_download_url"].as_str())
                .unwrap_or("")
                .to_string();
            let size = a["size"].as_u64().unwrap_or(0);
            // Updater metadata is not something to download by hand.
            let is_update_metadata = name.ends_with(".sig") || name == "latest.json";
            if !name.is_empty() && !download_url.is_empty() && !is_update_metadata {
                assets.push(ReleaseAsset {
                    name,
                    download_url,
                    size,
                });
            }
        }
    }

    let clean_tag = tag_name.trim_start_matches('v').to_string();
    let latest_version = if clean_tag.is_empty() {
        release_name.clone()
    } else {
        clean_tag.clone()
    };
    let has_update = is_version_newer(&latest_version, CURRENT_APP_VERSION);

    Ok(AppUpdateInfo {
        current_version: CURRENT_APP_VERSION.to_string(),
        latest_version,
        tag_name,
        release_name,
        release_notes,
        html_url,
        has_update,
        published_at,
        assets,
        can_self_update: can_self_update(),
    })
}

/// Whether the running build can replace itself. On Linux only the AppImage
/// can (the AppImage runtime sets $APPIMAGE); deb/rpm/Arch installs are
/// updated by the package manager.
pub fn can_self_update() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        cfg!(target_os = "windows")
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// Downloads, verifies (minisign signature from tauri.conf.json) and installs
/// the latest release. Emits "update-progress" events while downloading.
/// Returns the installed version; the frontend then calls `restart_app`.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    if !can_self_update() {
        return Err("This installation is managed by the system package manager".to_string());
    }

    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("Update check failed: {}", e))?
        .ok_or("No update is available")?;

    let version = update.version.clone();
    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", UpdateProgress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| format!("Update could not be installed: {}", e))?;

    Ok(version)
}

#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

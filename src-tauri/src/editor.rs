//! External code editor detection and launching.

use crate::*;

pub struct EditorLauncher {
    pub cmd: String,
    pub args: Vec<String>,
}

pub fn is_binary_in_path(binary: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("where");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd.arg(binary).output() {
            output.status.success()
        } else {
            false
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("which").arg(binary).output() {
            output.status.success()
        } else {
            false
        }
    }
}

pub fn find_editor_launcher(editor_id: &str) -> Option<EditorLauncher> {
    match editor_id {
        "code" => {
            for b in &["code", "code.cmd", "code.exe"] {
                if is_binary_in_path(b) {
                    return Some(EditorLauncher {
                        cmd: (*b).into(),
                        args: vec![],
                    });
                }
            }
            #[cfg(target_os = "windows")]
            {
                if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
                    let p1 = Path::new(&appdata).join(r"Programs\Microsoft VS Code\Code.exe");
                    if p1.exists() {
                        return Some(EditorLauncher {
                            cmd: p1.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                }
                if let Ok(pf) = std::env::var("ProgramFiles") {
                    let p2 = Path::new(&pf).join(r"Microsoft VS Code\Code.exe");
                    if p2.exists() {
                        return Some(EditorLauncher {
                            cmd: p2.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                }
            }
            #[cfg(target_os = "linux")]
            {
                if Path::new("/snap/bin/code").exists() {
                    return Some(EditorLauncher {
                        cmd: "/snap/bin/code".into(),
                        args: vec![],
                    });
                }
                if is_binary_in_path("flatpak") {
                    if let Ok(out) = Command::new("flatpak")
                        .args(&["info", "com.visualstudio.code"])
                        .output()
                    {
                        if out.status.success() {
                            return Some(EditorLauncher {
                                cmd: "flatpak".into(),
                                args: vec!["run".into(), "com.visualstudio.code".into()],
                            });
                        }
                    }
                }
            }
        }
        "code-oss" => {
            for b in &["code-oss", "code-oss.cmd", "code-oss.exe"] {
                if is_binary_in_path(b) {
                    return Some(EditorLauncher {
                        cmd: (*b).into(),
                        args: vec![],
                    });
                }
            }
        }
        "zed" => {
            for b in &["zed", "zeditor", "zed-editor", "zed.exe"] {
                if is_binary_in_path(b) {
                    return Some(EditorLauncher {
                        cmd: (*b).into(),
                        args: vec![],
                    });
                }
            }
            #[cfg(target_os = "windows")]
            {
                if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
                    let p1 = Path::new(&appdata).join(r"Programs\Zed\zed.exe");
                    if p1.exists() {
                        return Some(EditorLauncher {
                            cmd: p1.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                }
                if let Ok(pf) = std::env::var("ProgramFiles") {
                    let p2 = Path::new(&pf).join(r"Zed\zed.exe");
                    if p2.exists() {
                        return Some(EditorLauncher {
                            cmd: p2.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                }
            }
            #[cfg(target_os = "linux")]
            {
                if is_binary_in_path("flatpak") {
                    if let Ok(out) = Command::new("flatpak")
                        .args(&["info", "dev.zed.Zed"])
                        .output()
                    {
                        if out.status.success() {
                            return Some(EditorLauncher {
                                cmd: "flatpak".into(),
                                args: vec!["run".into(), "dev.zed.Zed".into()],
                            });
                        }
                    }
                }
            }
        }
        "cursor" => {
            for b in &["cursor", "cursor.cmd", "cursor.exe"] {
                if is_binary_in_path(b) {
                    return Some(EditorLauncher {
                        cmd: (*b).into(),
                        args: vec![],
                    });
                }
            }
            #[cfg(target_os = "windows")]
            {
                if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
                    let p1 = Path::new(&appdata).join(r"Programs\cursor\Cursor.exe");
                    if p1.exists() {
                        return Some(EditorLauncher {
                            cmd: p1.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                    let p2 = Path::new(&appdata).join(r"cursor\Cursor.exe");
                    if p2.exists() {
                        return Some(EditorLauncher {
                            cmd: p2.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                }
            }
            #[cfg(target_os = "linux")]
            {
                if Path::new("/snap/bin/cursor").exists() {
                    return Some(EditorLauncher {
                        cmd: "/snap/bin/cursor".into(),
                        args: vec![],
                    });
                }
                if is_binary_in_path("flatpak") {
                    if let Ok(out) = Command::new("flatpak")
                        .args(&["info", "com.cursor.Cursor"])
                        .output()
                    {
                        if out.status.success() {
                            return Some(EditorLauncher {
                                cmd: "flatpak".into(),
                                args: vec!["run".into(), "com.cursor.Cursor".into()],
                            });
                        }
                    }
                }
            }
        }
        "codium" => {
            for b in &["codium", "vscodium", "codium.cmd", "codium.exe"] {
                if is_binary_in_path(b) {
                    return Some(EditorLauncher {
                        cmd: (*b).into(),
                        args: vec![],
                    });
                }
            }
            #[cfg(target_os = "windows")]
            {
                if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
                    let p1 = Path::new(&appdata).join(r"Programs\VSCodium\VSCodium.exe");
                    if p1.exists() {
                        return Some(EditorLauncher {
                            cmd: p1.to_string_lossy().into(),
                            args: vec![],
                        });
                    }
                }
            }
        }
        _ => {}
    }
    None
}

#[tauri::command]
pub async fn detect_installed_editors() -> Vec<InstalledEditor> {
    let editors_to_check = vec![
        ("code", "VS Code"),
        ("code-oss", "Code OSS"),
        ("zed", "Zed"),
        ("cursor", "Cursor"),
        ("codium", "VSCodium"),
    ];

    let mut installed = Vec::new();
    for (id, name) in editors_to_check {
        if let Some(launcher) = find_editor_launcher(id) {
            installed.push(InstalledEditor {
                id: id.to_string(),
                name: name.to_string(),
                cmd: launcher.cmd,
            });
        }
    }
    installed
}

#[tauri::command]
pub async fn open_in_editor(
    editor_id: String,
    state: State<'_, Mutex<AppState>>,
) -> Result<String, String> {
    let app_state = state.lock().map_err(|e| e.to_string())?;
    let repo_path = app_state
        .repo_path
        .as_ref()
        .ok_or("Repository is not open")?;

    let launcher = find_editor_launcher(&editor_id)
        .ok_or_else(|| format!("Editor '{}' was not found on this system", editor_id))?;

    let mut cmd = Command::new(&launcher.cmd);
    for arg in &launcher.args {
        cmd.arg(arg);
    }
    cmd.arg(repo_path);

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch {}: {}", editor_id, e))?;

    Ok(format!("Opened repository in {}", editor_id))
}

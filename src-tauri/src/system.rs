//! Host hardware / OS detection (used for local AI model hints).

use crate::*;

pub fn detect_os_and_distro() -> (String, String) {
    let os = std::env::consts::OS.to_string();
    let mut distro = String::new();

    if os == "linux" {
        if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
            for line in content.lines() {
                if line.starts_with("PRETTY_NAME=") {
                    distro = line
                        .trim_start_matches("PRETTY_NAME=")
                        .trim_matches('"')
                        .to_string();
                    break;
                } else if line.starts_with("NAME=") && distro.is_empty() {
                    distro = line
                        .trim_start_matches("NAME=")
                        .trim_matches('"')
                        .to_string();
                }
            }
        }
        if distro.is_empty() {
            distro = "Linux Generic".to_string();
        }
    } else if os == "macos" {
        if let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            distro = format!("macOS {}", ver);
        } else {
            distro = "macOS".to_string();
        }
    } else if os == "windows" {
        distro = "Windows".to_string();
    } else {
        distro = os.clone();
    }

    (os, distro)
}

pub fn detect_ram_gb() -> f32 {
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
            for line in content.lines() {
                if line.starts_with("MemTotal:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<f32>() {
                            return (kb / 1024.0 / 1024.0 * 10.0).round() / 10.0;
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("sysctl").arg("-n").arg("hw.memsize").output() {
            let bytes_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Ok(bytes) = bytes_str.parse::<f32>() {
                return (bytes / 1024.0 / 1024.0 / 1024.0 * 10.0).round() / 10.0;
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("wmic");
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(output) = cmd
            .args(&["ComputerSystem", "get", "TotalPhysicalMemory"])
            .output()
        {
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if let Ok(bytes) = line.trim().parse::<f32>() {
                    return (bytes / 1024.0 / 1024.0 / 1024.0 * 10.0).round() / 10.0;
                }
            }
        }
    }

    8.0
}

pub fn detect_gpu_and_vram() -> (String, f32) {
    let mut cmd = Command::new("nvidia-smi");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(output) = cmd
        .args(&[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(line) = out_str.lines().next() {
                let parts: Vec<&str> = line.split(',').collect();
                if parts.len() >= 2 {
                    let name = parts[0].trim().to_string();
                    let vram_mb: f32 = parts[1].trim().parse().unwrap_or(0.0);
                    return (name, (vram_mb / 1024.0 * 10.0).round() / 10.0);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("lspci").output() {
            let out = String::from_utf8_lossy(&output.stdout);
            for line in out.lines() {
                if line.contains("VGA compatible controller")
                    || line.contains("3D controller")
                    || line.contains("Display controller")
                {
                    let parts: Vec<&str> = line.split(':').collect();
                    let name = parts.last().unwrap_or(&line).trim().to_string();
                    return (name, 4.0);
                }
            }
        }
    }

    ("Standard Graphics".to_string(), 2.0)
}

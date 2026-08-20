<div align="center">

# Differ

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/assets/differ-white.svg">
    <img src="src/assets/differ-black.svg" width="88" alt="differ logo" />
  </picture>
</p>

<p align="center">
  <strong>A focused desktop Git change explorer for commit history, contributors, diffs, AI commit generation, and repository status.</strong>
</p>

[Website](https://differ.noirlang.tr) 

## Video

https://github.com/user-attachments/assets/3553d66b-7a10-4a68-9e22-307517186350

## Features

- Multi-Provider AI Commit Generation: Support for Ollama (local), Gemini Cloud API, and LM Studio (`127.0.0.1:1234/v1`) with 1-click model presets and automatic local model discovery.
- Commit Editing & Amending: Edit past commit messages, manage co-author chips, toggle `-s` (`Signed-off-by:`), or execute `git commit --amend`.
- SMTP Email Patching & Notifications: Send patch emails directly from the app with configurable SMTP server host, port, TLS encryption, and recipient authentication.
- High-Contrast Compact Timeline: Timeline grid with 7-character pill badges (`5c81c00`), graph tracks, branch labels (`main`, `origin/main`), and unpushed indicators.
- Automatic Git Initialization: Detects non-Git folders upon opening and prompts to run `git init`. Gracefully handles 0-commit empty repositories.
- UI Scale & Interface Zoom: Customizable zoom dropdown in Settings (`75%`, `85%`, `90%`, `100%`, `110%`, `125%`) with persistent local storage.
- External Code Editor Launchers: One-click launchers for VS Code, Code OSS, Zed, Cursor, and VSCodium.
- GitHub Integration: Dedicated navigation tabs for History, Issues, Pull Requests, and Actions.
- Contributor Profiles & Avatars: Avatar resolution via GitHub commit API or noreply email address formats.
- Git Identity & GPG Signing: Custom Git author profiles, email addresses, and GPG commit signing keys (`commit.gpgsign`).

## Download Links

| Platform / Distro | Package File | Direct Download |
| --- | --- | --- |
| Linux AppImage | `differ-linux-x64.AppImage` | [Download](https://github.com/noirlang/differ/releases/latest/download/differ-linux-x64.AppImage) |
| Debian / Ubuntu | `differ-linux-x64.deb` | [Download](https://github.com/noirlang/differ/releases/latest/download/differ-linux-x64.deb) |
| Arch Linux | `differ-linux-x64.pkg.tar.zst` | [Download](https://github.com/noirlang/differ/releases/latest/download/differ-linux-x64.pkg.tar.zst) |
| RPM Linux | `differ-linux-x64.rpm` | [Download](https://github.com/noirlang/differ/releases/latest/download/differ-linux-x64.rpm) |
| Windows | `differ-windows-x64.msi` | [Download](https://github.com/noirlang/differ/releases/latest/download/differ-windows-x64.msi) |

All Releases: [GitHub Releases](https://github.com/noirlang/differ/releases/latest)

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://forgetag.noirlang.tr/sirket.png">
    <img src="https://forgetag.noirlang.tr/sirket.png" width="88" alt="differ logo" />
  </picture>
</p>

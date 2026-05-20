# differ

<p align="center">
  <img src="src/assets/differ-white.png" width="96" alt="differ logo" />
</p>

<p align="center">
  <strong>A focused desktop Git change explorer for commit history, contributors, diffs, and repository status.</strong>
</p>

## Demo Video

> Demo video will be added here after it is uploaded through a GitHub issue.

<!--
Replace this placeholder with the GitHub issue video URL when the recording is ready.
Example:

https://github.com/user-attachments/assets/00000000-0000-0000-0000-000000000000
-->

<p align="center">
  <img alt="CI" src="https://github.com/noirlang/differ/actions/workflows/ci.yml/badge.svg" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-ffffff?style=flat-square&labelColor=111111" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-backend-ffffff?style=flat-square&labelColor=111111" />
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-frontend-ffffff?style=flat-square&labelColor=111111" />
  <img alt="Status" src="https://img.shields.io/badge/status-active-ffffff?style=flat-square&labelColor=111111" />
</p>

## Overview

`differ` is a desktop application for reading Git repositories without losing the full project context. It brings commit history, changed files, author details, branch state, working tree status, and remote sync information into one compact interface.

The application is designed for teams that need a clean way to review what changed, who changed it, and whether local work still needs to be committed or pushed.

## Highlights

- Open any local Git repository folder from the desktop app.
- Browse a GitKraken-style commit timeline with graph lanes.
- Inspect commit messages, hashes, dates, authors, and author emails.
- View per-commit changed files with line-by-line diffs.
- Explore the project file tree for the selected commit.
- Filter history by contributor from the sidebar.
- Show a Top 3 contribution ranking modal.
- Load GitHub avatars from noreply email addresses.
- Resolve GitHub avatars through the GitHub commit API when an `origin` remote is available.
- Track uncommitted working tree changes.
- Select one or more changed files and commit them from the UI.
- Show `origin` connection state and unpushed commit count.
- Push pending commits when a valid upstream or `origin` remote exists.
- Keep the last 5 opened repositories on the home screen.

## Product Goals

`differ` focuses on practical Git review workflows:

1. Make repository history readable at a glance.
2. Keep commit, diff, author, and file tree context visible together.
3. Separate committed history from uncommitted local work.
4. Show contributor activity without turning the app into a heavy analytics dashboard.
5. Keep the interface minimal, dark, and focused on black and white contrast.

## Application Flow

1. Open a Git repository from the home screen.
2. Review repository metadata, branch state, contributor list, and file tree.
3. Select a commit from the history timeline.
4. Inspect changed files and diff hunks in the detail panel.
5. Filter by contributor when you need to review a single author's work.
6. Check pending working tree changes.
7. Select files, write a commit message, and create a commit.
8. Push unpushed commits when the repository has a valid remote.

## Architecture

`differ` is built as a Tauri desktop application:

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Native window, command bridge, app packaging |
| Backend | Rust | Git repository access, branch data, diffs, status, commit, push |
| Git engine | `git2` and system `git` | Read repository data and execute write operations |
| Frontend | HTML, CSS, JavaScript | Application layout, timeline, modal, filtering, interaction state |
| Assets | PNG and SVG | App icon, brand mark, generated platform icons |

## Repository Layout

```text
.
|-- src
|   |-- assets
|   |   |-- differ-white.svg
|   |   |-- differ-white.png
|   |   `-- differ.png
|   |-- index.html
|   |-- main.js
|   `-- styles.css
|-- src-tauri
|   |-- src
|   |   |-- lib.rs
|   |   `-- main.rs
|   |-- icons
|   |-- capabilities
|   |-- Cargo.toml
|   `-- tauri.conf.json
|-- package.json
`-- README.md
```

## Requirements

- Node.js and npm
- Rust toolchain
- Tauri system dependencies for your operating system
- Git installed and available in `PATH`

Linux users need the standard WebKitGTK and Tauri desktop dependencies installed for their distribution.

## Getting Started

Install dependencies:

```bash
npm install
```

Run the desktop app:

```bash
npm run dev
```

On Linux Wayland sessions, WebKitGTK can sometimes fail with a GDK protocol error. The default `dev` script forces XWayland:

```bash
npm run dev
```

To try native Wayland:

```bash
npm run dev:wayland
```

## Development Commands

Run the Tauri development app:

```bash
npm run dev
```

Validate the Rust backend:

```bash
cd src-tauri
cargo check
```

Format Rust code:

```bash
cd src-tauri
cargo fmt
```

Check the JavaScript entry file:

```bash
node --check src/main.js
```

## Git Operations

The app reads most repository data through the Rust backend. Write operations are intentionally narrow:

- `commit_changes` stages and commits only the selected paths.
- `push_origin` pushes the active branch to its upstream when available.
- If no upstream is configured, `push_origin` attempts to push to `origin` and set upstream for the active branch.

This keeps file commits explicit and avoids accidentally committing unrelated local changes.

## GitHub Avatar Support

Contributor avatars are resolved in two ways:

- Directly from GitHub noreply email formats such as `123+user@users.noreply.github.com`.
- Through GitHub's commit API when the repository has a GitHub `origin` remote.

When no avatar can be resolved, `differ` falls back to contributor initials.

## Recent Repositories

The home screen stores the last 5 opened Git repositories in local app storage. This list is local to the desktop app and is used only for quick reopening.

## Troubleshooting

### GDK protocol error on Wayland

Use the default development command first:

```bash
npm run dev
```

It sets `GDK_BACKEND=x11` and `WEBKIT_DISABLE_DMABUF_RENDERER=1` for a more stable Linux development session.

### Repository opens but push is disabled

Check that the repository has:

- An active branch
- A configured `origin` remote
- A valid upstream, or permission to create one with `git push -u origin <branch>`

### GitHub avatars do not appear

Avatar loading depends on commit email metadata, a GitHub remote, and network availability. The app still works normally when avatars cannot be resolved.

## Roadmap

- Side-by-side diff mode
- Commit search filters by file path
- Branch comparison view
- Exportable contributor report
- Keyboard shortcuts for timeline navigation
- Packaged installers for Linux, macOS, and Windows

## Contributing

Contributions should keep the application focused, readable, and conservative around Git write operations.

Before opening a pull request:

1. Run `node --check src/main.js`.
2. Run `cargo check` inside `src-tauri`.
3. Keep UI changes consistent with the black and white visual system.
4. Avoid adding dependencies unless they remove meaningful complexity.

## License

`differ` is licensed under the GNU General Public License v3.0 or later.
See [LICENSE](LICENSE) for the full license text.

---

<p align="center">
  <a href="https://github.com/noirlang">
    <img src="https://github.com/noirlang.png?size=160" width="96" alt="noirLang logo" />
  </a>
</p>

<p align="center">
  <sub><a href="https://github.com/noirlang">noirLang</a></sub>
</p>

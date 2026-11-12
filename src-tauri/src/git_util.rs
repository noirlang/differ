//! Low-level git helpers shared by the command modules.

use crate::*;

pub fn parse_github_remote(remote_url: &str) -> Option<(String, String)> {
    let url = remote_url.trim().trim_end_matches(".git");
    let path = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))
        .or_else(|| url.strip_prefix("git@github.com:"))
        .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;

    let mut parts = path.split('/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    Some((owner, repo))
}

pub fn current_branch_name(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
}

pub fn origin_url(repo: &Repository) -> Option<String> {
    // 1. Try git2 find_remote("origin")
    if let Ok(remote) = repo.find_remote("origin") {
        if let Some(url) = remote.url() {
            return Some(url.to_string());
        }
    }

    // 2. Check git2 remotes() list
    if let Ok(remotes) = repo.remotes() {
        for name in remotes.iter().flatten() {
            if name == "origin" {
                if let Ok(remote) = repo.find_remote(name) {
                    if let Some(url) = remote.url() {
                        return Some(url.to_string());
                    }
                }
            }
        }
        for name in remotes.iter().flatten() {
            if let Ok(remote) = repo.find_remote(name) {
                if let Some(url) = remote.url() {
                    return Some(url.to_string());
                }
            }
        }
    }

    // 3. Fallback to CLI git remote get-url origin
    if let Ok(url) = run_git(repo, &["remote", "get-url", "origin"]) {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Ok(remotes_str) = run_git(repo, &["remote"]) {
        if let Some(first_remote) = remotes_str.lines().next() {
            let first_remote = first_remote.trim();
            if !first_remote.is_empty() {
                if let Ok(url) = run_git(repo, &["remote", "get-url", first_remote]) {
                    let trimmed = url.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }

    None
}

pub fn resolve_target_remote(repo: &Repository, target: Option<&str>) -> Option<String> {
    if let Some(t) = target {
        let trimmed = t.trim();
        if !trimmed.is_empty() && repo.find_remote(trimmed).is_ok() {
            return Some(trimmed.to_string());
        }
    }
    if repo.find_remote("origin").is_ok() {
        return Some("origin".to_string());
    }
    if let Ok(remotes) = repo.remotes() {
        if let Some(first) = remotes.get(0) {
            return Some(first.to_string());
        }
    }
    None
}

pub fn unpushed_oids(
    repo: &Repository,
    branch_name: Option<&str>,
    target_remote: Option<&str>,
) -> HashSet<Oid> {
    let Some(r_name) = resolve_target_remote(repo, target_remote) else {
        return HashSet::new();
    };

    let target_branch = branch_name
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .or_else(|| current_branch_name(repo));

    if let Some(ref b) = target_branch {
        if b == "detached" || b.starts_with("refs/remotes/") {
            return HashSet::new();
        }
        if repo.find_branch(b, BranchType::Remote).is_ok()
            && repo.find_branch(b, BranchType::Local).is_err()
        {
            return HashSet::new();
        }

        // Try git CLI first:
        // 1. Upstream rev-list
        if let Ok(revs) = run_git(repo, &["rev-list", &format!("{}@{{u}}..{}", b, b)]) {
            let mut set = HashSet::new();
            for line in revs.lines() {
                let line = line.trim();
                if let Ok(oid) = Oid::from_str(line) {
                    set.insert(oid);
                }
            }
            return set;
        }

        // 2. Direct remote tracking ref rev-list
        let remote_ref = format!("refs/remotes/{}/{}", r_name, b);
        if let Ok(revs) = run_git(repo, &["rev-list", &format!("{}..{}", remote_ref, b)]) {
            let mut set = HashSet::new();
            for line in revs.lines() {
                let line = line.trim();
                if let Ok(oid) = Oid::from_str(line) {
                    set.insert(oid);
                }
            }
            return set;
        }

        // 3. Commits on b not reachable from any ref on this remote
        let not_remote = format!("--remotes={}", r_name);
        if let Ok(revs) = run_git(repo, &["rev-list", b, "--not", &not_remote]) {
            let mut set = HashSet::new();
            for line in revs.lines() {
                let line = line.trim();
                if let Ok(oid) = Oid::from_str(line) {
                    set.insert(oid);
                }
            }
            return set;
        }
    } else {
        // No branch specified: all unpushed local commits
        let not_remote = format!("--remotes={}", r_name);
        if let Ok(revs) = run_git(repo, &["rev-list", "--branches", "--not", &not_remote]) {
            let mut set = HashSet::new();
            for line in revs.lines() {
                let line = line.trim();
                if let Ok(oid) = Oid::from_str(line) {
                    set.insert(oid);
                }
            }
            return set;
        }
    }

    // Libgit2 fallback:
    let Ok(mut revwalk) = repo.revwalk() else {
        return HashSet::new();
    };
    let _ = revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL);

    if let Some(ref b) = target_branch {
        if let Ok(local_branch) = repo.find_branch(b, BranchType::Local) {
            if let Some(head_oid) = local_branch.get().target() {
                if revwalk.push(head_oid).is_err() {
                    return HashSet::new();
                }
            } else {
                return HashSet::new();
            }
        } else if let Ok(r) = repo.revparse_single(b) {
            if revwalk.push(r.id()).is_err() {
                return HashSet::new();
            }
        } else {
            return HashSet::new();
        }
    } else if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for (branch, _) in branches.flatten() {
            if let Some(target) = branch.get().target() {
                let _ = revwalk.push(target);
            }
        }
    }

    let glob_pattern = format!("refs/remotes/{}/*", r_name);
    if let Ok(references) = repo.references_glob(&glob_pattern) {
        for r in references.flatten() {
            if let Some(target) = r
                .peel_to_commit()
                .map(|c| c.id())
                .ok()
                .or_else(|| r.target())
            {
                let _ = revwalk.hide(target);
            }
        }
    }

    if let Some(ref b) = target_branch {
        if let Ok(local_branch) = repo.find_branch(b, BranchType::Local) {
            if let Ok(upstream) = local_branch.upstream() {
                if let Some(target) = upstream
                    .get()
                    .peel_to_commit()
                    .map(|c| c.id())
                    .ok()
                    .or_else(|| upstream.get().target())
                {
                    let _ = revwalk.hide(target);
                }
            }
        }
    }

    revwalk.filter_map(Result::ok).collect()
}

pub fn repo_workdir(repo: &Repository) -> Result<&Path, String> {
    repo.workdir().ok_or_else(|| {
        "Working tree operations are not available for bare repositories".to_string()
    })
}

pub fn normalize_git_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn git_not_found_message() -> String {
    #[cfg(target_os = "windows")]
    {
        "git.exe was not found. Install Git for Windows and make sure it is available in PATH."
            .to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        "git was not found. Install Git and make sure it is available in PATH.".to_string()
    }
}

pub fn git_command() -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("git");
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("git")
    }
}

pub fn run_git(repo: &Repository, args: &[&str]) -> Result<String, String> {
    let output = git_command()
        .arg("-C")
        .arg(repo_workdir(repo)?)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        // Force English git output so message matching ("empty", "CONFLICT", ...)
        // works regardless of the user's locale.
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("LANGUAGE", "C")
        // Never block waiting for an editor (merge commits, cherry-pick --continue).
        .env("GIT_EDITOR", "true")
        .output()
        .map_err(|e| {
            if e.kind() == io::ErrorKind::NotFound {
                git_not_found_message()
            } else {
                format!("git could not be executed: {}", e)
            }
        })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

pub fn status_name(status: Status) -> &'static str {
    if status.contains(Status::CONFLICTED) {
        "conflicted"
    } else if status.contains(Status::WT_NEW) || status.contains(Status::INDEX_NEW) {
        "added"
    } else if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
        "deleted"
    } else if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
        "renamed"
    } else if status.contains(Status::WT_TYPECHANGE) || status.contains(Status::INDEX_TYPECHANGE) {
        "typechange"
    } else {
        "modified"
    }
}

pub fn status_has_staged(status: Status) -> bool {
    status.intersects(
        Status::INDEX_NEW
            | Status::INDEX_MODIFIED
            | Status::INDEX_DELETED
            | Status::INDEX_RENAMED
            | Status::INDEX_TYPECHANGE,
    )
}

pub fn status_has_unstaged(status: Status) -> bool {
    status.intersects(
        Status::WT_NEW
            | Status::WT_MODIFIED
            | Status::WT_DELETED
            | Status::WT_RENAMED
            | Status::WT_TYPECHANGE,
    )
}

pub fn delta_path(delta: DiffDelta<'_>) -> Option<String> {
    delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .map(normalize_git_path)
}

pub fn get_repo_info_from_repository(repo: &Repository, path: &str) -> Result<RepoInfo, String> {
    let branch_count = repo.branches(None).map(|b| b.count()).unwrap_or(0);

    let commit_count = repo
        .revwalk()
        .map(|mut r| {
            r.push_head().ok();
            r.count()
        })
        .unwrap_or(0);

    let current_branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_string))
        .or_else(|| {
            repo.config()
                .ok()
                .and_then(|cfg| cfg.get_string("init.defaultBranch").ok())
                .or(Some("main".to_string()))
        })
        .unwrap_or_else(|| "main".to_string());

    let workdir = repo
        .workdir()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from(path));

    let name = workdir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string());

    let (github_owner, github_repo) = origin_url(repo)
        .and_then(|u| parse_github_remote(&u))
        .map(|(owner, repo)| (Some(owner), Some(repo)))
        .unwrap_or((None, None));

    Ok(RepoInfo {
        path: workdir.to_string_lossy().to_string(),
        name,
        current_branch,
        github_owner,
        github_repo,
        branch_count,
        commit_count,
    })
}

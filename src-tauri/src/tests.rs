use crate::*;

#[test]
fn parses_content_length_response() {
    let response =
        parse_http_response(b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"ok\":true}xxxx")
            .expect("response should parse");

    assert_eq!(response.status_code, 200);
    assert_eq!(response.body, "{\"ok\":true}xxxx");
}

#[test]
fn test_repo_without_remotes_has_zero_unpushed() {
    let dir = std::env::temp_dir().join("differ-no-remotes-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    test_git(&["init", "-b", "main"], &dir);
    test_git(&["config", "user.email", "t@t.co"], &dir);
    test_git(&["config", "user.name", "t"], &dir);
    test_git(&["config", "commit.gpgsign", "false"], &dir);

    std::fs::write(dir.join("file.txt"), "hello").expect("write");
    test_git(&["add", "."], &dir);
    test_git(&["commit", "-m", "first commit"], &dir);

    let repo = Repository::open(&dir).expect("repo should open");
    assert_eq!(resolve_target_remote(&repo, None), None);
    assert_eq!(unpushed_oids(&repo, Some("main"), None).len(), 0);
    assert_eq!(unpushed_oids(&repo, None, None).len(), 0);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn test_pushed_commits_and_branching_behavior() {
    let dir = std::env::temp_dir().join("differ-unpushed-test");
    let remote_dir = std::env::temp_dir().join("differ-unpushed-remote");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&remote_dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    std::fs::create_dir_all(&remote_dir).expect("remote dir");

    test_git(&["init", "--bare", "-b", "main"], &remote_dir);
    test_git(&["init", "-b", "main"], &dir);
    test_git(&["config", "user.email", "t@t.co"], &dir);
    test_git(&["config", "user.name", "t"], &dir);
    test_git(&["config", "commit.gpgsign", "false"], &dir);
    test_git(
        &["remote", "add", "origin", remote_dir.to_str().unwrap()],
        &dir,
    );

    std::fs::write(dir.join("file.txt"), "hello").expect("write");
    test_git(&["add", "."], &dir);
    test_git(&["commit", "-m", "first commit"], &dir);
    test_git(&["push", "-u", "origin", "main"], &dir);

    let repo = Repository::open(&dir).expect("repo should open");

    // 1. After pushing main, 0 unpushed commits
    let unpushed = unpushed_oids(&repo, Some("main"), Some("origin"));
    assert_eq!(unpushed.len(), 0, "Pushed commit must not be unpushed");
    assert_eq!(unpushed_oids(&repo, None, Some("origin")).len(), 0);

    // 2. Remote branch reference should never report unpushed
    assert_eq!(
        unpushed_oids(&repo, Some("origin/main"), Some("origin")).len(),
        0
    );

    // 3. Add a commit to main
    std::fs::write(dir.join("file.txt"), "hello 2").expect("write");
    test_git(&["commit", "-am", "second commit"], &dir);
    let unpushed_after_commit = unpushed_oids(&repo, Some("main"), Some("origin"));
    assert_eq!(
        unpushed_after_commit.len(),
        1,
        "New commit on main should be unpushed"
    );

    // 4. Push with external git
    test_git(&["push", "origin", "main"], &dir);
    assert_eq!(
        unpushed_oids(&repo, Some("main"), Some("origin")).len(),
        0,
        "After push unpushed must be 0"
    );

    // 5. Checkout new branch 'feature' from main (0 new commits)
    test_git(&["checkout", "-b", "feature"], &dir);
    let unpushed_feature = unpushed_oids(&repo, Some("feature"), Some("origin"));
    assert_eq!(
        unpushed_feature.len(),
        0,
        "New branch branched from pushed commit must have 0 unpushed"
    );

    // 6. Commit on feature branch
    std::fs::write(dir.join("feature.txt"), "feat").expect("write");
    test_git(&["add", "."], &dir);
    test_git(&["commit", "-m", "feature commit"], &dir);
    assert_eq!(
        unpushed_oids(&repo, Some("feature"), Some("origin")).len(),
        1,
        "Feature commit should be unpushed"
    );
    assert_eq!(
        unpushed_oids(&repo, Some("main"), Some("origin")).len(),
        0,
        "Main should still have 0 unpushed"
    );

    // 7. Push feature without -u (git push origin feature)
    test_git(&["push", "origin", "feature"], &dir);
    assert_eq!(
        unpushed_oids(&repo, Some("feature"), Some("origin")).len(),
        0,
        "Feature pushed without -u must have 0 unpushed"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&remote_dir);
}

#[test]
fn test_custom_remote_name_resolution() {
    let dir = std::env::temp_dir().join("differ-custom-remote-test");
    let remote_dir = std::env::temp_dir().join("differ-custom-remote-target");
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&remote_dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    std::fs::create_dir_all(&remote_dir).expect("remote dir");

    test_git(&["init", "--bare", "-b", "main"], &remote_dir);
    test_git(&["init", "-b", "main"], &dir);
    test_git(&["config", "user.email", "t@t.co"], &dir);
    test_git(&["config", "user.name", "t"], &dir);
    test_git(&["config", "commit.gpgsign", "false"], &dir);
    test_git(
        &["remote", "add", "amelenext", remote_dir.to_str().unwrap()],
        &dir,
    );

    std::fs::write(dir.join("file.txt"), "hello").expect("write");
    test_git(&["add", "."], &dir);
    test_git(&["commit", "-m", "first commit"], &dir);
    test_git(&["push", "-u", "amelenext", "main"], &dir);

    let repo = Repository::open(&dir).expect("repo should open");
    assert_eq!(
        resolve_target_remote(&repo, None),
        Some("amelenext".to_string())
    );
    assert_eq!(
        resolve_target_remote(&repo, Some("origin")),
        Some("amelenext".to_string())
    );
    assert_eq!(unpushed_oids(&repo, Some("main"), None).len(), 0);
    assert_eq!(unpushed_oids(&repo, Some("main"), Some("origin")).len(), 0);

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&remote_dir);
}

fn test_git(args: &[&str], dir: &std::path::Path) {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("LC_ALL", "C")
        .output()
        .expect("git should run");
    assert!(
        out.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn conflict_diff_shows_ours_vs_theirs() {
    let dir = std::env::temp_dir().join("differ-conflict-diff-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    test_git(&["init", "-b", "master"], &dir);
    test_git(&["config", "user.email", "t@t.co"], &dir);
    test_git(&["config", "user.name", "t"], &dir);
    test_git(&["config", "commit.gpgsign", "false"], &dir);

    std::fs::write(dir.join("conflicted.txt"), "line1\nline2\nline3\n").expect("write");
    test_git(&["add", "."], &dir);
    test_git(&["commit", "-m", "base"], &dir);
    test_git(&["checkout", "-b", "feature"], &dir);
    std::fs::write(dir.join("conflicted.txt"), "line1\nINCOMING SIDE\nline3\n").expect("write");
    test_git(&["commit", "-am", "memo"], &dir);
    test_git(&["checkout", "master"], &dir);
    std::fs::write(dir.join("conflicted.txt"), "line1\nTARGET SIDE\nline3\n").expect("write");
    test_git(&["commit", "-am", "masterc"], &dir);

    let merge_out = std::process::Command::new("git")
        .args(["merge", "feature"])
        .current_dir(&dir)
        .env("LC_ALL", "C")
        .output()
        .expect("git merge");
    assert!(
        !merge_out.status.success(),
        "merge should conflict, got: {}",
        String::from_utf8_lossy(&merge_out.stdout)
    );

    let repo = Repository::open(&dir).expect("repo should open");
    let diff =
        build_conflict_diff(&repo, "conflicted.txt").expect("conflict diff should build");

    // Mimic the app lifecycle: open the repo handle BEFORE the merge happens,
    // then create the conflict via an external git process.
    let dir2 = std::env::temp_dir().join("differ-conflict-diff-test2");
    let _ = std::fs::remove_dir_all(&dir2);
    std::fs::create_dir_all(&dir2).expect("temp dir");
    test_git(&["init", "-b", "master"], &dir2);
    test_git(&["config", "user.email", "t@t.co"], &dir2);
    test_git(&["config", "user.name", "t"], &dir2);
    test_git(&["config", "commit.gpgsign", "false"], &dir2);
    std::fs::write(dir2.join("conflicted.txt"), "line1\nline2\nline3\n").expect("write");
    test_git(&["add", "."], &dir2);
    test_git(&["commit", "-m", "base"], &dir2);

    let early_repo = Repository::open(&dir2).expect("repo should open");

    test_git(&["checkout", "-b", "feature"], &dir2);
    std::fs::write(dir2.join("conflicted.txt"), "line1\nINCOMING SIDE\nline3\n")
        .expect("write");
    test_git(&["commit", "-am", "memo"], &dir2);
    test_git(&["checkout", "master"], &dir2);
    std::fs::write(dir2.join("conflicted.txt"), "line1\nTARGET SIDE\nline3\n").expect("write");
    test_git(&["commit", "-am", "masterc"], &dir2);
    let _ = std::process::Command::new("git")
        .args(["merge", "feature"])
        .current_dir(&dir2)
        .env("LC_ALL", "C")
        .output()
        .expect("git merge");

    let stale_result = build_conflict_diff(&early_repo, "conflicted.txt");
    eprintln!(
        "early-handle result: {:?}",
        stale_result.as_ref().map(|d| d.hunks.len())
    );
    assert!(
        stale_result.is_ok(),
        "conflict diff should work with a repo handle opened before the merge: {:?}",
        stale_result.err()
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&dir2);

    let texts: Vec<String> = diff
        .hunks
        .iter()
        .flat_map(|h| h.lines.iter())
        .map(|l| format!("{}:{}", l.line_type, l.content.trim()))
        .collect();
    eprintln!("conflict diff lines: {:?}", texts);

    assert!(
        texts
            .iter()
            .any(|l| l.starts_with("delete:") && l.contains("TARGET SIDE")),
        "ours (target branch) line should appear as delete, got: {:?}",
        texts
    );
    assert!(
        texts
            .iter()
            .any(|l| l.starts_with("add:") && l.contains("INCOMING SIDE")),
        "theirs (incoming branch) line should appear as add, got: {:?}",
        texts
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn parses_chunked_response() {
    let response = parse_http_response(
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{\"ok\":\r\n5\r\ntrue}\r\n0\r\n\r\n",
    )
    .expect("response should parse");

    assert_eq!(response.status_code, 200);
    assert_eq!(response.body, "{\"ok\":true}");
}

#[test]
#[ignore = "touches the real OS keychain"]
fn secret_roundtrip() {
    let name = "differ-selftest";
    set_secret(name, "s3cret").unwrap();
    assert_eq!(get_secret(name).as_deref(), Some("s3cret"));
    let in_keyring = keyring::Entry::new("differ", name).unwrap().get_password().is_ok();
    println!("stored in OS keychain: {}", in_keyring);
    set_secret(name, "").unwrap();
    assert_eq!(get_secret(name), None);
}

#[test]
fn branch_helpers_validate_names_and_split_remotes() {
    let dir = std::env::temp_dir().join("differ-branch-helpers-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    test_git(&["init", "-b", "main"], &dir);
    test_git(&["remote", "add", "origin", "https://example.com/a.git"], &dir);
    test_git(&["remote", "add", "team/fork", "https://example.com/b.git"], &dir);

    let repo = Repository::open(&dir).expect("repo should open");
    assert!(branches::validate_branch_name(&repo, "feature/login").is_ok());
    assert!(branches::validate_branch_name(&repo, "bad name").is_err());
    assert!(branches::validate_branch_name(&repo, "two..dots").is_err());
    assert!(branches::validate_branch_name(&repo, "  ").is_err());

    assert_eq!(
        branches::split_remote_branch(&repo, "origin/feature/x"),
        Some(("origin".to_string(), "feature/x".to_string()))
    );
    assert_eq!(
        branches::split_remote_branch(&repo, "team/fork/fix"),
        Some(("team/fork".to_string(), "fix".to_string()))
    );
    assert_eq!(branches::split_remote_branch(&repo, "unknown/x"), None);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commit_search_finds_by_text_author_path_and_hash() {
    let dir = std::env::temp_dir().join("differ-search-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");

    test_git(&["init", "-b", "main"], &dir);
    test_git(&["config", "user.email", "ali@t.co"], &dir);
    test_git(&["config", "user.name", "Ali"], &dir);
    test_git(&["config", "commit.gpgsign", "false"], &dir);
    std::fs::write(dir.join("a.txt"), "1").unwrap();
    test_git(&["add", "."], &dir);
    test_git(&["commit", "-m", "Add login screen"], &dir);
    std::fs::create_dir_all(dir.join("docs")).unwrap();
    std::fs::write(dir.join("docs/b.md"), "2").unwrap();
    test_git(&["add", "."], &dir);
    test_git(&["-c", "user.name=Veli", "-c", "user.email=veli@t.co", "commit", "-m", "Write docs"], &dir);

    let repo = Repository::open(&dir).unwrap();
    let run = |s: CommitSearch| -> Vec<String> {
        search_commit_ids(&repo, &s, None, 100)
            .unwrap()
            .into_iter()
            .map(|oid| repo.find_commit(oid).unwrap().summary().unwrap().to_string())
            .collect()
    };

    // Free text is case-insensitive and also matches the author.
    assert_eq!(run(CommitSearch { text: "LOGIN".into(), ..Default::default() }), vec!["Add login screen"]);
    assert_eq!(run(CommitSearch { text: "veli".into(), ..Default::default() }), vec!["Write docs"]);
    // Text + author must both match.
    assert!(run(CommitSearch { text: "login".into(), author: "veli".into(), ..Default::default() }).is_empty());
    assert_eq!(run(CommitSearch { text: "docs".into(), author: "veli".into(), ..Default::default() }), vec!["Write docs"]);
    // Plain author search returns every matching commit, newest first.
    assert_eq!(run(CommitSearch { text: "t.co".into(), ..Default::default() }), vec!["Write docs", "Add login screen"]);
    assert_eq!(run(CommitSearch { path: "docs".into(), ..Default::default() }), vec!["Write docs"]);
    // Regex characters are taken literally.
    assert!(run(CommitSearch { text: "log.n".into(), ..Default::default() }).is_empty());

    let head = repo.head().unwrap().target().unwrap().to_string();
    let found = repo.revparse_single(&head[..7]).unwrap().peel_to_commit().unwrap();
    assert_eq!(found.summary(), Some("Write docs"));

    let _ = std::fs::remove_dir_all(&dir);
}

function getGraphColor(index) {
  return GRAPH_PALETTE[index % GRAPH_PALETTE.length];
}

function getFilteredCommits() {
  const { commits: base, fromBackend } = searchBaseCommits();
  let commits = base;

  if (state.selectedAuthorKey) {
    const knownGithubUsernames = getKnownGithubUsernames();
    commits = commits.filter((commit) => (
      getContributorKey(commit, knownGithubUsernames) === state.selectedAuthorKey
    ));
  }

  if (!state.searchQuery || fromBackend) return commits;

  const q = parseSearchQuery(state.searchQuery);
  if (isSearchEmpty(q)) return commits;
  // A file filter can only be answered by the backend; show nothing until it does.
  if (q.path) return [];
  return commits.filter((commit) => matchesLocalSearch(commit, q));
}

function getAuthorStats() {
  const authors = new Map();
  const knownGithubUsernames = getKnownGithubUsernames();

  for (const commit of state.commits) {
    const key = getContributorKey(commit, knownGithubUsernames);
    const githubUsername = getGithubUsername(commit);
    const item = authors.get(key) || {
      name: commit.author_name || 'Unknown',
      email: commit.author_email || '',
      key,
      githubUsername,
      count: 0,
      lastTimestamp: commit.timestamp,
    };
    item.count += 1;
    item.githubUsername = item.githubUsername || githubUsername;
    if (!getGithubUsername(item) && githubUsername) item.email = commit.author_email || item.email;
    if (shouldReplaceAuthorName(item.name, commit.author_name, item.githubUsername)) {
      item.name = commit.author_name;
    }
    item.lastTimestamp = Math.max(item.lastTimestamp, commit.timestamp);
    authors.set(key, item);
  }

  return [...authors.values()].sort((a, b) => (
    b.count - a.count || b.lastTimestamp - a.lastTimestamp
  ));
}

function shouldReplaceAuthorName(currentName, nextName, githubUsername) {
  if (!nextName) return false;
  if (!currentName || currentName === 'Unknown') return true;
  if (!githubUsername) return false;

  const currentHandle = normalizeContributorHandle(currentName);
  const nextHandle = normalizeContributorHandle(nextName);
  const githubHandle = normalizeContributorHandle(githubUsername);

  return currentHandle === githubHandle
    && nextHandle === githubHandle
    && getAuthorNameScore(nextName) > getAuthorNameScore(currentName);
}

function getAuthorNameScore(name = '') {
  let score = 0;
  if (name !== name.toLowerCase()) score += 1;
  if (/\s/.test(name)) score += 1;
  if (/^[A-Z]/.test(name)) score += 1;
  return score;
}

function renderRepoShell() {
  if (!state.repoInfo) return;

  const authors = getAuthorStats();
  const selectedAuthor = authors.find((author) => author.key === state.selectedAuthorKey);
  if (els.repoName) els.repoName.textContent = state.repoInfo.name;
  els.sideRepoName.textContent = state.repoInfo.name;
  els.repoPath.textContent = state.repoInfo.path;
  els.activeBranch.textContent = state.selectedBranch || state.repoInfo.current_branch || 'tümü';
  els.branchCount.textContent = state.repoInfo.branch_count;
  els.commitCount.textContent = state.repoInfo.commit_count;
  if (els.sideBranchCount) els.sideBranchCount.textContent = state.branches.length;
  els.sideCommitCount.textContent = state.commits.length;
  els.sideAuthorCount.textContent = authors.length;
  const scope = state.selectedBranch
    ? `${state.selectedBranch} dalı geçmişi`
    : `${state.repoInfo.name} deposundaki tüm görünür commit'ler`;
  els.historySubtitle.textContent = selectedAuthor
    ? `${scope} · ${selectedAuthor.name}`
    : scope;
}

async function refreshRepositoryData({ selectLatest = false } = {}) {
  if (state.isRefreshing) return;
  state.isRefreshing = true;

  try {
    const branch = state.selectedBranch;
    const [branches, commits, tree, worktreeFiles, syncStatus] = await Promise.all([
      invoke('get_branches'),
      invoke('get_commits', { limit: 500, branch, targetRemote: state.activeRemote }),
      invoke('get_file_tree', { commitId: null }),
      invoke('get_worktree_status'),
      invoke('get_sync_status', { targetRemote: state.activeRemote }),
      fetchAndPopulateGitSettings(),
    ]);

    state.branches = branches;
    state.commits = commits;
    state.fileTree = tree;
    state.worktreeFiles = worktreeFiles;
    state.syncStatus = syncStatus;

    renderRepoShell();
    renderSyncStatus();
    renderWorktreeStatus();
    renderBranches();
    renderTeam();
    renderFileTree();
    renderCommits();
    await loadUnmergedCommits();

    if (selectLatest && state.commits.length > 0) {
      const visibleCommits = getFilteredCommits();
      await selectCommit((visibleCommits[0] || state.commits[0]).id);
    }

    try {
      state.lastFingerprint = await invoke('get_repo_fingerprint');
    } catch (fpErr) {
      console.warn('Could not update repo fingerprint:', fpErr);
    }
  } finally {
    state.isRefreshing = false;
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  state.refreshTimer = setInterval(autoRefreshTick, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
  state.lastFingerprint = null;
  state.isRefreshing = false;
  state.lastAutoCheck = 0;
}

async function autoRefreshTick() {
  if (!state.repoInfo || !invoke) return;
  if (document.hidden) return;
  if (state.isRefreshing) return;

  state.lastAutoCheck = Date.now();

  try {
    const fingerprint = await invoke('get_repo_fingerprint');
    if (state.lastFingerprint && fingerprint !== state.lastFingerprint) {
      state.lastFingerprint = fingerprint;
      await refreshRepositoryData();
      setStatus('Yenilendi: yeni değişiklikler algılandı');
    } else {
      state.lastFingerprint = fingerprint;
    }
  } catch (err) {
    console.warn('Auto-refresh check failed:', err);
  }
}

function showHomeScreen() {
  stopAutoRefresh();
  els.welcomeScreen.style.display = '';
  els.mainContent.style.display = 'none';
  els.repoInfo.style.display = 'none';
  els.searchBox.style.display = 'none';
  els.githubNav.style.display = 'none';
  if (els.btnOpenRepo) els.btnOpenRepo.style.display = '';
  renderRecentRepos();
  setStatus('Hazır');
}

function promptGitInit(path) {
  return new Promise((resolve) => {
    const modal = document.getElementById('init-repo-modal');
    const pathDisplay = document.getElementById('init-repo-path-display');
    const btnConfirm = document.getElementById('btn-confirm-init-repo');
    const btnDecline = document.getElementById('btn-decline-init-repo');
    const btnClose = document.getElementById('btn-cancel-init-repo');

    if (!modal || !btnConfirm || !btnDecline) {
      const ok = confirm(`Seçilen dizin bir Git deposu değil:\n\n${path}\n\nGit deposu olarak başlatılsın mı (git init)?`);
      return resolve(ok);
    }

    if (pathDisplay) pathDisplay.textContent = path;
    modal.removeAttribute('hidden');

    function cleanup(result) {
      modal.setAttribute('hidden', '');
      btnConfirm.removeEventListener('click', onConfirm);
      btnDecline.removeEventListener('click', onDecline);
      if (btnClose) btnClose.removeEventListener('click', onDecline);
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onDecline() { cleanup(false); }

    btnConfirm.addEventListener('click', onConfirm);
    btnDecline.addEventListener('click', onDecline);
    if (btnClose) btnClose.addEventListener('click', onDecline);
  });
}

async function openRepo(repoPath = null) {
  if (!invoke) {
    alert('Bu arayüz Tauri içinde çalıştırılmalıdır.');
    return;
  }

  try {
    let selected = repoPath;

    if (!selected) {
      if (!tauri?.dialog?.open) {
        alert('Depo seçici kullanılamıyor.');
        return;
      }

      selected = await tauri.dialog.open({
        directory: true,
        title: 'Git Deposu Seç',
      });
    }

    if (!selected) return;
    if (Array.isArray(selected)) [selected] = selected;
    if (!selected) return;

    setStatus('Depo kontrol ediliyor...');
    const isGit = await invoke('is_git_repository', { path: selected });
    let repoInfo = null;

    if (!isGit) {
      const shouldInit = await promptGitInit(selected);
      if (!shouldInit) {
        setStatus('Depo açma iptal edildi (Git deposu değil)');
        return;
      }
      setStatus('Git deposu başlatılıyor...');
      repoInfo = await invoke('init_repository', { path: selected });
      setStatus('Git deposu başarıyla başlatıldı!');
    } else {
      setStatus('Depo okunuyor...');
      repoInfo = await invoke('open_repo', { path: selected });
    }

    state.repoInfo = repoInfo;
    state.selectedBranch = null;
    state.selectedCommit = null;
    state.selectedAuthorKey = null;
    state.diffData = [];
    state.fileTree = [];
    state.worktreeFiles = [];
    state.selectedWorktreePaths.clear();
    state.selectedCoauthors = [];
    els.coauthorInput.value = '';
    renderCoauthors();
    state.syncStatus = null;
    state.avatarCache.clear();
    state.pendingAvatarFetches.clear();
    state.failedAvatarFetches.clear();

    els.welcomeScreen.style.display = 'none';
    els.mainContent.style.display = 'grid';
    els.repoInfo.style.display = 'flex';
    els.searchBox.style.display = 'flex';
    if (els.btnOpenRepo) els.btnOpenRepo.style.display = 'none';
    els.detailEmpty.style.display = 'flex';
    els.detailContent.style.display = 'none';

    // Load all git remotes (origin, upstream, fork, etc.)
    await loadGitRemotes();
    await refreshRepositoryData({ selectLatest: true });
    rememberRecentRepo(repoInfo.path || selected);
    startAutoRefresh();

    // Show GitHub nav if repo has GitHub remote
    showGhNavIfGitHub();
    // Check gh CLI auth in background
    checkGhAuth().catch(() => {});
    // Detect installed editors (VS Code, Code OSS, Zed, Cursor, VSCodium)
    checkAndRenderInstalledEditors();

    setStatus(`${repoInfo.name} yüklendi: ${state.commits.length} commit`);
  } catch (err) {
    console.error(err);
    setStatus('Depo açılamadı');
    alert(`Hata: ${err}`);
  }
}

async function loadCommits(branch = null) {
  try {
    setStatus(branch ? `${branch} dalının geçmişi okunuyor...` : 'Commit geçmişi okunuyor...');
    const commits = await invoke('get_commits', { limit: 500, branch, targetRemote: state.activeRemote });
    state.commits = commits;
    state.selectedBranch = branch;
    state.selectedCommit = null;
    state.diffData = [];
    state.unmergedTarget = null;
    state.unmergedManual = false;

    renderRepoShell();
    renderBranches();
    renderTeam();
    renderCommits();
    if (state.searchQuery) onSearchInput(state.searchQuery); // re-run search for the new branch
    await loadSyncStatus();
    await loadUnmergedCommits();

    els.detailEmpty.style.display = 'flex';
    els.detailContent.style.display = 'none';

    if (commits.length > 0) {
      await selectCommit(commits[0].id);
    }

    setStatus(`${commits.length} commit listelendi`);
  } catch (err) {
    console.error(err);
    setStatus('Commit\'ler yüklenemedi');
    alert(`Commit\'ler yüklenemedi: ${err}`);
  }
}

async function loadCommitDiff(commitId) {
  const diff = await invoke('get_commit_diff', { commitId });
  state.diffData = diff;
  renderDiff();
}

async function loadFileTree(commitId = null) {
  const tree = await invoke('get_file_tree', { commitId });
  state.fileTree = tree;
  renderFileTree();
}

async function loadWorktreeStatus() {
  state.worktreeFiles = await invoke('get_worktree_status');
  renderWorktreeStatus();
}

async function loadSyncStatus() {
  state.syncStatus = await invoke('get_sync_status', { targetRemote: state.activeRemote });
  renderSyncStatus();
}

function renderSyncStatus() {
  const sync = state.syncStatus;
  const activeRemote = state.activeRemote || 'origin';

  if (!sync) {
    if (els.topSyncPillText) els.topSyncPillText.textContent = 'uzak depo yok';
    if (els.originLabel) els.originLabel.textContent = 'uzak depo yok';
    if (els.pushLabel) els.pushLabel.textContent = 'uzak bağlantı bekleniyor';
    if (els.btnPushOrigin) els.btnPushOrigin.disabled = true;
    if (els.topPushBtn) els.topPushBtn.style.display = 'none';
    return;
  }

  if (!sync.has_origin) {
    if (els.topSyncPillText) els.topSyncPillText.textContent = 'uzak depo yok';
    if (els.originLabel) els.originLabel.textContent = 'uzak depo yok';
    if (els.pushLabel) els.pushLabel.textContent = 'uzak bağlantı yok';
    if (els.btnPushOrigin) {
      els.btnPushOrigin.textContent = 'Push';
      els.btnPushOrigin.disabled = true;
    }
    if (els.topPushBtn) els.topPushBtn.style.display = 'none';
    return;
  }

  const syncText = sync.unpushed_count > 0
    ? `${activeRemote} · ${sync.unpushed_count} gönderilmedi`
    : `${activeRemote} · güncel`;

  if (els.topSyncPillText) els.topSyncPillText.textContent = syncText;
  if (els.originLabel) els.originLabel.textContent = sync.origin_url || `${activeRemote} bağlı`;

  if (sync.unpushed_count > 0 && sync.can_push) {
    if (els.topPushBtn) els.topPushBtn.style.display = 'inline-flex';
    if (els.topPushBtnText) els.topPushBtnText.textContent = `Push (${sync.unpushed_count})`;
  } else {
    if (els.topPushBtn) els.topPushBtn.style.display = 'none';
  }

  if (els.btnPushOrigin) {
    if (!sync.can_push) {
      els.btnPushOrigin.textContent = 'Push';
      els.btnPushOrigin.disabled = true;
    } else if (!sync.upstream) {
      els.btnPushOrigin.textContent = `Yayınla (${activeRemote})`;
      els.btnPushOrigin.disabled = false;
    } else {
      els.btnPushOrigin.textContent = sync.unpushed_count > 0 ? `Push (${sync.unpushed_count})` : 'Push';
      els.btnPushOrigin.disabled = sync.unpushed_count === 0;
    }
  }

  if (els.pushLabel) {
    if (!sync.can_push) {
      els.pushLabel.textContent = 'etkin dal push yapılamaz';
    } else if (!sync.upstream) {
      els.pushLabel.textContent = `${sync.current_branch}, ${activeRemote} uzak deposuna yayınlanacak`;
    } else {
      els.pushLabel.textContent = sync.unpushed_count > 0
        ? `${activeRemote} deposundan ${sync.unpushed_count} commit ileride`
        : `${activeRemote} ile güncel`;
    }
  }
}

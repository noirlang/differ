const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const RECENT_REPOS_KEY = 'differ.recentRepos';
const MAX_RECENT_REPOS = 5;

const state = {
  repoInfo: null,
  branches: [],
  commits: [],
  filteredCommitIds: [],
  selectedBranch: null,
  selectedCommit: null,
  selectedAuthorKey: null,
  diffData: [],
  fileTree: [],
  worktreeFiles: [],
  selectedWorktreePaths: new Set(),
  syncStatus: null,
  searchQuery: '',
  detailTab: 'diff',
  avatarCache: new Map(),
  pendingAvatarFetches: new Set(),
  failedAvatarFetches: new Set(),
  avatarRefreshTimer: null,
};

const $ = (id) => document.getElementById(id);

const els = {
  welcomeScreen: $('welcome-screen'),
  mainContent: $('main-content'),
  btnHome: $('btn-home'),
  btnOpenRepo: $('btn-open-repo'),
  btnWelcomeOpen: $('btn-welcome-open'),
  recentRepos: $('recent-repos'),
  recentRepoList: $('recent-repo-list'),
  repoInfo: $('repo-info'),
  repoName: $('repo-name'),
  repoPath: $('repo-path'),
  sideRepoName: $('side-repo-name'),
  activeBranch: $('active-branch'),
  branchCount: $('branch-count'),
  commitCount: $('commit-count'),
  topSyncPill: $('top-sync-pill'),
  sideBranchCount: $('side-branch-count'),
  sideCommitCount: $('side-commit-count'),
  sideAuthorCount: $('side-author-count'),
  originLabel: $('origin-label'),
  pushLabel: $('push-label'),
  btnPushOrigin: $('btn-push-origin'),
  btnRefreshStatus: $('btn-refresh-status'),
  worktreeList: $('worktree-list'),
  commitMessageInput: $('commit-message-input'),
  btnCommitSelected: $('btn-commit-selected'),
  searchBox: $('search-box'),
  searchInput: $('search-input'),
  branchList: $('branch-list'),
  fileTree: $('file-tree'),
  teamList: $('team-list'),
  btnShowContributors: $('btn-show-contributors'),
  contributorsModal: $('contributors-modal'),
  btnCloseContributors: $('btn-close-contributors'),
  contributorsPodium: $('contributors-podium'),
  contributorsRanking: $('contributors-ranking'),
  historySubtitle: $('history-subtitle'),
  commitList: $('commit-list'),
  detailEmpty: $('detail-empty'),
  detailContent: $('detail-content'),
  detailAvatar: $('detail-avatar'),
  detailMessage: $('detail-message'),
  detailAuthor: $('detail-author'),
  detailDate: $('detail-date'),
  detailHash: $('detail-hash'),
  changedSummary: $('changed-summary'),
  changedFiles: $('changed-files'),
  diffContainer: $('diff-container'),
  statusText: $('status-text'),
};

const graphColors = [
  'var(--graph-1)',
  'var(--graph-2)',
  'var(--graph-3)',
  'var(--graph-4)',
  'var(--graph-5)',
  'var(--graph-6)',
];

const statusConfig = {
  added: { label: 'A', text: 'Added' },
  deleted: { label: 'D', text: 'Deleted' },
  modified: { label: 'M', text: 'Modified' },
  renamed: { label: 'R', text: 'Renamed' },
  copied: { label: 'C', text: 'Copied' },
  unknown: { label: '?', text: 'Unknown' },
};

const worktreeStatusConfig = {
  added: { label: 'A', text: 'New' },
  deleted: { label: 'D', text: 'Deleted' },
  modified: { label: 'M', text: 'Modified' },
  renamed: { label: 'R', text: 'Renamed' },
  typechange: { label: 'T', text: 'Type' },
  conflicted: { label: '!', text: 'Conflict' },
};

function setStatus(message) {
  els.statusText.textContent = message;
}

function escapeHtml(text = '') {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getGithubUsername(author) {
  const email = (author.email || author.author_email || '').trim();
  const noreply = email.match(/^(?:\d+\+)?([A-Za-z0-9-]+(?:\[bot\])?)@users\.noreply\.github\.com$/i);
  const legacyNoreply = email.match(/^([A-Za-z0-9-]+(?:\[bot\])?)@noreply\.github\.com$/i);

  if (noreply) return noreply[1];
  if (legacyNoreply) return legacyNoreply[1];
  return null;
}

function normalizeContributorHandle(value = '') {
  return value
    .trim()
    .replace(/^@/, '')
    .toLowerCase();
}

function getEmailLocalPart(author) {
  const email = (author.email || author.author_email || '').trim();
  const atIndex = email.indexOf('@');
  return atIndex > 0 ? email.slice(0, atIndex) : '';
}

function getKnownGithubUsernames(commits = state.commits) {
  return new Set(
    commits
      .map((commit) => getGithubUsername(commit))
      .filter(Boolean)
      .map(normalizeContributorHandle),
  );
}

function getAuthorCacheKey(author) {
  return (author.email || author.author_email || author.name || author.author_name || 'unknown').toLowerCase();
}

function getContributorKey(author, knownGithubUsernames = getKnownGithubUsernames()) {
  const githubUsername = getGithubUsername(author);
  if (githubUsername) return `github:${normalizeContributorHandle(githubUsername)}`;

  const nameHandle = normalizeContributorHandle(author.name || author.author_name || '');
  if (knownGithubUsernames.has(nameHandle)) return `github:${nameHandle}`;

  const emailHandle = normalizeContributorHandle(getEmailLocalPart(author));
  if (knownGithubUsernames.has(emailHandle)) return `github:${emailHandle}`;

  const email = (author.email || author.author_email || '').trim().toLowerCase();
  if (email) return `email:${email}`;

  return `name:${nameHandle || 'unknown'}`;
}

function getCommitAuthorKey(commit) {
  return getContributorKey(commit);
}

function getAuthorAvatarSource(author) {
  const cached = state.avatarCache.get(getAuthorCacheKey(author));
  if (cached) return cached;

  const username = getGithubUsername(author) || author.githubUsername;
  if (!username) return null;

  return {
    username,
    url: `https://github.com/${encodeURIComponent(username)}.png?size=96`,
  };
}

function renderAuthorAvatar(author, className = '') {
  const name = author.name || author.author_name || 'Unknown';
  const source = getAuthorAvatarSource(author);
  const initials = escapeHtml(getInitials(name));

  if (!source) {
    return `<span class="author-avatar ${className}"><span class="avatar-fallback">${initials}</span></span>`;
  }

  const safeUsername = escapeHtml(source.username);

  return `
    <span class="author-avatar has-image ${className}" title="GitHub: @${safeUsername}">
      <img src="${escapeHtml(source.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
      <span class="avatar-fallback">${initials}</span>
    </span>
  `;
}

function hydrateAvatarFallbacks(root = document) {
  root.querySelectorAll('.author-avatar.has-image img').forEach((img) => {
    img.addEventListener('error', () => {
      img.remove();
      img.parentElement?.classList.add('avatar-failed');
    }, { once: true });
  });
}

function queueGithubAvatarFetches(commits) {
  const { github_owner: owner, github_repo: repo } = state.repoInfo || {};
  if (!owner || !repo) return;

  commits.forEach((commit) => {
    if (getGithubUsername(commit)) return;

    const key = getAuthorCacheKey(commit);
    if (state.avatarCache.has(key) || state.pendingAvatarFetches.has(key) || state.failedAvatarFetches.has(key)) return;

    state.pendingAvatarFetches.add(key);
    fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${commit.id}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.author?.avatar_url && data?.author?.login) {
          state.avatarCache.set(key, {
            username: data.author.login,
            url: data.author.avatar_url,
          });
          scheduleAvatarRefresh();
        } else {
          state.failedAvatarFetches.add(key);
        }
      })
      .catch(() => state.failedAvatarFetches.add(key))
      .finally(() => state.pendingAvatarFetches.delete(key));
  });
}

function scheduleAvatarRefresh() {
  window.clearTimeout(state.avatarRefreshTimer);
  state.avatarRefreshTimer = window.setTimeout(() => {
    renderTeam();
    renderCommits();

    if (state.selectedCommit) {
      const commit = state.commits.find((item) => item.id === state.selectedCommit);
      if (commit && els.detailAvatar) {
        els.detailAvatar.innerHTML = renderAuthorAvatar(commit, 'large');
        hydrateAvatarFallbacks(els.detailAvatar);
      }
    }
  }, 80);
}

function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatFullDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function firstLine(message) {
  return (message || '(no commit message)').split('\n')[0];
}

function splitPath(path) {
  const parts = path.split('/');
  const name = parts.pop() || path;
  return { name, dir: parts.join('/') };
}

function getRepoDisplayName(repoPath) {
  const cleanPath = repoPath.replace(/[\\/]+$/, '');
  return cleanPath.split(/[\\/]/).pop() || cleanPath;
}

function readRecentRepos() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_REPOS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => typeof item === 'string' && item.trim())
      .slice(0, MAX_RECENT_REPOS);
  } catch {
    return [];
  }
}

function writeRecentRepos(repoPaths) {
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repoPaths.slice(0, MAX_RECENT_REPOS)));
}

function rememberRecentRepo(repoPath) {
  const normalizedPath = String(repoPath || '').trim();
  if (!normalizedPath) return;

  const recentRepos = readRecentRepos().filter((path) => path !== normalizedPath);
  writeRecentRepos([normalizedPath, ...recentRepos]);
  renderRecentRepos();
}

function renderRecentRepos() {
  const recentRepos = readRecentRepos();
  els.recentRepos.hidden = recentRepos.length === 0;
  els.recentRepoList.replaceChildren();

  recentRepos.forEach((repoPath) => {
    const button = document.createElement('button');
    button.className = 'recent-repo-item';
    button.type = 'button';
    button.setAttribute('aria-label', `Open ${getRepoDisplayName(repoPath)}`);

    const icon = document.createElement('span');
    icon.className = 'recent-repo-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h4l2 2.5h5A2.5 2.5 0 0 1 20 10v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"></path></svg>';

    const copy = document.createElement('span');
    copy.className = 'recent-repo-copy';

    const name = document.createElement('strong');
    name.textContent = getRepoDisplayName(repoPath);

    const path = document.createElement('span');
    path.textContent = repoPath;

    copy.append(name, path);
    button.append(icon, copy);
    button.addEventListener('click', () => openRepo(repoPath));
    els.recentRepoList.append(button);
  });
}

function getGraphColor(index) {
  return graphColors[index % graphColors.length];
}

function getFilteredCommits() {
  let commits = state.commits;

  if (state.selectedAuthorKey) {
    const knownGithubUsernames = getKnownGithubUsernames();
    commits = commits.filter((commit) => (
      getContributorKey(commit, knownGithubUsernames) === state.selectedAuthorKey
    ));
  }

  if (!state.searchQuery) return commits;

  const q = state.searchQuery.toLowerCase();
  return commits.filter((commit) => (
    commit.message.toLowerCase().includes(q)
    || commit.author_name.toLowerCase().includes(q)
    || commit.author_email.toLowerCase().includes(q)
    || commit.short_id.toLowerCase().includes(q)
    || commit.id.toLowerCase().includes(q)
  ));
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
  els.repoName.textContent = state.repoInfo.name;
  els.sideRepoName.textContent = state.repoInfo.name;
  els.repoPath.textContent = state.repoInfo.path;
  els.activeBranch.textContent = state.selectedBranch || state.repoInfo.current_branch || 'all';
  els.branchCount.textContent = state.repoInfo.branch_count;
  els.commitCount.textContent = state.repoInfo.commit_count;
  els.sideBranchCount.textContent = state.branches.length;
  els.sideCommitCount.textContent = state.commits.length;
  els.sideAuthorCount.textContent = authors.length;
  const scope = state.selectedBranch
    ? `${state.selectedBranch} branch history`
    : `All visible commits in ${state.repoInfo.name}`;
  els.historySubtitle.textContent = selectedAuthor
    ? `${scope} · ${selectedAuthor.name}`
    : scope;
}

async function refreshRepositoryData({ selectLatest = false } = {}) {
  const branch = state.selectedBranch;
  const [branches, commits, tree, worktreeFiles, syncStatus] = await Promise.all([
    invoke('get_branches'),
    invoke('get_commits', { limit: 500, branch }),
    invoke('get_file_tree', { commitId: null }),
    invoke('get_worktree_status'),
    invoke('get_sync_status'),
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

  if (selectLatest && state.commits.length > 0) {
    const visibleCommits = getFilteredCommits();
    await selectCommit((visibleCommits[0] || state.commits[0]).id);
  }
}

function showHomeScreen() {
  els.welcomeScreen.style.display = '';
  els.mainContent.style.display = 'none';
  els.repoInfo.style.display = 'none';
  els.searchBox.style.display = 'none';
  renderRecentRepos();
  setStatus('Ready');
}

async function openRepo(repoPath = null) {
  if (!invoke) {
    alert('This interface must be run inside Tauri.');
    return;
  }

  try {
    let selected = repoPath;

    if (!selected) {
      if (!tauri?.dialog?.open) {
        alert('The repository picker is not available.');
        return;
      }

      selected = await tauri.dialog.open({
        directory: true,
        title: 'Select Git Repository',
      });
    }

    if (!selected) return;
    if (Array.isArray(selected)) [selected] = selected;
    if (!selected) return;

    setStatus('Reading repository...');
    const repoInfo = await invoke('open_repo', { path: selected });
    state.repoInfo = repoInfo;
    state.selectedBranch = null;
    state.selectedCommit = null;
    state.selectedAuthorKey = null;
    state.diffData = [];
    state.fileTree = [];
    state.worktreeFiles = [];
    state.selectedWorktreePaths.clear();
    state.syncStatus = null;
    state.avatarCache.clear();
    state.pendingAvatarFetches.clear();
    state.failedAvatarFetches.clear();

    els.welcomeScreen.style.display = 'none';
    els.mainContent.style.display = 'grid';
    els.repoInfo.style.display = 'flex';
    els.searchBox.style.display = 'flex';
    els.detailEmpty.style.display = 'flex';
    els.detailContent.style.display = 'none';

    await refreshRepositoryData({ selectLatest: true });
    rememberRecentRepo(repoInfo.path || selected);

    setStatus(`${repoInfo.name} loaded: ${state.commits.length} commits`);
  } catch (err) {
    console.error(err);
    setStatus('Repository could not be opened');
    alert(`Error: ${err}`);
  }
}

async function loadCommits(branch = null) {
  try {
    setStatus(branch ? `Reading ${branch} branch history...` : 'Reading commit history...');
    const commits = await invoke('get_commits', { limit: 500, branch });
    state.commits = commits;
    state.selectedBranch = branch;
    state.selectedCommit = null;
    state.diffData = [];

    renderRepoShell();
    renderBranches();
    renderTeam();
    renderCommits();
    await loadSyncStatus();

    els.detailEmpty.style.display = 'flex';
    els.detailContent.style.display = 'none';

    if (commits.length > 0) {
      await selectCommit(commits[0].id);
    }

    setStatus(`${commits.length} commits listed`);
  } catch (err) {
    console.error(err);
    setStatus('Commits could not be loaded');
    alert(`Commits could not be loaded: ${err}`);
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
  state.syncStatus = await invoke('get_sync_status');
  renderSyncStatus();
}

function renderSyncStatus() {
  const sync = state.syncStatus;

  if (!sync) {
    els.topSyncPill.textContent = 'no origin';
    els.originLabel.textContent = 'no origin';
    els.pushLabel.textContent = 'waiting for remote connection';
    els.btnPushOrigin.disabled = true;
    return;
  }

  if (!sync.has_origin) {
    els.topSyncPill.textContent = 'no origin';
    els.originLabel.textContent = 'no origin';
    els.pushLabel.textContent = 'no remote connection';
    els.btnPushOrigin.textContent = 'Push';
    els.btnPushOrigin.disabled = true;
    return;
  }

  const originText = sync.origin_url || 'origin connected';
  els.topSyncPill.textContent = sync.unpushed_count > 0
    ? `origin · ${sync.unpushed_count} unpushed`
    : 'origin · up to date';
  els.originLabel.textContent = originText;

  if (!sync.can_push) {
    els.pushLabel.textContent = 'active branch cannot be pushed';
    els.btnPushOrigin.textContent = 'Push';
    els.btnPushOrigin.disabled = true;
    return;
  }

  if (!sync.upstream) {
    els.pushLabel.textContent = `${sync.current_branch} will be published to origin`;
    els.btnPushOrigin.textContent = 'Publish';
    els.btnPushOrigin.disabled = false;
    return;
  }

  els.pushLabel.textContent = sync.unpushed_count > 0
    ? `${sync.unpushed_count} commits waiting to be pushed`
    : `up to date with ${sync.upstream}`;
  els.btnPushOrigin.textContent = sync.unpushed_count > 0 ? `Push ${sync.unpushed_count}` : 'Push';
  els.btnPushOrigin.disabled = sync.unpushed_count === 0;
}

function updateCommitAction() {
  const count = state.selectedWorktreePaths.size;
  const hasMessage = els.commitMessageInput.value.trim().length > 0;
  els.btnCommitSelected.disabled = count === 0 || !hasMessage;
  els.btnCommitSelected.textContent = count > 0
    ? `Commit ${count} files`
    : 'Commit selected files';
}

function renderWorktreeStatus() {
  const validPaths = new Set(state.worktreeFiles.map((file) => file.path));
  [...state.selectedWorktreePaths].forEach((path) => {
    if (!validPaths.has(path)) state.selectedWorktreePaths.delete(path);
  });

  if (state.worktreeFiles.length === 0) {
    els.worktreeList.innerHTML = '<div class="muted-row">No pending changes to commit</div>';
    updateCommitAction();
    return;
  }

  els.worktreeList.innerHTML = state.worktreeFiles.map((file) => {
    const config = worktreeStatusConfig[file.status] || { label: '?', text: file.status };
    const { name, dir } = splitPath(file.path);
    const checked = state.selectedWorktreePaths.has(file.path) ? 'checked' : '';
    const stagedText = file.conflicted ? 'conflict' : file.staged && file.unstaged ? 'staged + unstaged' : file.staged ? 'staged' : 'unstaged';

    return `
      <label class="worktree-file ${file.conflicted ? 'conflicted' : ''}">
        <input type="checkbox" value="${escapeHtml(file.path)}" ${checked} ${file.conflicted ? 'disabled' : ''}>
        <span class="file-status ${file.status}">${config.label}</span>
        <span class="worktree-path">
          <strong>${escapeHtml(name)}</strong>
          ${dir ? `<small>${escapeHtml(dir)}</small>` : ''}
        </span>
        <span class="worktree-state">${stagedText}</span>
      </label>
    `;
  }).join('');

  els.worktreeList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        state.selectedWorktreePaths.add(input.value);
      } else {
        state.selectedWorktreePaths.delete(input.value);
      }
      updateCommitAction();
    });
  });

  updateCommitAction();
}

async function commitSelectedChanges() {
  const paths = [...state.selectedWorktreePaths];
  const message = els.commitMessageInput.value.trim();

  if (paths.length === 0 || !message) {
    updateCommitAction();
    return;
  }

  try {
    els.btnCommitSelected.disabled = true;
    setStatus('Creating commit...');
    await invoke('commit_changes', { paths, message });
    state.selectedWorktreePaths.clear();
    els.commitMessageInput.value = '';
    await refreshRepositoryData({ selectLatest: true });
    setStatus('Commit created');
  } catch (err) {
    console.error(err);
    setStatus('Commit could not be created');
    alert(`Commit could not be created: ${err}`);
  } finally {
    updateCommitAction();
  }
}

async function pushOrigin() {
  try {
    els.btnPushOrigin.disabled = true;
    setStatus('Pushing...');
    await invoke('push_origin');
    await refreshRepositoryData();
    setStatus('Push completed');
  } catch (err) {
    console.error(err);
    setStatus('Push failed');
    alert(`Push failed: ${err}`);
  } finally {
    renderSyncStatus();
  }
}

function renderBranches() {
  const branchRows = [
    `<button class="branch-item ${state.selectedBranch ? '' : 'active'}" type="button" data-branch="">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16"></path><path d="M4 6h16"></path><path d="M4 18h16"></path></svg>
      <span class="branch-name">All History</span>
      <span class="branch-badge">all</span>
    </button>`,
  ];

  for (const branch of state.branches) {
    const active = state.selectedBranch === branch.name || (!state.selectedBranch && branch.is_head);
    const badge = branch.is_head ? 'HEAD' : branch.is_remote ? 'remote' : 'local';
    branchRows.push(`
      <button class="branch-item ${active ? 'active' : ''}" type="button" data-branch="${escapeHtml(branch.name)}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3v12"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="6" r="3"></circle>
          <path d="M18 9a9 9 0 0 1-9 9"></path>
        </svg>
        <span class="branch-name">${escapeHtml(branch.name)}</span>
        <span class="branch-badge ${branch.is_head ? 'head' : ''}">${badge}</span>
      </button>
    `);
  }

  els.branchList.innerHTML = branchRows.join('');
  els.branchList.querySelectorAll('.branch-item').forEach((item) => {
    item.addEventListener('click', () => {
      const branch = item.dataset.branch || null;
      loadCommits(branch);
    });
  });
}

function renderTeam() {
  const authors = getAuthorStats();

  if (authors.length === 0) {
    els.teamList.innerHTML = '<div class="muted-row">No commits yet</div>';
    return;
  }

  els.teamList.innerHTML = authors.slice(0, 8).map((author) => {
    const avatarSource = getAuthorAvatarSource(author);
    const username = avatarSource?.username || author.githubUsername;
    const active = state.selectedAuthorKey === author.key ? 'active' : '';

    return `
      <button class="team-member ${active}" type="button" data-author-key="${escapeHtml(author.key)}">
        ${renderAuthorAvatar(author)}
        <span class="team-info">
          <strong>${escapeHtml(author.name)}</strong>
          <small>${username ? `@${escapeHtml(username)} · ` : ''}${author.count} commit · ${formatDate(author.lastTimestamp)}</small>
        </span>
      </button>
    `;
  }).join('');

  els.teamList.querySelectorAll('.team-member').forEach((item) => {
    item.addEventListener('click', () => {
      state.selectedAuthorKey = state.selectedAuthorKey === item.dataset.authorKey
        ? null
        : item.dataset.authorKey;
      state.selectedCommit = null;
      renderRepoShell();
      renderTeam();
      renderCommits();
      els.detailEmpty.style.display = 'flex';
      els.detailContent.style.display = 'none';
    });
  });
  hydrateAvatarFallbacks(els.teamList);
}

function openContributorsModal() {
  const authors = getAuthorStats();
  const topAuthors = authors.slice(0, 3);

  if (topAuthors.length === 0) {
    els.contributorsPodium.innerHTML = '<div class="muted-row">No contributors yet</div>';
    els.contributorsRanking.innerHTML = '';
  } else {
    els.contributorsPodium.innerHTML = topAuthors.map((author, index) => {
      const place = index + 1;
      const medal = ['1.', '2.', '3.'][index];
      const avatarSource = getAuthorAvatarSource(author);
      const username = avatarSource?.username || author.githubUsername;
      return `
        <div class="podium-card place-${place}">
          <span class="podium-place">${medal}</span>
          ${renderAuthorAvatar(author, 'large')}
          <strong>${escapeHtml(author.name)}</strong>
          <small>${username ? `@${escapeHtml(username)} · ` : ''}${author.count} commit</small>
        </div>
      `;
    }).join('');

    els.contributorsRanking.innerHTML = authors.slice(3, 10).map((author, index) => `
      <div class="ranking-row">
        <span>${index + 4}.</span>
        ${renderAuthorAvatar(author)}
        <strong>${escapeHtml(author.name)}</strong>
        <small>${author.count} commit</small>
      </div>
    `).join('');
  }

  els.contributorsModal.hidden = false;
  hydrateAvatarFallbacks(els.contributorsModal);
  els.btnCloseContributors.focus();
}

function closeContributorsModal() {
  els.contributorsModal.hidden = true;
}

function assignLanes(commits) {
  const laneMap = new Map();
  const activeLanes = [];
  let maxLane = 0;

  commits.forEach((commit) => {
    let lane = activeLanes.findIndex((id) => id === commit.id);

    if (lane === -1) {
      const freeLane = activeLanes.findIndex((id) => id === null);
      lane = freeLane === -1 ? activeLanes.length : freeLane;
      activeLanes[lane] = commit.id;
    }

    laneMap.set(commit.id, lane);
    maxLane = Math.max(maxLane, lane);

    if (commit.parent_ids.length > 0) {
      activeLanes[lane] = commit.parent_ids[0];

      for (let i = 1; i < commit.parent_ids.length; i += 1) {
        if (!activeLanes.includes(commit.parent_ids[i])) {
          const freeLane = activeLanes.findIndex((id) => id === null);
          if (freeLane === -1) {
            activeLanes.push(commit.parent_ids[i]);
          } else {
            activeLanes[freeLane] = commit.parent_ids[i];
          }
        }
      }
    } else {
      activeLanes[lane] = null;
    }
  });

  return { laneMap, laneCount: Math.max(maxLane + 1, 1) };
}

function renderCommits() {
  const commits = getFilteredCommits();
  state.filteredCommitIds = commits.map((commit) => commit.id);

  if (commits.length === 0) {
    els.commitList.innerHTML = `
      <div class="empty-state compact">
        <strong>No results</strong>
        <span>No commits match the current search or branch filter.</span>
      </div>
    `;
    return;
  }

  const branchLabels = new Map();
  state.branches.forEach((branch) => {
    if (!branchLabels.has(branch.commit_id)) branchLabels.set(branch.commit_id, []);
    branchLabels.get(branch.commit_id).push(branch);
  });

  const { laneMap, laneCount } = assignLanes(commits);

  els.commitList.innerHTML = commits.map((commit, index) => {
    const lane = laneMap.get(commit.id) || 0;
    const color = getGraphColor(lane);
    const labels = (branchLabels.get(commit.id) || []).slice(0, 3).map((branch) => (
      `<span class="branch-label ${branch.is_remote ? 'remote' : 'local'}">${escapeHtml(branch.name)}</span>`
    )).join('');
    const selected = state.selectedCommit === commit.id ? 'selected' : '';
    const localOnly = commit.is_unpushed ? 'local-only' : '';
    const syncLabel = commit.is_unpushed ? '<span class="commit-state-label">unpushed</span>' : '';

    return `
      <button class="commit-row ${selected} ${localOnly}" type="button" data-commit-id="${commit.id}" style="--row-delay:${Math.min(index * 12, 220)}ms">
        <span class="commit-graph-cell" style="--lane:${lane};--lane-count:${laneCount};--graph-color:${color};">
          <span class="graph-track" aria-hidden="true"></span>
          <span class="commit-dot" aria-hidden="true"></span>
          <span class="commit-hash">${commit.short_id}</span>
        </span>
        <span class="commit-message-cell">
          <span class="branch-labels">${labels}</span>
          ${syncLabel}
          <span class="commit-message">${escapeHtml(firstLine(commit.message))}</span>
        </span>
        <span class="commit-author-cell">
          ${renderAuthorAvatar(commit)}
          <span class="author-name">${escapeHtml(commit.author_name || 'Unknown')}</span>
        </span>
        <span class="commit-date-cell">${formatDate(commit.timestamp)}</span>
      </button>
    `;
  }).join('');

  els.commitList.querySelectorAll('.commit-row').forEach((row) => {
    row.addEventListener('click', () => selectCommit(row.dataset.commitId));
  });
  hydrateAvatarFallbacks(els.commitList);
  queueGithubAvatarFetches(commits.slice(0, 40));
}

async function selectCommit(commitId) {
  const commit = state.commits.find((item) => item.id === commitId);
  if (!commit) return;

  state.selectedCommit = commitId;
  setStatus(`Reading diff for ${commit.short_id}...`);
  renderCommits();

  els.detailEmpty.style.display = 'none';
  els.detailContent.style.display = 'flex';

  els.detailAvatar.innerHTML = renderAuthorAvatar(commit, 'large');
  els.detailMessage.textContent = firstLine(commit.message);
  els.detailAuthor.textContent = `${commit.author_name || 'Unknown'}${commit.author_email ? ` <${commit.author_email}>` : ''}`;
  els.detailDate.textContent = formatFullDate(commit.timestamp);
  els.detailHash.textContent = commit.id;
  hydrateAvatarFallbacks(els.detailAvatar);
  queueGithubAvatarFetches([commit]);

  try {
    await Promise.all([
      loadCommitDiff(commitId),
      loadFileTree(commitId),
    ]);
    setStatus(`${commit.short_id}: ${state.diffData.length} files changed`);
  } catch (err) {
    console.error(err);
    setStatus('Commit details could not be loaded');
  }
}

function getFileStats(file) {
  let additions = 0;
  let deletions = 0;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.line_type === 'add') additions += 1;
      if (line.line_type === 'delete') deletions += 1;
    }
  }

  return { additions, deletions };
}

function getDiffStats(files) {
  return files.reduce((acc, file) => {
    const stats = getFileStats(file);
    acc.files += 1;
    acc.additions += stats.additions;
    acc.deletions += stats.deletions;
    return acc;
  }, { files: 0, additions: 0, deletions: 0 });
}

function renderDiff() {
  const stats = getDiffStats(state.diffData);
  els.changedSummary.innerHTML = `
    <span>${stats.files} files</span>
    <span class="positive">+${stats.additions}</span>
    <span class="negative">-${stats.deletions}</span>
  `;

  if (state.diffData.length === 0) {
    els.changedFiles.innerHTML = '';
    els.diffContainer.innerHTML = `
      <div class="empty-state compact">
        <strong>No changes</strong>
        <span>No diff content was found for this commit.</span>
      </div>
    `;
    return;
  }

  els.changedFiles.innerHTML = state.diffData.map((file, index) => {
    const displayPath = file.new_path || file.old_path;
    const config = statusConfig[file.status] || statusConfig.unknown;
    const fileStats = getFileStats(file);

    return `
      <button class="changed-file" type="button" data-file-idx="${index}">
        <span class="file-status ${file.status}">${config.label}</span>
        <span class="file-name">${escapeHtml(displayPath)}</span>
        <span class="file-delta">
          <b class="positive">+${fileStats.additions}</b>
          <b class="negative">-${fileStats.deletions}</b>
        </span>
      </button>
    `;
  }).join('');

  els.changedFiles.querySelectorAll('.changed-file').forEach((fileButton) => {
    fileButton.addEventListener('click', () => {
      const index = Number.parseInt(fileButton.dataset.fileIdx, 10);
      state.detailTab = 'diff';
      activateDetailTab('diff');
      scrollToDiffFile(index);
      els.changedFiles.querySelectorAll('.changed-file').forEach((item) => item.classList.remove('selected'));
      fileButton.classList.add('selected');
    });
  });

  els.diffContainer.innerHTML = state.diffData.map((file, fileIndex) => {
    const displayPath = file.new_path || file.old_path;
    const config = statusConfig[file.status] || statusConfig.unknown;
    const hunks = file.hunks.map((hunk) => `
      <div class="diff-hunk">
        <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
        ${hunk.lines.map((line) => `
          <div class="diff-line ${line.line_type}">
            <span class="diff-line-num">${line.old_lineno || ''}</span>
            <span class="diff-line-num">${line.new_lineno || ''}</span>
            <span class="diff-line-content">${escapeHtml(line.content.replace(/\n$/, ''))}</span>
          </div>
        `).join('')}
      </div>
    `).join('');

    return `
      <section class="diff-file-block" id="diff-file-${fileIndex}">
        <div class="diff-file-header">
          <span class="file-status ${file.status}">${config.label}</span>
          <span>${escapeHtml(displayPath)}</span>
          <small>${config.text}</small>
        </div>
        ${hunks || '<div class="diff-placeholder">File changed, but there are no lines to show.</div>'}
      </section>
    `;
  }).join('');

  activateDetailTab(state.detailTab);
}

function scrollToDiffFile(index) {
  const element = document.getElementById(`diff-file-${index}`);
  if (element) element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFileTree() {
  function iconFor(entry) {
    if (entry.is_dir) {
      return '<svg class="tree-dir-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2.5h7A2.5 2.5 0 0 1 21 10v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>';
    }
    return '<svg class="tree-file-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"></path><path d="M14 2v5h5"></path></svg>';
  }

  function renderNode(entries, depth = 0) {
    return entries.map((entry) => `
      <div class="tree-item ${entry.is_dir ? 'dir' : 'file'}" style="--depth:${depth}" data-path="${escapeHtml(entry.path)}">
        ${iconFor(entry)}
        <span class="tree-name">${escapeHtml(entry.name)}</span>
      </div>
      ${entry.is_dir && entry.children?.length ? renderNode(entry.children, depth + 1) : ''}
    `).join('');
  }

  els.fileTree.innerHTML = state.fileTree.length
    ? renderNode(state.fileTree)
    : '<div class="muted-row">File tree is empty</div>';
}

function activateDetailTab(tabName) {
  state.detailTab = tabName;
  document.querySelectorAll('.detail-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  const filesOnly = tabName === 'files';
  els.diffContainer.style.display = filesOnly ? 'none' : 'block';
  els.changedFiles.classList.toggle('files-mode', filesOnly);
}

function initEventHandlers() {
  els.btnHome.addEventListener('click', showHomeScreen);
  els.btnOpenRepo.addEventListener('click', () => openRepo());
  els.btnWelcomeOpen.addEventListener('click', () => openRepo());
  els.btnRefreshStatus.addEventListener('click', async () => {
    try {
      setStatus('Refreshing status...');
      await Promise.all([loadWorktreeStatus(), loadSyncStatus()]);
      setStatus('Status refreshed');
    } catch (err) {
      console.error(err);
      setStatus('Status could not be refreshed');
    }
  });
  els.btnCommitSelected.addEventListener('click', commitSelectedChanges);
  els.btnPushOrigin.addEventListener('click', pushOrigin);
  els.commitMessageInput.addEventListener('input', updateCommitAction);
  els.btnShowContributors.addEventListener('click', openContributorsModal);
  els.btnCloseContributors.addEventListener('click', closeContributorsModal);
  els.contributorsModal.addEventListener('click', (event) => {
    if (event.target === els.contributorsModal) closeContributorsModal();
  });

  els.searchInput.addEventListener('input', (event) => {
    state.searchQuery = event.target.value.trim();
    renderCommits();
  });

  document.querySelectorAll('.detail-tab').forEach((tab) => {
    tab.addEventListener('click', () => activateDetailTab(tab.dataset.tab));
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openRepo();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (els.searchBox.style.display !== 'none') els.searchInput.focus();
    }

    if (event.key === 'Escape' && !els.contributorsModal.hidden) {
      closeContributorsModal();
      return;
    }

    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || state.filteredCommitIds.length === 0) return;

    const currentIndex = state.filteredCommitIds.indexOf(state.selectedCommit);
    const fallback = event.key === 'ArrowDown' ? -1 : state.filteredCommitIds.length;
    const index = currentIndex === -1 ? fallback : currentIndex;
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(index + 1, state.filteredCommitIds.length - 1)
      : Math.max(index - 1, 0);

    if (nextIndex !== currentIndex) {
      event.preventDefault();
      const nextId = state.filteredCommitIds[nextIndex];
      selectCommit(nextId);
      requestAnimationFrame(() => {
        els.commitList.querySelector(`[data-commit-id="${nextId}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      });
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initEventHandlers();
  renderRecentRepos();
});

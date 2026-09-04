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
  selectedCoauthors: [],
  coauthorSuggestions: [],
  ghPanel: 'history',  // 'history' | 'issues' | 'prs' | 'actions'
  ghIssues: [],
  ghPrs: [],
  ghActions: [],
  ghIssueFilter: 'open',
  ghPrFilter: 'open',
  ghAuthenticated: false,
  ghUser: '',
  remotes: [],
  activeRemote: 'origin',
};

const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = 'differ.settings';

function applyUiScale(scale) {
  const val = parseFloat(scale) || 1.0;
  document.documentElement.style.zoom = val;
  if (typeof appSettings !== 'undefined' && appSettings) {
    appSettings.uiScale = String(val);
    saveAppSettings(appSettings);
  }
}

function loadAppSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      aiProvider: saved.aiProvider || 'ollama',
      geminiApiKey: saved.geminiApiKey || '',
      geminiModel: saved.geminiModel || 'gemini-2.5-flash',
      lmStudioModel: saved.lmStudioModel || 'local-model',
      selectedModel: saved.selectedModel || 'gemma4:12b',
      gitName: saved.gitName || '',
      gitEmail: saved.gitEmail || '',
      gpgKey: saved.gpgKey || 'none',
      gpgSign: saved.gpgSign || false,
      signedOffBy: saved.signedOffBy || false,
      smtpEnabled: saved.smtpEnabled || false,
      uiScale: saved.uiScale || '1.0',
    };
  } catch {
    return {
      aiProvider: 'ollama',
      geminiApiKey: '',
      geminiModel: 'gemini-2.5-flash',
      lmStudioModel: 'local-model',
      selectedModel: 'gemma4:12b',
      gitName: '',
      gitEmail: '',
      gpgKey: 'none',
      gpgSign: false,
      signedOffBy: false,
      smtpEnabled: false,
      uiScale: '1.0',
    };
  }
}

function saveAppSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

let appSettings = loadAppSettings();
applyUiScale(appSettings.uiScale);

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
  topPushBtn: $('top-push-btn'),
  topPushBtnText: $('top-push-btn-text'),
  btnOpenSettings: $('btn-open-settings'),
  unpushedBanner: $('unpushed-banner'),
  unpushedBannerCount: $('unpushed-banner-count'),
  unpushedCommitList: $('unpushed-commit-list'),
  btnUnpushedBannerPush: $('btn-unpushed-banner-push'),
  sideBranchCount: $('side-branch-count'),
  sideCommitCount: $('side-commit-count'),
  sideAuthorCount: $('side-author-count'),
  originLabel: $('origin-label'),
  pushLabel: $('push-label'),
  btnPushOrigin: $('btn-push-origin'),
  syncCardContent: $('sync-card-content'),
  btnShowAddOrigin: $('btn-show-add-origin'),
  addOriginForm: $('add-origin-form'),
  remoteUrlInput: $('remote-url-input'),
  btnCancelOrigin: $('btn-cancel-origin'),
  btnSaveOrigin: $('btn-save-origin'),
  btnRefreshStatus: $('btn-refresh-status'),
  worktreeList: $('worktree-list'),
  commitBox: $('commit-box'),
  commitMessageInput: $('commit-message-input'),
  btnCommitSelected: $('btn-commit-selected'),
  btnAiGenerateCommit: $('btn-ai-generate-commit'),
  commitAiModelTag: $('commit-ai-model-tag'),
  commitIdentitySelect: $('commit-identity-select'),
  commitGpgSelect: $('commit-gpg-select'),
  coauthorList: $('coauthors-list'),
  coauthorInput: $('coauthor-username-input'),
  coauthorSuggestions: $('coauthor-suggestions'),
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
  mergeModal: $('merge-modal'),
  btnCloseMerge: $('btn-close-merge'),
  btnCancelMerge: $('btn-cancel-merge'),
  btnConfirmMerge: $('btn-confirm-merge'),
  mergeSourceLabel: $('merge-source-label'),
  mergeTargetLabel: $('merge-target-label'),
  mergeTargetSelect: $('merge-target-select'),
  settingsModal: $('settings-modal'),
  btnCloseSettings: $('btn-close-settings'),
  btnCancelSettings: $('btn-cancel-settings'),
  btnSaveSettings: $('btn-save-settings'),
  settingGitName: $('setting-git-name'),
  settingGitEmail: $('setting-git-email'),
  settingGpgKey: $('setting-gpg-key'),
  settingGpgSign: $('setting-gpg-sign'),
  aiDetailsPanel: $('ai-details-panel'),
  specOsDistro: $('spec-os-distro'),
  specRam: $('spec-ram'),
  specGpu: $('spec-gpu'),
  specOllamaStatus: $('spec-ollama-status'),
  ollamaInstallBox: $('ollama-install-box'),
  btnInstallOllama: $('btn-install-ollama'),
  recommendedModelTitle: $('recommended-model-title'),
  settingAiModel: $('setting-ai-model'),
  btnPullModel: $('btn-pull-model'),
  modelStatusText: $('model-status-text'),
  settingGeminiModel: $('setting-gemini-model'),
  btnFetchGeminiModels: $('btn-fetch-gemini-models'),
  geminiModelStatus: $('gemini-model-status'),
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
  commitDescriptionView: $('commit-description-view'),
  statusText: $('status-text'),
  githubNav: $('github-nav'),
  btnGhTabHistory: $('btn-gh-tab-history'),
  btnGhTabIssues: $('btn-gh-tab-issues'),
  btnGhTabPrs: $('btn-gh-tab-prs'),
  btnGhTabActions: $('btn-gh-tab-actions'),
  ghIssuesCount: $('gh-issues-count'),
  ghPrsCount: $('gh-prs-count'),
  ghActionsCount: $('gh-actions-count'),
  panelIssues: $('panel-issues'),
  panelPrs: $('panel-prs'),
  panelActions: $('panel-actions'),
  issuesList: $('issues-list'),
  prsList: $('prs-list'),
  actionsList: $('actions-list'),
  issuesFilterGroup: $('issues-filter-group'),
  prsFilterGroup: $('prs-filter-group'),
  btnRefreshIssues: $('btn-refresh-issues'),
  btnRefreshPrs: $('btn-refresh-prs'),
  btnRefreshActions: $('btn-refresh-actions'),
  actionLogModal: $('action-log-modal'),
  btnCloseActionLog: $('btn-close-action-log'),
  actionLogTitle: $('action-log-title'),
  actionLogMeta: $('action-log-meta'),
  actionLogBody: $('action-log-body'),
  actionLogLoading: $('action-log-loading'),
  actionLogPre: $('action-log-pre'),
  btnCheckUpdate: $('btn-check-update'),
  settingsAppVersion: $('settings-app-version'),
  updateStatusBox: $('update-status-box'),
  updateStatusInfo: $('update-status-info'),
  updateNotesBox: $('update-notes-box'),
  updateNotesContent: $('update-notes-content'),
  updateAssetsBox: $('update-assets-box'),
  updateAssetsList: $('update-assets-list'),
  prDetailModal: $('pr-detail-modal'),
  prModalNumber: $('pr-modal-number'),
  prDetailTitle: $('pr-detail-title'),
  btnOpenPrBrowser: $('btn-open-pr-browser'),
  btnClosePrDetail: $('btn-close-pr-detail'),
  btnClosePrModalBottom: $('btn-close-pr-modal-bottom'),
  prModalStatusDot: $('pr-modal-status-dot'),
  prModalAuthor: $('pr-modal-author'),
  prModalBranches: $('pr-modal-branches'),
  prCommitsCount: $('pr-commits-count'),
  btnPrTabDiff: $('btn-pr-tab-diff'),
  btnPrTabCommits: $('btn-pr-tab-commits'),
  btnPrTabBody: $('btn-pr-tab-body'),
  prPanelDiff: $('pr-panel-diff'),
  prPanelCommits: $('pr-panel-commits'),
  prPanelBody: $('pr-panel-body'),
  prDiffLoading: $('pr-diff-loading'),
  prDiffContent: $('pr-diff-content'),
  prCommitsLoading: $('pr-commits-loading'),
  prCommitsList: $('pr-commits-list'),
  prBodyContent: $('pr-body-content'),
  prMergeMethod: $('pr-merge-method'),
  btnConfirmPrMerge: $('btn-confirm-pr-merge'),
  editorActions: $('editor-actions'),
  remotesBar: $('remotes-bar'),
  remotesCount: $('remotes-count'),
  selectActiveRemote: $('select-active-remote'),
  btnFetchRemote: $('btn-fetch-remote'),
  btnAddRemoteToggle: $('btn-add-remote-toggle'),
  unpushedBannerRemote: $('unpushed-banner-remote'),
  btnUnpushedBannerPush: $('btn-unpushed-banner-push'),
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

function parseCoauthorsFromMessage(message = '') {
  const coauthors = [];
  const lines = message.split('\n');
  const regex = /^Co-authored-by:\s*([^<]+)<([^>]+)>/i;

  lines.forEach((line) => {
    const match = line.trim().match(regex);
    if (match) {
      const name = match[1].trim();
      const email = match[2].trim();
      let githubUsername = null;
      const noreply = email.match(/^(?:\d+\+)?([A-Za-z0-9-]+(?:\[bot\])?)@users\.noreply\.github\.com$/i);
      if (noreply) githubUsername = noreply[1];

      coauthors.push({
        name,
        email,
        githubUsername,
      });
    }
  });

  return coauthors;
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
  if (els.repoName) els.repoName.textContent = state.repoInfo.name;
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
  els.githubNav.style.display = 'none';
  els.btnOpenRepo.style.display = '';
  renderRecentRepos();
  setStatus('Ready');
}

function promptGitInit(path) {
  return new Promise((resolve) => {
    const modal = document.getElementById('init-repo-modal');
    const pathDisplay = document.getElementById('init-repo-path-display');
    const btnConfirm = document.getElementById('btn-confirm-init-repo');
    const btnDecline = document.getElementById('btn-decline-init-repo');
    const btnClose = document.getElementById('btn-cancel-init-repo');

    if (!modal || !btnConfirm || !btnDecline) {
      const ok = confirm(`Selected directory is not a Git repository:\n\n${path}\n\nInitialize as a Git repository (git init)?`);
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

    setStatus('Checking repository...');
    const isGit = await invoke('is_git_repository', { path: selected });
    let repoInfo = null;

    if (!isGit) {
      const shouldInit = await promptGitInit(selected);
      if (!shouldInit) {
        setStatus('Repository open cancelled (Not a Git repository)');
        return;
      }
      setStatus('Initializing Git repository...');
      repoInfo = await invoke('init_repository', { path: selected });
      setStatus('Git repository initialized successfully!');
    } else {
      setStatus('Reading repository...');
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
    els.btnOpenRepo.style.display = 'none';
    els.detailEmpty.style.display = 'flex';
    els.detailContent.style.display = 'none';

    await refreshRepositoryData({ selectLatest: true });
    rememberRecentRepo(repoInfo.path || selected);

    // Load all git remotes (origin, upstream, fork, etc.)
    await loadGitRemotes();
    // Show GitHub nav if repo has GitHub remote
    showGhNavIfGitHub();
    // Check gh CLI auth in background
    checkGhAuth().catch(() => {});
    // Detect installed editors (VS Code, Code OSS, Zed, Cursor, VSCodium)
    checkAndRenderInstalledEditors();

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
    const commits = await invoke('get_commits', { limit: 500, branch, targetRemote: state.activeRemote });
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
  state.syncStatus = await invoke('get_sync_status', { targetRemote: state.activeRemote });
  renderSyncStatus();
}

function renderSyncStatus() {
  const sync = state.syncStatus;

  if (!sync) {
    els.topSyncPill.textContent = 'no origin';
    els.originLabel.textContent = 'no origin';
    els.pushLabel.textContent = 'waiting for remote connection';
    els.btnPushOrigin.disabled = true;
    els.topPushBtn.style.display = 'none';

    els.syncCardContent.style.display = 'grid';
    els.btnShowAddOrigin.style.display = 'none';
    els.addOriginForm.style.display = 'none';
    return;
  }

  if (!sync.has_origin) {
    els.topSyncPill.textContent = 'no origin';
    els.originLabel.textContent = 'no origin';
    els.pushLabel.textContent = 'no remote connection';
    els.btnPushOrigin.textContent = 'Push';
    els.btnPushOrigin.disabled = true;
    els.topPushBtn.style.display = 'none';

    els.syncCardContent.style.display = 'none';
    if (els.addOriginForm.style.display !== 'flex') {
      els.btnShowAddOrigin.style.display = 'block';
      els.addOriginForm.style.display = 'none';
    } else {
      els.btnShowAddOrigin.style.display = 'none';
      els.addOriginForm.style.display = 'flex';
    }
    return;
  }

  els.syncCardContent.style.display = 'grid';
  els.btnShowAddOrigin.style.display = 'none';
  els.addOriginForm.style.display = 'none';
  const activeRemote = state.activeRemote || 'origin';
  const originText = sync.origin_url || `${activeRemote} connected`;
  els.topSyncPill.textContent = sync.unpushed_count > 0
    ? `${activeRemote} · ${sync.unpushed_count} unpushed`
    : `${activeRemote} · up to date`;
  els.originLabel.textContent = originText;

  if (sync.unpushed_count > 0 && sync.can_push) {
    els.topPushBtn.style.display = 'inline-flex';
    els.topPushBtnText.textContent = `Push (${sync.unpushed_count})`;
  } else {
    els.topPushBtn.style.display = 'none';
  }

  if (!sync.can_push) {
    els.pushLabel.textContent = 'active branch cannot be pushed';
    els.btnPushOrigin.textContent = 'Push';
    els.btnPushOrigin.disabled = true;
    return;
  }

  if (!sync.upstream) {
    els.pushLabel.textContent = `${sync.current_branch} will be published to ${activeRemote}`;
    els.btnPushOrigin.textContent = `Publish to ${activeRemote}`;
    els.btnPushOrigin.disabled = false;
    return;
  }

  els.pushLabel.textContent = sync.unpushed_count > 0
    ? `${sync.unpushed_count} commit(s) ahead of ${activeRemote}`
    : `up to date with ${activeRemote}`;
  els.btnPushOrigin.textContent = `Push to ${activeRemote}`;
  els.btnPushOrigin.disabled = sync.unpushed_count === 0;
}

function updateCommitAction() {
  const count = state.selectedWorktreePaths.size;
  const hasMessage = els.commitMessageInput.value.trim().length > 0;
  const isEditing = !!state.editingCommitId;
  const cancelBtn = document.getElementById('btn-cancel-edit-commit');

  if (cancelBtn) {
    cancelBtn.style.display = isEditing ? 'inline-flex' : 'none';
  }

  if (isEditing) {
    els.btnCommitSelected.classList.add('is-editing');
    if (count > 0 && hasMessage) {
      els.btnCommitSelected.disabled = false;
      els.btnCommitSelected.textContent = `Amend ${count} file(s)`;
    } else if (hasMessage) {
      els.btnCommitSelected.disabled = false;
      els.btnCommitSelected.textContent = 'Amend Commit';
    } else {
      els.btnCommitSelected.disabled = true;
      els.btnCommitSelected.textContent = 'Amend Commit';
    }
  } else {
    els.btnCommitSelected.classList.remove('is-editing');
    els.btnCommitSelected.disabled = count === 0 || !hasMessage;
    els.btnCommitSelected.textContent = count > 0 ? `Commit ${count} files` : 'Commit selected files';
  }
}

function cancelCommitEdit() {
  state.editingCommitId = null;
  els.commitMessageInput.value = '';
  state.selectedCoauthors = [];
  renderCoauthors();
  updateCommitAction();
  setStatus('Commit editing cancelled.');
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
  const isAmend = (paths.length === 0 && !!state.editingCommitId && state.commits[0] && state.editingCommitId === state.commits[0].id)
    || (paths.length > 0 && !!state.editingCommitId && state.commits[0] && state.editingCommitId === state.commits[0].id);

  if ((paths.length === 0 && !isAmend) || !message) {
    updateCommitAction();
    return;
  }

  let finalMessage = message;
  if (state.selectedCoauthors && state.selectedCoauthors.length > 0) {
    finalMessage += '\n\n';
    state.selectedCoauthors.forEach((author) => {
      finalMessage += `Co-authored-by: ${author.name} <${author.email}>\n`;
    });
    finalMessage = finalMessage.trim();
  }

  const selectedIdentityVal = els.commitIdentitySelect?.value || '';
  let author_name = null;
  let author_email = null;

  if (selectedIdentityVal && selectedIdentityVal !== '__manage__') {
    const found = state.gitIdentities?.find((i) => `${i.name} <${i.email}>` === selectedIdentityVal);
    if (found) {
      author_name = found.name;
      author_email = found.email;
    } else {
      const match = selectedIdentityVal.match(/^([^<]+)\s*<([^>]+)>$/);
      if (match) {
        author_name = match[1].trim();
        author_email = match[2].trim();
      }
    }
  }

  const gpg_key = els.commitGpgSelect.value;
  const signedOffBy = document.getElementById('commit-signed-off-by')?.checked || false;

  try {
    els.btnCommitSelected.disabled = true;
    setStatus(isAmend ? 'Amending commit...' : 'Creating commit...');
    await invoke('commit_changes_with_options', {
      paths,
      message: finalMessage,
      authorName: author_name,
      authorEmail: author_email,
      gpgKey: gpg_key,
      signCommit: appSettings.gpgSign,
      signedOffBy: signedOffBy,
      amend: isAmend,
    });
    state.selectedWorktreePaths.clear();
    state.selectedCoauthors = [];
    state.editingCommitId = null;
    els.commitMessageInput.value = '';
    renderCoauthors();
    await refreshRepositoryData({ selectLatest: true });
    setStatus(isAmend ? 'Commit amended successfully' : 'Commit created');

    if (appSettings.smtpEnabled) {
      try {
        setStatus('Sending patch email...');
        const emailResult = await invoke('send_patch_email');
        setStatus(emailResult);
      } catch (emailErr) {
        console.error('Patch email error:', emailErr);
        setStatus(`Commit created but email failed: ${emailErr}`);
      }
    }
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
    els.topPushBtn.disabled = true;
    const rName = state.activeRemote || 'origin';
    setStatus(`Pushing to ${rName}...`);
    await invoke('push_origin', { targetRemote: rName });
    await refreshRepositoryData();
    setStatus(`Pushed to ${rName} successfully`);
  } catch (err) {
    console.error(err);
    setStatus('Push failed');
    alert(`Push failed: ${err}`);
  } finally {
    els.topPushBtn.disabled = false;
    renderSyncStatus();
  }
}

function showAddOriginForm() {
  els.btnShowAddOrigin.style.display = 'none';
  els.addOriginForm.style.display = 'flex';
  els.remoteUrlInput.value = '';
  els.remoteUrlInput.focus();
}

function hideAddOriginForm() {
  els.addOriginForm.style.display = 'none';
  els.btnShowAddOrigin.style.display = 'block';
}

async function saveRemoteOrigin() {
  const url = els.remoteUrlInput.value.trim();
  if (!url) {
    alert('Please enter a valid remote URL.');
    els.remoteUrlInput.focus();
    return;
  }

  try {
    els.btnSaveOrigin.disabled = true;
    els.btnSaveOrigin.textContent = 'Saving...';
    setStatus('Adding remote origin...');

    await invoke('add_origin', { url });

    els.remoteUrlInput.value = '';
    els.addOriginForm.style.display = 'none';
    setStatus('Remote origin added successfully');

    await loadSyncStatus();
  } catch (err) {
    console.error(err);
    setStatus('Failed to add remote origin');
    alert(`Failed to add remote origin: ${err}`);
  } finally {
    els.btnSaveOrigin.disabled = false;
    els.btnSaveOrigin.textContent = 'Save Remote';
  }
}

state.activeMergeSource = null;

function openMergeModal(sourceBranch) {
  state.activeMergeSource = sourceBranch;

  const localBranches = state.branches.filter((b) => !b.is_remote && b.name !== 'detached');
  const activeBranch = state.branches.find((b) => b.is_head);
  const activeBranchName = activeBranch ? activeBranch.name : '';

  els.mergeSourceLabel.textContent = sourceBranch;
  els.mergeTargetLabel.textContent = activeBranchName || '-';

  const targetBranches = localBranches.filter((b) => b.name !== sourceBranch);

  if (targetBranches.length === 0) {
    alert('No other local branches available to merge into.');
    return;
  }

  els.mergeTargetSelect.innerHTML = targetBranches.map((b) => {
    const selected = b.name === activeBranchName ? 'selected' : '';
    return `<option value="${escapeHtml(b.name)}" ${selected}>${escapeHtml(b.name)}</option>`;
  }).join('');

  els.mergeTargetSelect.onchange = (e) => {
    els.mergeTargetLabel.textContent = e.target.value;
  };

  els.mergeModal.removeAttribute('hidden');
}

function closeMergeModal() {
  els.mergeModal.setAttribute('hidden', '');
  state.activeMergeSource = null;
}

async function confirmMerge() {
  const source = state.activeMergeSource;
  const target = els.mergeTargetSelect.value;
  if (!source || !target) return;

  try {
    els.btnConfirmMerge.disabled = true;
    els.btnConfirmMerge.textContent = 'Merging...';
    setStatus(`Merging ${source} into ${target}...`);

    await invoke('merge_branches', { source, target });

    setStatus(`Merged ${source} into ${target} successfully`);
    closeMergeModal();

    await refreshRepositoryData();
  } catch (err) {
    console.error(err);
    setStatus('Merge failed');
    alert(`Merge failed: ${err}`);
  } finally {
    els.btnConfirmMerge.disabled = false;
    els.btnConfirmMerge.textContent = 'Confirm Merge';
  }
}
function renderBranches() {
  const branchRows = [
    `<div class="branch-row-container ${!state.selectedBranch ? 'active' : ''}">
      <button class="branch-item" type="button" data-branch="">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16"></path><path d="M4 6h16"></path><path d="M4 18h16"></path></svg>
        <span class="branch-name">All History</span>
        <span class="branch-badge">all</span>
      </button>
    </div>`,
  ];

  for (const branch of state.branches) {
    const active = state.selectedBranch === branch.name || (!state.selectedBranch && branch.is_head);
    const isDetached = branch.name === 'detached';
    const canMerge = !branch.is_remote && !isDetached;

    // Determine badge class and label
    let badgeClass = '';
    let badgeLabel = '';
    if (branch.is_head) {
      badgeClass = 'head';
      badgeLabel = 'HEAD';
    } else if (branch.is_remote) {
      badgeClass = 'remote';
      // Show short remote name: strip "origin/" prefix
      badgeLabel = 'remote';
    } else {
      badgeClass = 'local';
      badgeLabel = 'local';
    }

    // Remote branch: show remote prefix dimmed
    const branchDisplayName = branch.is_remote
      ? branch.name.replace(/^[^/]+\//, '<span style="opacity:0.45;">$&</span>')
      : escapeHtml(branch.name);

    branchRows.push(`
      <div class="branch-row-container ${active ? 'active' : ''}">
        <button class="branch-item" type="button" data-branch="${escapeHtml(branch.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3v12"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="6" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
          <span class="branch-name">${branchDisplayName}</span>
          <span class="branch-badge ${badgeClass}">${badgeLabel}</span>
        </button>
        ${canMerge ? `
        <button class="branch-merge-btn" type="button" data-branch="${escapeHtml(branch.name)}" title="Merge branch...">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15"></line>
            <circle cx="18" cy="6" r="3"></circle>
            <circle cx="6" cy="18" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
        </button>
        ` : ''}
      </div>
    `);
  }

  els.branchList.innerHTML = branchRows.join('');

  els.branchList.querySelectorAll('.branch-item').forEach((item) => {
    item.addEventListener('click', () => {
      const branch = item.dataset.branch || null;
      loadCommits(branch);
    });
  });

  els.branchList.querySelectorAll('.branch-merge-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const branchName = btn.dataset.branch;
      openMergeModal(branchName);
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
    const isRepoEmpty = state.commits.length === 0;
    els.commitList.innerHTML = isRepoEmpty
      ? `
        <div class="empty-state compact" style="padding: 40px 20px; text-align: center;">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px; color: var(--text-dim); display: block;">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 8v4l3 3"></path>
          </svg>
          <strong style="font-size: 14px; display: block; margin-bottom: 6px;">No commits in repository</strong>
          <span style="font-size: 12px; color: var(--text-dim);">This Git repository has no commits yet. Stage files on the left and create your initial commit!</span>
        </div>
      `
      : `
        <div class="empty-state compact">
          <strong>No results</strong>
          <span>No commits match the current search or branch filter.</span>
        </div>
      `;
    return;
  }

  const unpushedCommits = commits.filter((c) => c.is_unpushed);
  if (els.unpushedBanner) {
    if (unpushedCommits.length > 0) {
      els.unpushedBanner.style.display = 'flex';
      els.unpushedBannerCount.textContent = unpushedCommits.length;
      if (els.unpushedBannerRemote) {
        els.unpushedBannerRemote.textContent = state.activeRemote || 'origin';
      }
      els.unpushedCommitList.innerHTML = unpushedCommits.map((c) => `
        <div class="unpushed-commit-card" data-commit-id="${c.id}">
          <div class="unpushed-commit-info">
            <span class="unpushed-hash">${c.short_id}</span>
            <span class="unpushed-msg">${escapeHtml(firstLine(c.message))}</span>
          </div>
          <div class="unpushed-meta">
            <span>${escapeHtml(c.author_name || 'Unknown')}</span>
            <span>&bull; ${formatDate(c.timestamp)}</span>
            <span class="commit-state-label unpushed-badge">UNPUSHED</span>
          </div>
        </div>
      `).join('');

      els.unpushedCommitList.querySelectorAll('.unpushed-commit-card').forEach((card) => {
        card.addEventListener('click', () => selectCommit(card.dataset.commitId));
      });
    } else {
      els.unpushedBanner.style.display = 'none';
    }
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
    const syncLabel = commit.is_unpushed ? '<span class="commit-state-label unpushed-badge">unpushed</span>' : '';

    const coauthors = parseCoauthorsFromMessage(commit.message);
    const coauthorsTitle = coauthors.length > 0 ? ` + Co-authored by: ${coauthors.map(c => c.name).join(', ')}` : '';
    const avatarHtml = coauthors.length > 0
      ? `<span class="avatar-stack" title="${escapeHtml(commit.author_name || 'Unknown')}${escapeHtml(coauthorsTitle)}">
           ${renderAuthorAvatar(commit)}
           ${coauthors.map(co => renderAuthorAvatar(co, 'mini')).join('')}
         </span>`
      : renderAuthorAvatar(commit);

    return `
      <div class="commit-row ${selected} ${localOnly}" role="button" tabindex="0" data-commit-id="${commit.id}" style="--row-delay:${Math.min(index * 12, 220)}ms">
        <span class="commit-graph-cell" style="--lane:${lane};--lane-count:${laneCount};--graph-color:${color};">
          <span class="graph-track" aria-hidden="true"></span>
          <span class="commit-dot" aria-hidden="true"></span>
        </span>
        <span class="commit-message-cell">
          <span class="commit-hash" title="${escapeHtml(commit.id || '')}">${escapeHtml(commit.short_id || (commit.id || '').substring(0, 7))}</span>
          <button class="btn-edit-commit-pencil" type="button" data-commit-id="${commit.id}" title="Load into commit form">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          ${labels ? `<span class="branch-labels">${labels}</span>` : ''}
          ${syncLabel}
          <span class="commit-message" title="${escapeHtml(firstLine(commit.message))}">${escapeHtml(firstLine(commit.message))}</span>
        </span>
        <span class="commit-author-cell">
          ${avatarHtml}
          <span class="author-name" title="${escapeHtml(commit.author_name || 'Unknown')}${escapeHtml(coauthorsTitle)}">${escapeHtml(commit.author_name || 'Unknown')}</span>
        </span>
        <span class="commit-date-cell">${formatDate(commit.timestamp)}</span>
      </div>
    `;
  }).join('');

  els.commitList.querySelectorAll('.commit-row').forEach((row) => {
    row.addEventListener('click', () => selectCommit(row.dataset.commitId));
  });
  els.commitList.querySelectorAll('.btn-edit-commit-pencil').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadCommitIntoForm(btn.dataset.commitId);
    });
  });
  hydrateAvatarFallbacks(els.commitList);
  queueGithubAvatarFetches(commits.slice(0, 40));
}

function loadCommitIntoForm(commitId) {
  const commit = state.commits.find((c) => c.id === commitId);
  if (!commit) return;

  const rawMsg = commit.message || '';
  const lines = rawMsg.split('\n');

  const coauthors = [];
  let isSignedOff = false;
  const mainMsgLines = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^co-authored-by:/i.test(trimmed)) {
      const match = trimmed.match(/^co-authored-by:\s*(.*?)\s*<(.*?)>/i);
      if (match) {
        coauthors.push({ name: match[1].trim(), email: match[2].trim() });
      } else {
        const raw = trimmed.replace(/^co-authored-by:\s*/i, '').trim();
        if (raw) coauthors.push({ name: raw, email: '' });
      }
    } else if (/^signed-off-by:/i.test(trimmed)) {
      isSignedOff = true;
    } else {
      mainMsgLines.push(line);
    }
  });

  const cleanMsg = mainMsgLines.join('\n').trim();
  els.commitMessageInput.value = cleanMsg;

  const signedOffCheckbox = document.getElementById('commit-signed-off-by');
  if (signedOffCheckbox) {
    signedOffCheckbox.checked = isSignedOff;
  }

  state.selectedCoauthors = coauthors;
  renderCoauthors();

  state.editingCommitId = commitId;
  updateCommitAction();

  els.commitMessageInput.focus();
  els.commitMessageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setStatus(`Loaded commit ${commit.short_id} into commit form.`);
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

  renderCommitDescription(commit);
  activateDetailTab(state.detailTab);

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
  if (!els.fileTree) return;

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
  const targetTab = tabName || 'changes';
  state.detailTab = targetTab;
  document.querySelectorAll('.detail-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === targetTab);
  });

  if (targetTab === 'diff' || targetTab === 'changes') {
    els.changedFiles.style.display = 'block';
    els.changedFiles.classList.remove('files-mode');
    els.diffContainer.style.display = 'block';
    els.commitDescriptionView.style.display = 'none';
  } else if (targetTab === 'files') {
    els.changedFiles.style.display = 'block';
    els.changedFiles.classList.add('files-mode');
    els.diffContainer.style.display = 'none';
    els.commitDescriptionView.style.display = 'none';
  } else if (targetTab === 'description') {
    els.changedFiles.style.display = 'none';
    els.diffContainer.style.display = 'none';
    els.commitDescriptionView.style.display = 'flex';
  }
}

function renderCommitDescription(commit) {
  const subject = firstLine(commit.message);
  const lines = commit.message.split('\n');
  const bodyLines = lines.slice(1);

  const coauthors = parseCoauthorsFromMessage(commit.message);
  const cleanBodyLines = bodyLines.filter((line) => !line.trim().match(/^Co-authored-by:\s*/i));
  const cleanBody = cleanBodyLines.join('\n').trim();

  let coauthorsHtml = '';
  if (coauthors.length > 0) {
    const coauthorCards = coauthors.map((co) => {
      const initials = escapeHtml(getInitials(co.name));
      const avatarHtml = renderAuthorAvatar(co, 'large');

      const githubLink = co.githubUsername
        ? `<a class="description-coauthor-github-link" href="https://github.com/${encodeURIComponent(co.githubUsername)}" target="_blank" rel="noopener noreferrer" title="View on GitHub">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
             </svg>
           </a>`
        : '';

      return `
        <div class="description-coauthor-card">
          ${avatarHtml}
          <div class="description-coauthor-info">
            <strong>${escapeHtml(co.name)}</strong>
            <small>${escapeHtml(co.email)}</small>
          </div>
          ${githubLink}
        </div>
      `;
    }).join('');

    coauthorsHtml = `
      <div class="description-coauthors-section">
        <h3 class="description-coauthors-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          Co-authors
        </h3>
        <div class="description-coauthors-list">
          ${coauthorCards}
        </div>
      </div>
    `;
  }

  els.commitDescriptionView.innerHTML = `
    <div class="description-header">${escapeHtml(subject)}</div>
    ${cleanBody ? `<div class="description-body">${escapeHtml(cleanBody)}</div>` : '<div class="description-body italic text-dim">No commit description body.</div>'}
    ${coauthorsHtml}
  `;

  hydrateAvatarFallbacks(els.commitDescriptionView);
}

/* ==================================
   Co-Authors feature logic
   ================================== */
state.activeCoauthorSuggestionIndex = -1;

function renderCoauthors() {
  els.coauthorList.innerHTML = state.selectedCoauthors.map((author, index) => {
    const initials = escapeHtml(getInitials(author.name));
    const avatarHtml = author.avatarUrl
      ? `<img src="${escapeHtml(author.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="avatar-fallback">${initials}</span>`;

    return `
      <div class="coauthor-tag" title="${escapeHtml(author.email)}">
        <span class="author-avatar has-image">
          ${avatarHtml}
        </span>
        <strong>${escapeHtml(author.name)}</strong>
        <button class="remove-btn" type="button" data-idx="${index}" aria-label="Remove co-author">×</button>
      </div>
    `;
  }).join('');

  els.coauthorList.querySelectorAll('.remove-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number.parseInt(btn.dataset.idx, 10);
      state.selectedCoauthors.splice(idx, 1);
      renderCoauthors();
    });
  });
}

function renderCoauthorSuggestions(suggestions) {
  state.coauthorSuggestions = suggestions;
  if (suggestions.length === 0) {
    els.coauthorSuggestions.style.display = 'none';
    els.coauthorSuggestions.innerHTML = '';
    return;
  }

  els.coauthorSuggestions.style.display = 'flex';
  els.coauthorSuggestions.innerHTML = suggestions.map((s, idx) => {
    const active = state.activeCoauthorSuggestionIndex === idx ? 'active' : '';
    const srcClass = s.isGithubApiResult ? 'github' : 'local';
    const srcText = s.isGithubApiResult ? 'GitHub' : 'Local';
    const avatarHtml = s.avatarUrl
      ? `<span class="author-avatar has-image"><img src="${escapeHtml(s.avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`
      : `<span class="author-avatar"><span class="avatar-fallback">${escapeHtml(getInitials(s.name))}</span></span>`;

    return `
      <button class="suggestion-item ${active}" type="button" data-idx="${idx}">
        ${avatarHtml}
        <div class="suggestion-info">
          <strong>${escapeHtml(s.name)}</strong>
          <small>${s.githubUsername ? `@${escapeHtml(s.githubUsername)} · ` : ''}${escapeHtml(s.email)}</small>
        </div>
        <span class="suggestion-source ${srcClass}">${srcText}</span>
      </button>
    `;
  }).join('');

  els.coauthorSuggestions.querySelectorAll('.suggestion-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number.parseInt(btn.dataset.idx, 10);
      selectCoauthorSuggestion(idx);
    });
  });
}

function selectCoauthorSuggestion(idx) {
  const selected = state.coauthorSuggestions[idx];
  if (!selected || selected.isPlaceholder) return;

  const alreadyAdded = state.selectedCoauthors.some(
    (c) => c.email.toLowerCase() === selected.email.toLowerCase(),
  );

  if (!alreadyAdded) {
    state.selectedCoauthors.push({
      name: selected.name,
      email: selected.email,
      githubUsername: selected.githubUsername,
      avatarUrl: selected.avatarUrl,
    });
    renderCoauthors();
  }

  els.coauthorInput.value = '';
  renderCoauthorSuggestions([]);
  state.activeCoauthorSuggestionIndex = -1;
  els.coauthorInput.focus();
}

function updateSuggestionsWithGithubResult(gitHubUser) {
  const alreadyExists = state.coauthorSuggestions.some(
    (s) => s.githubUsername && s.githubUsername.toLowerCase() === gitHubUser.githubUsername.toLowerCase() && !s.isPlaceholder,
  );

  if (alreadyExists) return;

  const currentSuggestions = [...state.coauthorSuggestions];
  const cleanSuggestions = currentSuggestions.filter((s) => !s.isPlaceholder);

  cleanSuggestions.unshift(gitHubUser);
  if (state.activeCoauthorSuggestionIndex === -1 && cleanSuggestions.length > 0) {
    state.activeCoauthorSuggestionIndex = 0;
  }
  renderCoauthorSuggestions(cleanSuggestions);
}

let coauthorGithubSearchTimeout = null;

function lookupGithubCoauthor(query) {
  if (coauthorGithubSearchTimeout) window.clearTimeout(coauthorGithubSearchTimeout);

  if (!query || query.length < 2) return;

  coauthorGithubSearchTimeout = window.setTimeout(() => {
    fetch(`https://api.github.com/users/${encodeURIComponent(query)}`)
      .then((response) => {
        if (response.ok) return response.json();
        throw new Error('Not found');
      })
      .then((data) => {
        const inputVal = els.coauthorInput.value.trim().replace(/^@/, '').toLowerCase();
        if (inputVal === query.toLowerCase()) {
          const gitHubUser = {
            name: data.name || data.login,
            email: data.email || `${data.id}+${data.login}@users.noreply.github.com`,
            githubUsername: data.login,
            avatarUrl: data.avatar_url,
            isGithubApiResult: true,
          };
          updateSuggestionsWithGithubResult(gitHubUser);
        }
      })
      .catch((err) => {
        console.log('GitHub user lookup failed:', err);
      });
  }, 400);
}

function handleCoauthorInput(e) {
  const value = e.target.value.trim();
  const query = value.replace(/^@/, '');

  if (!query) {
    renderCoauthorSuggestions([]);
    state.activeCoauthorSuggestionIndex = -1;
    return;
  }

  const allAuthors = getAuthorStats();
  const localMatches = allAuthors
    .filter((author) => {
      const nameMatch = author.name.toLowerCase().includes(query.toLowerCase());
      const handleMatch = author.githubUsername && author.githubUsername.toLowerCase().includes(query.toLowerCase());
      const emailMatch = author.email.toLowerCase().includes(query.toLowerCase());
      return nameMatch || handleMatch || emailMatch;
    })
    .map((author) => {
      const avatarSource = getAuthorAvatarSource(author);
      return {
        name: author.name,
        email: author.email,
        githubUsername: avatarSource?.username || author.githubUsername,
        avatarUrl: avatarSource?.url,
        isGithubApiResult: false,
      };
    })
    .slice(0, 5);

  const suggestions = [...localMatches];

  if (query.length >= 2) {
    const alreadyMatchedLocalGithub = localMatches.some(
      (m) => m.githubUsername && m.githubUsername.toLowerCase() === query.toLowerCase(),
    );

    if (!alreadyMatchedLocalGithub) {
      suggestions.push({
        name: `GitHub: @${query}`,
        email: 'GitHub user lookup...',
        githubUsername: query,
        isGithubApiResult: true,
        isPlaceholder: true,
      });

      lookupGithubCoauthor(query);
    }
  }

  state.activeCoauthorSuggestionIndex = suggestions.length > 0 ? 0 : -1;
  renderCoauthorSuggestions(suggestions);
}

function handleCoauthorKeyDown(e) {
  if (state.coauthorSuggestions.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    state.activeCoauthorSuggestionIndex = (state.activeCoauthorSuggestionIndex + 1) % state.coauthorSuggestions.length;
    renderCoauthorSuggestions(state.coauthorSuggestions);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    state.activeCoauthorSuggestionIndex = (state.activeCoauthorSuggestionIndex - 1 + state.coauthorSuggestions.length) % state.coauthorSuggestions.length;
    renderCoauthorSuggestions(state.coauthorSuggestions);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (state.activeCoauthorSuggestionIndex !== -1) {
      selectCoauthorSuggestion(state.activeCoauthorSuggestionIndex);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    renderCoauthorSuggestions([]);
    state.activeCoauthorSuggestionIndex = -1;
    els.coauthorInput.blur();
  }
}


let currentSystemInfo = null;
let aiLoadingInterval = null;

const aiLoadingStages = [
  'Diff inceleniyor...',
  'Degisiklikler analiz ediliyor...',
  'Commit mesaji olusturuluyor...',
  'Conventional Commit formatina donusturuluyor...',
  'Son duzenlemeler yapiliyor...',
];

function startAiLoadingAnimation(model) {
  const subtitleEl = $('commit-loading-subtitle');
  if (!subtitleEl) return;
  let stageIndex = 0;
  subtitleEl.textContent = aiLoadingStages[0];
  aiLoadingInterval = window.setInterval(() => {
    stageIndex = (stageIndex + 1) % aiLoadingStages.length;
    subtitleEl.textContent = aiLoadingStages[stageIndex];
  }, 3000);
}

function stopAiLoadingAnimation() {
  if (aiLoadingInterval) {
    window.clearInterval(aiLoadingInterval);
    aiLoadingInterval = null;
  }
}

async function generateAiCommitMessage() {
  const provider = appSettings.aiProvider || 'ollama';
  if (provider === 'gemini' && !appSettings.geminiApiKey) {
    alert('Gemini API key is not set. Please add your API key in Settings.');
    openSettingsModal();
    return;
  }

  const selectedPaths = [...state.selectedWorktreePaths];
  if (selectedPaths.length === 0) {
    alert('Please select at least one modified file to generate a commit message.');
    return;
  }

  let currentModel = 'gemma4:12b';
  let displayTag = 'AI';
  if (provider === 'gemini') {
    currentModel = appSettings.geminiModel || 'gemini-2.5-flash';
    displayTag = `Gemini: ${currentModel}`;
  } else if (provider === 'lmstudio') {
    await checkLmStudioStatus();
    currentModel = state.lmStudioModels[0] || 'local-model';
    displayTag = `LM Studio: ${currentModel}`;
  } else {
    currentModel = appSettings.selectedModel || 'gemma4:12b';
    displayTag = `Ollama: ${currentModel}`;
  }

  try {
    els.btnAiGenerateCommit.disabled = true;
    els.btnAiGenerateCommit.classList.add('is-loading');
    els.btnAiGenerateCommit.innerHTML = `
      <span class="spinner-icon"></span>
      <span>AI Writing...</span>
      <span class="ai-model-tag">${escapeHtml(displayTag)}</span>
    `;
    if (els.commitBox) {
      els.commitBox.classList.add('is-loading');
    }
    startAiLoadingAnimation(displayTag);
    setStatus('AI is generating commit message...');

    let generatedMessage;
    if (provider === 'gemini') {
      generatedMessage = await invoke('generate_ai_commit_message_gemini', {
        diff: null,
        paths: selectedPaths,
        model: appSettings.geminiModel || 'gemini-2.5-flash',
        apiKey: appSettings.geminiApiKey,
      });
    } else if (provider === 'lmstudio') {
      generatedMessage = await invoke('generate_ai_commit_message_lm_studio', {
        diff: null,
        paths: selectedPaths,
        model: currentModel,
      });
    } else {
      generatedMessage = await invoke('generate_ai_commit_message', {
        diff: null,
        paths: selectedPaths,
        model: currentModel,
      });
    }

    if (generatedMessage) {
      els.commitMessageInput.value = generatedMessage;
      updateCommitAction();
      setStatus('AI commit message generated!');
    }
  } catch (err) {
    console.error(err);
    setStatus('Failed to generate AI commit message');
    alert(`AI Commit Error: ${err}\n\nNote: Ensure ${provider === 'gemini' ? 'your Gemini API key is valid' : `Ollama is running and model (${currentModel}) is pulled`}.`);
  } finally {
    stopAiLoadingAnimation();
    els.btnAiGenerateCommit.disabled = false;
    els.btnAiGenerateCommit.classList.remove('is-loading');
    els.btnAiGenerateCommit.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
      </svg>
      <span>AI Write Commit</span>
      <span class="ai-model-tag" id="commit-ai-model-tag">${escapeHtml(displayTag)}</span>
    `;
    if (els.commitBox) {
      els.commitBox.classList.remove('is-loading');
    }
  }
}

async function openSettingsModal() {
  try {
    setStatus('Loading settings...');

    let gitSettings = null;
    try {
      gitSettings = await invoke('get_git_settings');
      state.gitIdentities = gitSettings.identities;
      state.gpgKeys = gitSettings.gpg_keys;
    } catch (e) {
      console.log('get_git_settings error:', e);
    }

    els.settingGitName.value = appSettings.gitName || gitSettings?.current_name || '';
    els.settingGitEmail.value = appSettings.gitEmail || gitSettings?.current_email || '';
    els.settingGpgSign.checked = appSettings.gpgSign || gitSettings?.gpg_sign_enabled || false;

    const uiScaleSelect = document.getElementById('setting-ui-scale');
    if (uiScaleSelect) {
      uiScaleSelect.value = appSettings.uiScale || '1.0';
      uiScaleSelect.onchange = (e) => applyUiScale(e.target.value);
    }

    const signedOffByCheckbox = document.getElementById('commit-signed-off-by');
    if (signedOffByCheckbox) signedOffByCheckbox.checked = appSettings.signedOffBy || false;

    const provider = appSettings.aiProvider || 'ollama';
    const radioOllama = document.getElementById('ai-provider-ollama');
    const radioGemini = document.getElementById('ai-provider-gemini');
    const radioLmStudio = document.getElementById('ai-provider-lmstudio');
    if (radioOllama) radioOllama.checked = provider === 'ollama';
    if (radioGemini) radioGemini.checked = provider === 'gemini';
    if (radioLmStudio) radioLmStudio.checked = provider === 'lmstudio';
    switchAiProviderPanel(provider);
    checkLmStudioStatus();

    const geminiKeyInput = document.getElementById('setting-gemini-api-key');
    if (geminiKeyInput) geminiKeyInput.value = appSettings.geminiApiKey || '';

    if (provider === 'gemini' && appSettings.geminiApiKey) {
      fetchGeminiModels();
    }

    els.settingGpgKey.innerHTML = '<option value="none">None / Git Default</option>';
    if (gitSettings && gitSettings.gpg_keys.length > 0) {
      gitSettings.gpg_keys.forEach((key) => {
        const sel = (appSettings.gpgKey === key.key_id || key.is_default) ? 'selected' : '';
        els.settingGpgKey.innerHTML += `<option value="${escapeHtml(key.key_id)}" ${sel}>${escapeHtml(key.key_id)} (${escapeHtml(key.uid)})</option>`;
      });
    }

    updateCommitOptionDropdowns(gitSettings);

    currentSystemInfo = await invoke('get_system_info');
    renderSystemInfo(currentSystemInfo);

    await loadSmtpSettings();

    els.settingsModal.removeAttribute('hidden');
    setStatus('Settings opened');
  } catch (err) {
    console.error('Error opening settings:', err);
    alert(`Error loading settings: ${err}`);
  }
}

function switchAiProviderPanel(provider) {
  const ollamaPanel = document.getElementById('ollama-panel');
  const geminiPanel = document.getElementById('gemini-panel');
  const lmstudioPanel = document.getElementById('lmstudio-panel');
  if (ollamaPanel) ollamaPanel.style.display = provider === 'ollama' ? 'block' : 'none';
  if (geminiPanel) geminiPanel.style.display = provider === 'gemini' ? 'block' : 'none';
  if (lmstudioPanel) lmstudioPanel.style.display = provider === 'lmstudio' ? 'block' : 'none';
}

async function checkLmStudioStatus() {
  const specStatus = document.getElementById('spec-lmstudio-status');
  const selectLmStudio = document.getElementById('setting-lmstudio-model');
  try {
    const res = await invoke('check_lm_studio_status');
    state.lmStudioRunning = res.running;
    state.lmStudioModels = res.models || [];

    if (specStatus) {
      if (res.running) {
        specStatus.textContent = `Server Running (${res.models.length} model(s) loaded)`;
        specStatus.style.color = '#3fb950';
      } else {
        specStatus.textContent = 'Server Not Running (127.0.0.1:1234)';
        specStatus.style.color = '#ff7b72';
      }
    }

    if (selectLmStudio) {
      selectLmStudio.innerHTML = '';
      if (res.models && res.models.length > 0) {
        const savedLm = appSettings.lmStudioModel || res.models[0];
        res.models.forEach((m) => {
          const isSel = m === savedLm ? 'selected' : '';
          selectLmStudio.innerHTML += `<option value="${escapeHtml(m)}" ${isSel}>${escapeHtml(m)}</option>`;
        });
      } else {
        selectLmStudio.innerHTML = `<option value="">${res.running ? 'No model loaded in LM Studio' : 'LM Studio Server Off'}</option>`;
      }
    }
    updateAiModelSelectOptions();
    return res;
  } catch (err) {
    if (specStatus) {
      specStatus.textContent = 'Error checking LM Studio status';
      specStatus.style.color = '#ff7b72';
    }
    return { running: false, models: [] };
  }
}

function updateAiModelSelectOptions() {
  const selectEl = document.getElementById('commit-ai-model-select');
  if (!selectEl) return;

  const currentProvider = appSettings.aiProvider || 'ollama';
  let html = '';

  // 1. Ollama (Local)
  html += '<optgroup label="Ollama (Local)">';
  const ollamaModels = currentSystemInfo?.installed_models || ['gemma4:12b', 'gemma2:9b', 'gemma:2b'];
  const curOllama = appSettings.selectedModel || 'gemma4:12b';
  ollamaModels.forEach((m) => {
    html += `<option value="ollama:${escapeHtml(m)}">Ollama: ${escapeHtml(m)}</option>`;
  });
  html += '</optgroup>';

  // 2. Gemini (Cloud)
  html += '<optgroup label="Gemini (Cloud)">';
  const geminiList = (state.geminiModels && state.geminiModels.length > 0)
    ? state.geminiModels
    : ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  if (appSettings.geminiModel && !geminiList.includes(appSettings.geminiModel)) {
    geminiList.unshift(appSettings.geminiModel);
  }
  geminiList.forEach((m) => {
    html += `<option value="gemini:${escapeHtml(m)}">Gemini: ${escapeHtml(m)}</option>`;
  });
  html += '</optgroup>';

  // 3. LM Studio (Local)
  html += '<optgroup label="LM Studio (Local)">';
  const lmList = (state.lmStudioModels && state.lmStudioModels.length > 0)
    ? state.lmStudioModels
    : ['local-model'];
  if (appSettings.lmStudioModel && !lmList.includes(appSettings.lmStudioModel)) {
    lmList.unshift(appSettings.lmStudioModel);
  }
  lmList.forEach((m) => {
    html += `<option value="lmstudio:${escapeHtml(m)}">LM Studio: ${escapeHtml(m)}</option>`;
  });
  html += '</optgroup>';

  selectEl.innerHTML = html;

  // Set the selected value explicitly
  let activeVal = `ollama:${appSettings.selectedModel || 'gemma4:12b'}`;
  if (currentProvider === 'gemini') {
    activeVal = `gemini:${appSettings.geminiModel || 'gemini-2.5-flash'}`;
  } else if (currentProvider === 'lmstudio') {
    activeVal = `lmstudio:${appSettings.lmStudioModel || 'local-model'}`;
  }

  selectEl.value = activeVal;

  if (els.commitAiModelTag) {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    els.commitAiModelTag.textContent = selectedOpt ? selectedOpt.text : activeVal;
  }
}

async function fetchGeminiModels() {
  const apiKey = document.getElementById('setting-gemini-api-key')?.value?.trim();
  const select = els.settingGeminiModel;
  const statusEl = els.geminiModelStatus;

  if (!apiKey) {
    if (statusEl) {
      statusEl.textContent = 'Enter an API key first.';
      statusEl.className = 'gemini-model-status error';
    }
    return;
  }

  const savedModel = appSettings.geminiModel || '';
  if (statusEl) {
    statusEl.textContent = 'Fetching models...';
    statusEl.className = 'gemini-model-status';
  }

  try {
    if (els.btnFetchGeminiModels) {
      els.btnFetchGeminiModels.disabled = true;
      els.btnFetchGeminiModels.textContent = 'Loading...';
    }

    const models = await invoke('list_gemini_models', { apiKey });

    if (!models || models.length === 0) {
      if (statusEl) {
        statusEl.textContent = 'No generateContent models found for this key.';
        statusEl.className = 'gemini-model-status error';
      }
      return;
    }

    state.geminiModels = models;

    if (select) {
      select.innerHTML = '';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
      });

      if (savedModel && models.includes(savedModel)) {
        select.value = savedModel;
      }
    }

    if (statusEl) {
      statusEl.textContent = `${models.length} model(s) loaded.`;
      statusEl.className = 'gemini-model-status ok';
    }

    updateAiModelSelectOptions();
  } catch (err) {
    console.error('fetchGeminiModels error:', err);
    if (statusEl) {
      statusEl.textContent = `Error: ${err}`;
      statusEl.className = 'gemini-model-status error';
    }
  } finally {
    if (els.btnFetchGeminiModels) {
      els.btnFetchGeminiModels.disabled = false;
      els.btnFetchGeminiModels.textContent = 'Refresh';
    }
  }
}

function closeSettingsModal() {
  els.settingsModal.setAttribute('hidden', '');
}

async function loadSmtpSettings() {
  try {
    const smtp = await invoke('get_smtp_settings');
    const smtpEnabled = document.getElementById('setting-smtp-enabled');
    const smtpFields = document.getElementById('smtp-config-fields');
    const smtpHost = document.getElementById('setting-smtp-host');
    const smtpPort = document.getElementById('setting-smtp-port');
    const smtpTls = document.getElementById('setting-smtp-tls');
    const smtpUsername = document.getElementById('setting-smtp-username');
    const smtpPassword = document.getElementById('setting-smtp-password');
    const smtpFrom = document.getElementById('setting-smtp-from');
    const smtpTo = document.getElementById('setting-smtp-to');

    if (smtpEnabled) smtpEnabled.checked = smtp.enabled;
    if (smtpFields) smtpFields.style.display = smtp.enabled ? 'block' : 'none';
    if (smtpHost) smtpHost.value = smtp.host || '';
    if (smtpPort) smtpPort.value = smtp.port || 587;
    if (smtpTls) smtpTls.checked = smtp.useTls !== false;
    if (smtpUsername) smtpUsername.value = smtp.username || '';
    if (smtpPassword) smtpPassword.value = smtp.password || '';
    if (smtpFrom) smtpFrom.value = smtp.fromEmail || '';
    if (smtpTo) smtpTo.value = smtp.toEmail || '';

    if (smtpEnabled) {
      smtpEnabled.addEventListener('change', () => {
        if (smtpFields) smtpFields.style.display = smtpEnabled.checked ? 'block' : 'none';
      });
    }
  } catch (e) {
    console.log('loadSmtpSettings error:', e);
  }
}

async function fetchAndPopulateGitSettings() {
  try {
    const gitSettings = await invoke('get_git_settings');
    state.gitIdentities = gitSettings.identities || [];
    state.gpgKeys = gitSettings.gpg_keys || [];
    updateCommitOptionDropdowns(gitSettings);
    return gitSettings;
  } catch (err) {
    console.error('Error fetching git settings:', err);
    updateCommitOptionDropdowns(null);
  }
}

function updateCommitOptionDropdowns(gitSettings) {
  let identityHtml = '';
  
  if (appSettings.gitName && appSettings.gitEmail) {
    const customVal = `${appSettings.gitName} <${appSettings.gitEmail}>`;
    identityHtml += `<option value="${escapeHtml(customVal)}">${escapeHtml(appSettings.gitName)} &lt;${escapeHtml(appSettings.gitEmail)}&gt; (Configured)</option>`;
  }
  
  if (gitSettings && gitSettings.current_name && gitSettings.current_email) {
    const currVal = `${gitSettings.current_name} <${gitSettings.current_email}>`;
    if (!identityHtml.includes(escapeHtml(currVal))) {
      identityHtml += `<option value="${escapeHtml(currVal)}" selected>${escapeHtml(gitSettings.current_name)} &lt;${escapeHtml(gitSettings.current_email)}&gt; (Git Default)</option>`;
    }
  } else if (!identityHtml) {
    identityHtml += `<option value="">Default Identity</option>`;
  }

  if (gitSettings && gitSettings.identities && gitSettings.identities.length > 0) {
    gitSettings.identities.forEach((id) => {
      const val = `${id.name} <${id.email}>`;
      if (!identityHtml.includes(escapeHtml(val))) {
        identityHtml += `<option value="${escapeHtml(val)}">${escapeHtml(id.name)} &lt;${escapeHtml(id.email)}&gt;</option>`;
      }
    });
  }
  
  identityHtml += `<option value="__manage__">+ Manage in Settings...</option>`;
  els.commitIdentitySelect.innerHTML = identityHtml;

  let gpgHtml = `
    <option value="none" ${!gitSettings?.gpg_sign_enabled ? 'selected' : ''}>No Signing (--no-gpg-sign)</option>
    <option value="default" ${gitSettings?.gpg_sign_enabled ? 'selected' : ''}>Default Key (-S)</option>
  `;

  if (gitSettings && gitSettings.gpg_keys && gitSettings.gpg_keys.length > 0) {
    gitSettings.gpg_keys.forEach((key) => {
      const sel = (appSettings.gpgKey === key.key_id || key.is_default) ? 'selected' : '';
      gpgHtml += `<option value="${escapeHtml(key.key_id)}" ${sel}>Key: ${escapeHtml(key.key_id)} (${escapeHtml(key.uid)})</option>`;
    });
  }

  gpgHtml += `<option value="__manage__">+ Manage Keys in Settings...</option>`;
  els.commitGpgSelect.innerHTML = gpgHtml;
}

function renderSystemInfo(sys) {
  if (!sys) return;

  els.specOsDistro.textContent = sys.distro || sys.os;
  els.specRam.textContent = `${sys.ram_gb} GB RAM`;
  els.specGpu.textContent = `${sys.gpu_name} (${sys.vram_gb} GB VRAM)`;

  if (sys.ollama_installed && sys.ollama_running) {
    els.specOllamaStatus.textContent = 'Installed & Running';
    els.specOllamaStatus.style.color = '#3fb950';
    els.ollamaInstallBox.style.display = 'none';
  } else if (sys.ollama_installed) {
    els.specOllamaStatus.textContent = 'Installed (Service Offline)';
    els.specOllamaStatus.style.color = '#d29922';
    els.ollamaInstallBox.style.display = 'none';
  } else {
    els.specOllamaStatus.textContent = 'Not Installed';
    els.specOllamaStatus.style.color = '#f85149';
    els.ollamaInstallBox.style.display = 'flex';
  }

  els.recommendedModelTitle.textContent = `${sys.recommended_model} (Top Recommended)`;
  const currentSel = appSettings.selectedModel || sys.recommended_model || 'gemma4:12b';
  if (els.commitAiModelTag) els.commitAiModelTag.textContent = currentSel;

  if (els.settingAiModel) {
    let html = '';
    const installedList = sys.installed_models || [];

    if (installedList.length > 0) {
      html += '<optgroup label="Installed Local Models">';
      installedList.forEach((m) => {
        const isSel = m === currentSel ? 'selected' : '';
        html += `<option value="${escapeHtml(m)}" ${isSel}>${escapeHtml(m)} (Installed)</option>`;
      });
      html += '</optgroup>';
    }

    const defaultModels = ['gemma4:12b', 'gemma2:9b', 'gemma2:27b', 'gemma:7b', 'gemma:2b'];
    html += '<optgroup label="Available Models to Pull">';
    defaultModels.forEach((m) => {
      const isInst = installedList.some((inst) => inst.includes(m));
      if (!isInst) {
        const isSel = m === currentSel ? 'selected' : '';
        const rec = m === sys.recommended_model ? ' - Top Recommended' : '';
        html += `<option value="${escapeHtml(m)}" ${isSel}>${escapeHtml(m)}${rec}</option>`;
      }
    });
    html += '</optgroup>';

    els.settingAiModel.innerHTML = html;
    els.settingAiModel.value = currentSel;
  }

  updateModelPullStatus(sys, currentSel);
}

function updateModelPullStatus(sys, selectedModel) {
  if (!sys) sys = currentSystemInfo;
  if (!selectedModel) selectedModel = els.settingAiModel?.value || appSettings.selectedModel || 'gemma4:12b';

  const isPulled = sys?.installed_models?.some((m) => m.includes(selectedModel));
  if (isPulled) {
    els.modelStatusText.textContent = `Status: Model (${selectedModel}) Ready`;
    els.btnPullModel.disabled = true;
    els.btnPullModel.textContent = 'Ready';
  } else {
    els.modelStatusText.textContent = `Status: Model (${selectedModel}) is not pulled yet`;
    els.btnPullModel.disabled = false;
    els.btnPullModel.textContent = `Pull Model (${selectedModel})`;
  }
}

async function saveSettings() {
  try {
    const name = els.settingGitName.value.trim();
    const email = els.settingGitEmail.value.trim();
    const signingKey = els.settingGpgKey.value;
    const gpgSign = els.settingGpgSign.checked;
    const selectedModel = els.settingAiModel.value;
    const signedOffBy = document.getElementById('commit-signed-off-by')?.checked || false;

    const radioOllama = document.getElementById('ai-provider-ollama');
    const radioGemini = document.getElementById('ai-provider-gemini');
    const radioLmStudio = document.getElementById('ai-provider-lmstudio');
    let aiProvider = 'ollama';
    if (radioGemini && radioGemini.checked) aiProvider = 'gemini';
    if (radioLmStudio && radioLmStudio.checked) aiProvider = 'lmstudio';
    const geminiKeyInput = document.getElementById('setting-gemini-api-key');
    const geminiModelSelect = document.getElementById('setting-gemini-model');
    const geminiApiKey = geminiKeyInput ? geminiKeyInput.value.trim() : '';
    const geminiModel = geminiModelSelect ? geminiModelSelect.value : 'gemini-2.5-flash';

    const smtpEnabled = document.getElementById('setting-smtp-enabled')?.checked || false;
    const smtpSettings = {
      enabled: smtpEnabled,
      host: document.getElementById('setting-smtp-host')?.value?.trim() || '',
      port: parseInt(document.getElementById('setting-smtp-port')?.value || '587', 10) || 587,
      username: document.getElementById('setting-smtp-username')?.value?.trim() || '',
      password: document.getElementById('setting-smtp-password')?.value || '',
      fromEmail: document.getElementById('setting-smtp-from')?.value?.trim() || '',
      toEmail: document.getElementById('setting-smtp-to')?.value?.trim() || '',
      useTls: document.getElementById('setting-smtp-tls')?.checked ?? true,
    };

    appSettings = {
      aiProvider,
      geminiApiKey,
      geminiModel,
      selectedModel,
      gitName: name,
      gitEmail: email,
      gpgKey: signingKey,
      gpgSign,
      signedOffBy,
      smtpEnabled,
    };
    saveAppSettings(appSettings);

    if (state.repoInfo) {
      await invoke('save_git_settings', {
        name,
        email,
        signingKey: signingKey === 'none' ? '' : signingKey,
        gpgSign,
      });
    }

    try {
      await invoke('save_smtp_settings', { settings: smtpSettings });
    } catch (e) {
      console.log('SMTP save error:', e);
    }

    let displayTag = `Ollama: ${selectedModel}`;
    if (aiProvider === 'gemini') displayTag = `Gemini: ${geminiModel}`;
    if (aiProvider === 'lmstudio') {
      const lmModel = state.lmStudioModels[0] || 'local-model';
      displayTag = `LM Studio: ${lmModel}`;
    }
    if (els.commitAiModelTag) els.commitAiModelTag.textContent = displayTag;

    const uiScaleSelect = document.getElementById('setting-ui-scale');
    if (uiScaleSelect) {
      appSettings.uiScale = uiScaleSelect.value;
      applyUiScale(appSettings.uiScale);
    }

    closeSettingsModal();
    setStatus('Settings saved successfully');
  } catch (err) {
    console.error('Error saving settings:', err);
    alert(`Error saving settings: ${err}`);
  }
}

async function installOllama() {
  try {
    els.btnInstallOllama.disabled = true;
    els.btnInstallOllama.textContent = 'Installing...';
    setStatus('Installing Ollama automatically...');

    const res = await invoke('install_ollama');
    alert(`Ollama Installation Result: ${res}`);

    currentSystemInfo = await invoke('get_system_info');
    renderSystemInfo(currentSystemInfo);
  } catch (err) {
    console.error(err);
    alert(`Ollama Installation Error: ${err}`);
  } finally {
    els.btnInstallOllama.disabled = false;
    els.btnInstallOllama.textContent = 'Auto-Install Ollama';
  }
}

async function pullModel() {
  const model = appSettings.selectedModel || 'gemma4:12b';
  try {
    els.btnPullModel.disabled = true;
    els.btnPullModel.textContent = 'Downloading...';
    setStatus(`Downloading model (${model})... This may take a few minutes.`);

    const res = await invoke('pull_ollama_model', { modelName: model });
    alert(`Model Pull Result: ${res}`);

    currentSystemInfo = await invoke('get_system_info');
    renderSystemInfo(currentSystemInfo);
  } catch (err) {
    console.error(err);
    alert(`Model Pull Error: ${err}`);
  } finally {
    els.btnPullModel.disabled = false;
    els.btnPullModel.textContent = 'Pull / Download Model';
  }
}

function initDetailToggle() {
  const toggleBtn = document.getElementById('btn-toggle-detail-panel');
  const mainContent = document.getElementById('main-content');
  const detailPanel = document.getElementById('commit-detail-panel');

  function updateToggleBtnState(isHidden) {
    if (toggleBtn) {
      if (isHidden) {
        toggleBtn.classList.add('is-closed');
        toggleBtn.title = 'Commit Detail Panelini Aç';
      } else {
        toggleBtn.classList.remove('is-closed');
        toggleBtn.title = 'Commit Detail Panelini Kapat';
      }
    }
  }

  function toggleDetailPanel(forceState) {
    if (!mainContent) return;
    const isHidden = mainContent.classList.contains('hide-detail-panel');
    const shouldHide = forceState !== undefined ? !forceState : !isHidden;

    if (shouldHide) {
      mainContent.classList.add('hide-detail-panel');
      updateToggleBtnState(true);
    } else {
      mainContent.classList.remove('hide-detail-panel');
      updateToggleBtnState(false);
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleDetailPanel();
    });
  }

  if (mainContent && !mainContent.classList.contains('hide-detail-panel')) {
    mainContent.classList.add('hide-detail-panel');
  }
  updateToggleBtnState(true);

  if (detailPanel) {
    detailPanel.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.detail-tab');
      if (tabBtn) {
        e.preventDefault();
        const tabName = tabBtn.dataset.tab;
        if (tabName) activateDetailTab(tabName);
        return;
      }

      const closeBtn = e.target.closest('#btn-close-detail-panel');
      if (closeBtn) {
        e.preventDefault();
        toggleDetailPanel(false);
        return;
      }

      const fileBtn = e.target.closest('.changed-file');
      if (fileBtn) {
        e.preventDefault();
        const index = Number.parseInt(fileBtn.dataset.fileIdx, 10);
        if (!Number.isNaN(index)) {
          activateDetailTab('changes');
          scrollToDiffFile(index);
          document.querySelectorAll('.changed-file').forEach((item) => item.classList.remove('selected'));
          fileBtn.classList.add('selected');
        }
        return;
      }
    });
  }
}

function initEventHandlers() {
  initDetailToggle();
  els.btnHome.addEventListener('click', showHomeScreen);
  els.btnOpenRepo.addEventListener('click', () => openRepo());
  els.btnWelcomeOpen.addEventListener('click', () => openRepo());
  els.btnOpenSettings.addEventListener('click', openSettingsModal);
  els.btnCloseSettings.addEventListener('click', closeSettingsModal);
  els.btnCancelSettings.addEventListener('click', closeSettingsModal);
  els.btnSaveSettings.addEventListener('click', saveSettings);
  els.btnInstallOllama.addEventListener('click', installOllama);
  els.btnPullModel.addEventListener('click', pullModel);
  els.btnAiGenerateCommit.addEventListener('click', generateAiCommitMessage);

  const btnLoadDetail = document.getElementById('btn-load-commit-to-form');
  if (btnLoadDetail) {
    btnLoadDetail.addEventListener('click', () => {
      if (state.selectedCommit) {
        loadCommitIntoForm(state.selectedCommit);
      }
    });
  }

  const btnCancelEdit = document.getElementById('btn-cancel-edit-commit');
  if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', cancelCommitEdit);
  }

  const commitAiSelect = document.getElementById('commit-ai-model-select');
  if (commitAiSelect) {
    commitAiSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      const parts = val.split(':');
      const provider = parts[0];
      const modelName = parts.slice(1).join(':');

      appSettings.aiProvider = provider;
      if (provider === 'ollama') appSettings.selectedModel = modelName;
      if (provider === 'gemini') appSettings.geminiModel = modelName;
      if (provider === 'lmstudio') appSettings.lmStudioModel = modelName;

      saveAppSettings(appSettings);
      setStatus(`Default AI model set to ${provider.toUpperCase()}: ${modelName}`);
    });
  }

  const btnSaveOllama = document.getElementById('btn-save-ollama-default');
  if (btnSaveOllama) {
    btnSaveOllama.addEventListener('click', () => {
      appSettings.aiProvider = 'ollama';
      appSettings.selectedModel = els.settingAiModel?.value || 'gemma4:12b';
      saveAppSettings(appSettings);
      updateAiModelSelectOptions();
      setStatus(`Ollama (${appSettings.selectedModel}) set as default AI model`);
      alert(`Ollama (${appSettings.selectedModel}) saved as default AI model.`);
    });
  }

  const btnSaveGemini = document.getElementById('btn-save-gemini-default');
  if (btnSaveGemini) {
    btnSaveGemini.addEventListener('click', () => {
      const m = document.getElementById('setting-gemini-model')?.value || 'gemini-2.5-flash';
      appSettings.aiProvider = 'gemini';
      appSettings.geminiModel = m;
      saveAppSettings(appSettings);
      updateAiModelSelectOptions();
      setStatus(`Gemini (${m}) set as default AI model`);
      alert(`Gemini (${m}) saved as default AI model.`);
    });
  }

  const btnSaveLmStudio = document.getElementById('btn-save-lmstudio-default');
  if (btnSaveLmStudio) {
    btnSaveLmStudio.addEventListener('click', () => {
      const m = document.getElementById('setting-lmstudio-model')?.value || 'local-model';
      appSettings.aiProvider = 'lmstudio';
      appSettings.lmStudioModel = m;
      saveAppSettings(appSettings);
      updateAiModelSelectOptions();
      setStatus(`LM Studio (${m}) set as default AI model`);
      alert(`LM Studio (${m}) saved as default AI model.`);
    });
  }

  const btnRefreshLmStudio = document.getElementById('btn-refresh-lmstudio');
  if (btnRefreshLmStudio) {
    btnRefreshLmStudio.addEventListener('click', () => {
      checkLmStudioStatus();
    });
  }

  updateAiModelSelectOptions();
  els.topPushBtn.addEventListener('click', pushOrigin);
  if (els.btnUnpushedBannerPush) {
    els.btnUnpushedBannerPush.addEventListener('click', pushOrigin);
  }
  els.commitIdentitySelect.addEventListener('change', (e) => {
    if (e.target.value === '__manage__') {
      openSettingsModal();
      e.target.selectedIndex = 0;
    }
  });

  els.commitGpgSelect.addEventListener('change', (e) => {
    if (e.target.value === '__manage__') {
      openSettingsModal();
      e.target.selectedIndex = 0;
    }
  });

  document.querySelectorAll('input[name="ai-provider"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      switchAiProviderPanel(e.target.value);
    });
  });

  const geminiKeyInput = document.getElementById('setting-gemini-api-key');
  const btnToggleKey = document.getElementById('btn-toggle-gemini-key');
  const btnCopyKey = document.getElementById('btn-copy-gemini-key');
  if (btnToggleKey && geminiKeyInput) {
    btnToggleKey.addEventListener('click', () => {
      const isPassword = geminiKeyInput.type === 'password';
      geminiKeyInput.type = isPassword ? 'text' : 'password';
      btnToggleKey.textContent = isPassword ? 'Hide' : 'Show';
    });
  }
  if (btnCopyKey && geminiKeyInput) {
    btnCopyKey.addEventListener('click', () => {
      if (geminiKeyInput.value) {
        navigator.clipboard.writeText(geminiKeyInput.value);
        btnCopyKey.textContent = 'Copied!';
        setTimeout(() => { btnCopyKey.textContent = 'Copy'; }, 1500);
      }
    });
  }
  if (els.btnFetchGeminiModels) {
    els.btnFetchGeminiModels.addEventListener('click', fetchGeminiModels);
  }

  els.settingAiModel.addEventListener('change', (e) => {
    appSettings.selectedModel = e.target.value;
    if (currentSystemInfo) renderSystemInfo(currentSystemInfo);
  });

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
  els.btnShowAddOrigin.addEventListener('click', showAddOriginForm);
  els.btnCancelOrigin.addEventListener('click', hideAddOriginForm);
  els.btnSaveOrigin.addEventListener('click', saveRemoteOrigin);
  els.remoteUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRemoteOrigin();
    }
  });
  els.commitMessageInput.addEventListener('input', updateCommitAction);
  els.btnShowContributors.addEventListener('click', openContributorsModal);
  els.btnCloseContributors.addEventListener('click', closeContributorsModal);
  els.contributorsModal.addEventListener('click', (event) => {
    if (event.target === els.contributorsModal) closeContributorsModal();
  });
  els.settingsModal.addEventListener('click', (event) => {
    if (event.target === els.settingsModal) closeSettingsModal();
  });

  els.btnCloseMerge.addEventListener('click', closeMergeModal);
  els.btnCancelMerge.addEventListener('click', closeMergeModal);
  els.btnConfirmMerge.addEventListener('click', confirmMerge);
  els.mergeModal.addEventListener('click', (event) => {
    if (event.target === els.mergeModal) closeMergeModal();
  });

  els.coauthorInput.addEventListener('input', handleCoauthorInput);
  els.coauthorInput.addEventListener('keydown', handleCoauthorKeyDown);
  document.addEventListener('click', (event) => {
    if (!els.coauthorInput.contains(event.target) && !els.coauthorSuggestions.contains(event.target)) {
      renderCoauthorSuggestions([]);
      state.activeCoauthorSuggestionIndex = -1;
    }
  });

  els.searchInput.addEventListener('input', (event) => {
    state.searchQuery = event.target.value.trim();
    renderCommits();
  });

  document.querySelectorAll('.detail-tab').forEach((tab) => {
    tab.addEventListener('click', () => activateDetailTab(tab.dataset.tab));
  });

  // GitHub nav tab buttons
  document.querySelectorAll('.gh-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchGhPanel(btn.dataset.panel));
  });

  // Issues filter buttons
  els.issuesFilterGroup?.addEventListener('click', (e) => {
    const btn = e.target.closest('.gh-filter-btn');
    if (btn) loadGhIssues(btn.dataset.filter);
  });

  // PRs filter buttons
  els.prsFilterGroup?.addEventListener('click', (e) => {
    const btn = e.target.closest('.gh-filter-btn');
    if (btn) loadGhPrs(btn.dataset.filter);
  });

  // Refresh buttons
  els.btnRefreshIssues?.addEventListener('click', () => loadGhIssues());
  els.btnRefreshPrs?.addEventListener('click', () => loadGhPrs());
  els.btnRefreshActions?.addEventListener('click', () => loadGhActions());

  // Action log modal close
  els.btnCloseActionLog?.addEventListener('click', closeActionLogModal);
  els.actionLogModal?.addEventListener('click', (e) => {
    if (e.target === els.actionLogModal) closeActionLogModal();
  });

  // Remote switcher & fetch events
  els.selectActiveRemote?.addEventListener('change', (e) => switchActiveRemote(e.target.value));
  els.btnFetchRemote?.addEventListener('click', fetchActiveRemote);
  els.btnAddRemoteToggle?.addEventListener('click', () => {
    const isHidden = els.addOriginForm.style.display === 'none';
    els.addOriginForm.style.display = isHidden ? 'block' : 'none';
  });
  els.btnUnpushedBannerPush?.addEventListener('click', pushOrigin);

  // Application update check button
  els.btnCheckUpdate?.addEventListener('click', checkAppUpdate);

  // PR Detail Modal events
  els.btnClosePrDetail?.addEventListener('click', closePrModal);
  els.btnClosePrModalBottom?.addEventListener('click', closePrModal);
  els.prDetailModal?.addEventListener('click', (e) => {
    if (e.target === els.prDetailModal) closePrModal();
  });
  els.btnConfirmPrMerge?.addEventListener('click', confirmPrMerge);

  els.btnPrTabDiff?.addEventListener('click', () => activatePrTab('diff'));
  els.btnPrTabCommits?.addEventListener('click', () => activatePrTab('commits'));
  els.btnPrTabBody?.addEventListener('click', () => activatePrTab('body'));

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      openRepo();
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (els.searchBox.style.display !== 'none') els.searchInput.focus();
    }

    if (event.key === 'Escape' && !els.actionLogModal.hidden) {
      closeActionLogModal();
      return;
    }
    if (event.key === 'Escape' && !els.prDetailModal.hidden) {
      closePrModal();
      return;
    }
    if (event.key === 'Escape' && !els.contributorsModal.hidden) {
      closeContributorsModal();
      return;
    }
    if (event.key === 'Escape' && !els.settingsModal.hidden) {
      closeSettingsModal();
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

document.addEventListener('DOMContentLoaded', async () => {
  applyUiScale(appSettings.uiScale);
  initEventHandlers();
  updateAiModelSelectOptions();
  renderRecentRepos();

  // Auto-fetch Gemini models if Gemini API key exists
  if (appSettings.geminiApiKey) {
    fetchGeminiModels();
  }
  // Auto-fetch LM Studio models
  checkLmStudioStatus();
});

// ─── GitHub Functions ──────────────────────────────────────────────────────────

function formatRelativeDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

async function checkGhAuth() {
  if (!invoke || !state.repoInfo) return false;
  try {
    const auth = await invoke('check_gh_auth');
    state.ghAuthenticated = auth.authenticated;
    state.ghUser = auth.user || '';
    return auth.authenticated;
  } catch {
    state.ghAuthenticated = false;
    return false;
  }
}

function showGhNavIfGitHub() {
  if (els.githubNav) els.githubNav.style.display = 'flex';
}

function switchGhPanel(panel) {
  state.ghPanel = panel;

  // Update nav button active state
  document.querySelectorAll('.gh-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });

  // Show/hide main panels
  const historyPanel = document.querySelector('.history-panel');
  const detailPanel = document.querySelector('.detail-panel');
  const mainContent = document.getElementById('main-content');

  [historyPanel, detailPanel, els.panelIssues, els.panelPrs, els.panelActions].forEach((el) => {
    if (el) el.style.display = 'none';
  });

  if (panel === 'history') {
    if (historyPanel) historyPanel.style.display = '';
    if (detailPanel && mainContent && !mainContent.classList.contains('hide-detail-panel')) {
      detailPanel.style.display = '';
    }
  } else if (panel === 'issues') {
    if (els.panelIssues) els.panelIssues.style.display = 'flex';
    loadGhIssues();
  } else if (panel === 'prs') {
    if (els.panelPrs) els.panelPrs.style.display = 'flex';
    loadGhPrs();
  } else if (panel === 'actions') {
    if (els.panelActions) els.panelActions.style.display = 'flex';
    loadGhActions();
  }
}

async function loadGhIssues(filter = null) {
  const f = filter || state.ghIssueFilter;
  state.ghIssueFilter = f;

  // Update filter buttons
  els.issuesFilterGroup?.querySelectorAll('.gh-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === f);
  });

  els.issuesList.innerHTML = '<div class="gh-empty-state"><div class="action-log-loading"><div class="spinner"></div><span>Loading issues...</span></div></div>';

  if (!state.ghAuthenticated) {
    const authed = await checkGhAuth();
    if (!authed) {
      renderGhNotAuth(els.issuesList);
      return;
    }
  }

  try {
    setStatus('Loading GitHub Issues...');
    const issues = await invoke('get_github_issues', { filter: f, limit: 50 });
    state.ghIssues = issues;
    renderIssues(issues);
    // Update count badge
    const openCount = issues.filter((i) => i.state === 'open').length;
    if (openCount > 0) {
      els.ghIssuesCount.textContent = openCount;
      els.ghIssuesCount.style.display = 'inline-flex';
    }
    setStatus(`${issues.length} issue(s) loaded`);
  } catch (err) {
    els.issuesList.innerHTML = `<div class="gh-not-auth"><p>Failed to load issues: ${escapeHtml(String(err))}</p></div>`;
    setStatus('Issues could not be loaded');
  }
}

function renderIssues(issues) {
  if (issues.length === 0) {
    els.issuesList.innerHTML = `
      <div class="gh-empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><path d="M12 8v4"></path><circle cx="12" cy="16" r="0.5" fill="currentColor"></circle></svg>
        <strong>No issues found</strong>
        <span>Try a different filter or check back later.</span>
      </div>`;
    return;
  }

  els.issuesList.innerHTML = issues.map((issue) => {
    const stateClass = issue.state || 'open';
    const labels = issue.labels.map((l) => `<span class="gh-label">${escapeHtml(l)}</span>`).join('');
    return `
      <div class="gh-item-card">
        <div class="gh-item-title-row">
          <span class="gh-status-dot ${stateClass}"></span>
          <span class="gh-item-number">#${issue.number}</span>
          <span class="gh-item-title" title="${escapeHtml(issue.title)}">${escapeHtml(issue.title)}</span>
          ${labels ? `<div class="gh-item-labels">${labels}</div>` : ''}
        </div>
        <div class="gh-item-meta">
          <span>by @${escapeHtml(issue.author)}</span>
          <span>${formatRelativeDate(issue.updatedAt || issue.updated_at)}</span>
          ${issue.comments > 0 ? `<span>💬 ${issue.comments}</span>` : ''}
          ${issue.body ? `<span style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(issue.body)}</span>` : ''}
        </div>
        <div class="gh-item-actions">
          <button class="gh-view-btn" type="button" data-url="${escapeHtml(issue.url)}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Open
          </button>
        </div>
      </div>`;
  }).join('');

  // Delegate open buttons
  els.issuesList.querySelectorAll('.gh-view-btn[data-url]').forEach((btn) => {
    btn.addEventListener('click', () => openUrl(btn.dataset.url));
  });
}

async function loadGhPrs(filter = null) {
  const f = filter || state.ghPrFilter;
  state.ghPrFilter = f;

  // Update filter buttons
  els.prsFilterGroup?.querySelectorAll('.gh-filter-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === f);
  });

  els.prsList.innerHTML = '<div class="gh-empty-state"><div class="action-log-loading"><div class="spinner"></div><span>Loading pull requests...</span></div></div>';

  if (!state.ghAuthenticated) {
    const authed = await checkGhAuth();
    if (!authed) {
      renderGhNotAuth(els.prsList);
      return;
    }
  }

  try {
    setStatus('Loading GitHub PRs...');
    const prs = await invoke('get_github_prs', { filter: f, limit: 50 });
    state.ghPrs = prs;
    renderPrs(prs);
    const openCount = prs.filter((p) => p.state === 'open').length;
    if (openCount > 0) {
      els.ghPrsCount.textContent = openCount;
      els.ghPrsCount.style.display = 'inline-flex';
    }
    setStatus(`${prs.length} PR(s) loaded`);
  } catch (err) {
    els.prsList.innerHTML = `<div class="gh-not-auth"><p>Failed to load PRs: ${escapeHtml(String(err))}</p></div>`;
    setStatus('PRs could not be loaded');
  }
}

function renderPrs(prs) {
  if (prs.length === 0) {
    els.prsList.innerHTML = `
      <div class="gh-empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M6 15V6"></path><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
        <strong>No pull requests found</strong>
        <span>Try a different filter.</span>
      </div>`;
    return;
  }

  els.prsList.innerHTML = prs.map((pr) => {
    let stateClass = pr.state || 'open';
    if (pr.isDraft || pr.is_draft) stateClass = 'draft';
    if (pr.state === 'merged') stateClass = 'merged';
    const labels = pr.labels.map((l) => `<span class="gh-label">${escapeHtml(l)}</span>`).join('');
    const branchFlow = pr.headRef || pr.head_ref
      ? `<span style="font-family:var(--mono);font-size:10px;">${escapeHtml(pr.headRef || pr.head_ref)} → ${escapeHtml(pr.baseRef || pr.base_ref)}</span>`
      : '';
    const isOpen = pr.state === 'open';
    return `
      <div class="gh-item-card">
        <div class="gh-item-title-row">
          <span class="gh-status-dot ${stateClass}"></span>
          <span class="gh-item-number">#${pr.number}</span>
          <span class="gh-item-title" title="${escapeHtml(pr.title)}">${escapeHtml(pr.title)}</span>
          ${pr.isDraft || pr.is_draft ? '<span class="gh-label">Draft</span>' : ''}
          ${labels ? `<div class="gh-item-labels">${labels}</div>` : ''}
        </div>
        <div class="gh-item-meta">
          <span>by @${escapeHtml(pr.author)}</span>
          ${branchFlow}
          <span>${formatRelativeDate(pr.updatedAt || pr.updated_at)}</span>
          ${pr.reviews > 0 ? `<span>🔍 ${pr.reviews} review${pr.reviews !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="gh-item-actions">
          <button class="gh-log-btn gh-pr-detail-btn" type="button" data-pr-number="${pr.number}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"></path><polyline points="14 2 14 7 19 7"></polyline></svg>
            View Diff & Commits
          </button>
          ${isOpen ? `
          <button class="gh-view-btn gh-pr-quick-merge-btn" type="button" data-pr-number="${pr.number}" style="border-color:rgba(46,160,67,0.4);color:#3fb950;background:rgba(46,160,67,0.1);">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M6 15V6"></path><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
            Merge
          </button>` : ''}
          <button class="gh-view-btn" type="button" data-url="${escapeHtml(pr.url)}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Open
          </button>
        </div>
      </div>`;
  }).join('');

  // Delegate open buttons
  els.prsList.querySelectorAll('.gh-view-btn[data-url]').forEach((btn) => {
    btn.addEventListener('click', () => openUrl(btn.dataset.url));
  });

  // Delegate View Diff & Commits buttons
  els.prsList.querySelectorAll('.gh-pr-detail-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const num = Number(btn.dataset.prNumber);
      const pr = prs.find((p) => p.number === num);
      if (pr) openPrModal(pr);
    });
  });

  // Delegate Quick Merge buttons
  els.prsList.querySelectorAll('.gh-pr-quick-merge-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const num = Number(btn.dataset.prNumber);
      const pr = prs.find((p) => p.number === num);
      if (pr) openPrModal(pr);
    });
  });
}

async function loadGhActions() {
  els.actionsList.innerHTML = '<div class="gh-empty-state"><div class="action-log-loading"><div class="spinner"></div><span>Loading Actions...</span></div></div>';

  if (!state.ghAuthenticated) {
    const authed = await checkGhAuth();
    if (!authed) {
      renderGhNotAuth(els.actionsList);
      return;
    }
  }

  try {
    setStatus('Loading GitHub Actions...');
    const actions = await invoke('get_github_actions', { limit: 30 });
    state.ghActions = actions;
    renderActions(actions);
    if (actions.length > 0) {
      els.ghActionsCount.textContent = actions.length;
      els.ghActionsCount.style.display = 'inline-flex';
    }
    setStatus(`${actions.length} action run(s) loaded`);
  } catch (err) {
    els.actionsList.innerHTML = `<div class="gh-not-auth"><p>Failed to load Actions: ${escapeHtml(String(err))}</p></div>`;
    setStatus('Actions could not be loaded');
  }
}

function getActionStatusClass(action) {
  const status = action.status || '';
  const conclusion = (action.conclusion || '').toLowerCase();
  if (status === 'in_progress' || status === 'queued') return `${status}`;
  if (status === 'completed') return `completed ${conclusion}`;
  return status;
}

function getActionConclusion(action) {
  if (action.status === 'in_progress') return 'Running';
  if (action.status === 'queued') return 'Queued';
  const c = (action.conclusion || '').toLowerCase();
  if (c === 'success') return 'Success';
  if (c === 'failure') return 'Failed';
  if (c === 'cancelled') return 'Cancelled';
  if (c === 'skipped') return 'Skipped';
  return c || action.status || '';
}

function renderActions(actions) {
  if (actions.length === 0) {
    els.actionsList.innerHTML = `
      <div class="gh-empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <strong>No action runs found</strong>
        <span>No workflow runs for this repository.</span>
      </div>`;
    return;
  }

  els.actionsList.innerHTML = actions.map((action) => {
    const statusClass = getActionStatusClass(action);
    const conclusionLabel = getActionConclusion(action);
    return `
      <div class="gh-item-card">
        <div class="gh-item-title-row">
          <span class="action-status-dot ${statusClass}"></span>
          <span class="gh-item-number" style="font-family:var(--sans);">${escapeHtml(action.workflowName || action.workflow_name)}</span>
          <span class="gh-item-title" title="${escapeHtml(action.name)}">${escapeHtml(action.name)}</span>
          <span class="gh-label" style="${statusClass.includes('success') ? 'background:rgba(63,185,80,0.12);color:#3fb950;' : statusClass.includes('fail') ? 'background:rgba(248,81,73,0.12);color:#f85149;' : ''}">${conclusionLabel}</span>
        </div>
        <div class="gh-item-meta">
          <span style="font-family:var(--mono);font-size:10px;">${escapeHtml(action.headSha || action.head_sha || '')}</span>
          <span>${escapeHtml(action.branch)}</span>
          <span>${escapeHtml(action.event)}</span>
          <span>${formatRelativeDate(action.updatedAt || action.updated_at)}</span>
          ${action.headCommitMessage || action.head_commit_message ? `<span style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml((action.headCommitMessage || action.head_commit_message).split('\n')[0])}</span>` : ''}
        </div>
        <div class="gh-item-actions">
          <button class="gh-log-btn" type="button" data-run-id="${action.id}" data-run-name="${escapeHtml(action.name)}" data-run-status="${escapeHtml(conclusionLabel)}">
            <svg viewBox="0 0 24 24" width="12" height="12"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            View Log
          </button>
          <button class="gh-view-btn" type="button" data-url="${escapeHtml(action.url)}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            GitHub
          </button>
        </div>
      </div>`;
  }).join('');

  // Bind View Log buttons
  els.actionsList.querySelectorAll('.gh-log-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const runId = Number(btn.dataset.runId);
      const runName = btn.dataset.runName;
      const runStatus = btn.dataset.runStatus;
      openActionLog(runId, runName, runStatus);
    });
  });

  // Delegate open buttons
  els.actionsList.querySelectorAll('.gh-view-btn[data-url]').forEach((btn) => {
    btn.addEventListener('click', () => openUrl(btn.dataset.url));
  });
}

async function openActionLog(runId, runName, runStatus) {
  els.actionLogTitle.textContent = runName || `Run #${runId}`;
  els.actionLogMeta.textContent = runStatus || '';
  els.actionLogLoading.style.display = 'flex';
  els.actionLogPre.style.display = 'none';
  els.actionLogPre.textContent = '';
  els.actionLogModal.hidden = false;

  try {
    const log = await invoke('get_action_log', { runId });
    // Strip ANSI escape codes
    const stripped = log.replace(/\x1b\[[0-9;]*[mGKHF]/g, '');
    els.actionLogPre.textContent = stripped;
    els.actionLogLoading.style.display = 'none';
    els.actionLogPre.style.display = 'block';
  } catch (err) {
    els.actionLogPre.textContent = `Error loading log:\n${err}`;
    els.actionLogLoading.style.display = 'none';
    els.actionLogPre.style.display = 'block';
  }
}

function closeActionLogModal() {
  els.actionLogModal.hidden = true;
  els.actionLogPre.textContent = '';
}

function renderGhNotAuth(container) {
  container.innerHTML = `
    <div class="gh-not-auth">
      <svg viewBox="0 0 24 24" width="40" height="40" opacity="0.4"><path d="M12 1C6.477 1 2 5.477 2 11c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 11C22 5.477 17.523 1 12 1z"></path></svg>
      <strong>GitHub CLI not authenticated</strong>
      <p>Run <code>gh auth login</code> in your terminal to connect to GitHub.</p>
      <p style="font-size:11px;">Issues, Pull Requests and Actions require the <strong>gh</strong> CLI.</p>
    </div>`;
}

async function openUrl(url) {
  try {
    if (tauri?.opener?.openUrl) {
      await tauri.opener.openUrl(url);
    } else {
      window.open(url, '_blank');
    }
  } catch {
    window.open(url, '_blank');
  }
}

const EDITOR_CONFIGS = {
  code: {
    className: 'editor-btn-vscode',
    icon: `<svg fill="none" viewBox="0 0 100 100" width="16" height="16"><mask id="a" width="100" height="100" x="0" y="0" mask-type="alpha" maskUnits="userSpaceOnUse"><path fill="#fff" fill-rule="evenodd" d="M70.912 99.317a6.22 6.22 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.23 6.23 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.16 4.16 0 0 0-5.318.236l-5.506 5.009a4.17 4.17 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.17 4.17 0 0 0 .004 6.162l5.506 5.01a4.16 4.16 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.2 6.2 0 0 0 2.143 1.4M75.015 27.3 45.11 50l29.906 22.701z" clip-rule="evenodd"/></mask><g mask="url(#a)"><path fill="#0065A9" d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.17 4.17 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63"/><g filter="url(#b)"><path fill="#007ACC" d="m96.461 89.204-20.604 9.92a6.23 6.23 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.17 4.17 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63"/></g><g filter="url(#c)"><path fill="#1F9CF0" d="M75.858 99.126a6.23 6.23 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.23 6.23 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633z"/></g><path fill="url(#d)" fill-rule="evenodd" d="M70.851 99.317a6.22 6.22 0 0 0 4.96-.19L96.4 89.22a6.25 6.25 0 0 0 3.54-5.633V16.413a6.25 6.25 0 0 0-3.54-5.632L75.812.874a6.23 6.23 0 0 0-7.104 1.21L29.294 38.04 12.126 25.01a4.16 4.16 0 0 0-5.317.236l-5.507 5.009a4.17 4.17 0 0 0-.004 6.162L16.186 50 1.298 63.583a4.17 4.17 0 0 0 .004 6.162l5.507 5.009a4.16 4.16 0 0 0 5.317.236l17.168-13.03 39.414 35.958a6.2 6.2 0 0 0 2.143 1.4M74.954 27.3 45.048 50l29.906 22.701z" clip-rule="evenodd" opacity=".25" style="mix-blend-mode:overlay"/></g><defs><filter id="b" width="116.727" height="92.246" x="-8.394" y="15.829" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset/><feGaussianBlur stdDeviation="4.167"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/><feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow"/><feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape"/></filter><filter id="c" width="47.917" height="116.151" x="60.417" y="-8.076" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset/><feGaussianBlur stdDeviation="4.167"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/><feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow"/><feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape"/></filter><linearGradient id="d" x1="49.939" x2="49.939" y1=".258" y2="99.742" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs></svg>`,
  },
  'code-oss': {
    className: 'editor-btn-codeoss',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3.5" y="2.5" width="17" height="19" rx="3.5"/>
      <line x1="8.5" y1="2.5" x2="8.5" y2="21.5"/>
      <line x1="12" y1="6.5" x2="17" y2="6.5"/>
      <line x1="14" y1="10" x2="18.5" y2="10"/>
      <line x1="14" y1="13.5" x2="18.5" y2="13.5"/>
      <line x1="14" y1="17" x2="18.5" y2="17"/>
      <line x1="12" y1="20.5" x2="17" y2="20.5"/>
    </svg>`,
  },
  zed: {
    className: 'editor-btn-zed',
    icon: `<svg viewBox="0 0 512 512" width="16" height="16"><path d="M48 32c-8.8 0-16 7.2-16 16v352H0V48C0 21.5 21.5 0 48 0h428.7c21.4 0 32.1 25.9 17 41l-264 264H304v-33h32v41c0 13.3-10.7 24-24 24H197.6l-55 55H392V192h32v200c0 17.7-14.3 32-32 32H110.6l-56 56H464c8.8 0 16-7.2 16-16V112h32v352c0 26.5-21.5 48-48 48H35.3c-21.4 0-32.1-25.9-17-41l263-263H208v32h-32v-40c0-13.3 10.7-24 24-24h113.4l56-56H120v200H88V120c0-17.7 14.3-32 32-32h281.4l56-56z" style="fill-rule:evenodd;clip-rule:evenodd;fill:#ffffff"/></svg>`,
  },
  cursor: {
    className: 'editor-btn-cursor',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.726V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/>
    </svg>`,
  },
  codium: {
    className: 'editor-btn-codium',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M11.583.54a1.467 1.467 0 0 0-.441 2.032c2.426 3.758 2.999 6.592 2.75 9.075-1.004 4.756-3.187 5.721-5.094 5.721-1.863 0-1.364-3.065.036-3.962.836-.522 1.906-.861 2.728-.861.814 0 1.474-.658 1.474-1.47 0-.812-.66-1.47-1.474-1.47-.96 0-1.901.202-2.78.545.18-.847.246-1.762.014-2.735-.352-1.477-1.367-2.889-3.128-4.257a1.476 1.476 0 0 0-2.069.256c-.5.64-.384 1.564.259 2.063 1.435 1.114 1.908 1.939 2.07 2.618.162.679.032 1.407-.293 2.408-.416 1.349-.9 2.553-1.11 3.708-.105.568-.114 1.187-.14 1.68-1.034-1.006-1.438-2.336-1.438-4.279 0-.811-.66-1.47-1.474-1.47-.814.001-1.473.659-1.473 1.47 0 2.654.776 5.179 2.855 6.863 1.883 1.793 6.67 1.13 6.67 4.01 0 .812 1.19 1.208 2.004 1.208.834 0 1.885-.558 1.885-1.208 0-3.267 3.443-5.253 9.11-5.244A1.472 1.472 0 0 0 24 15.773 1.472 1.472 0 0 0 22.53 14.3c-.388 0-.765.013-1.138.035.634-1.49.915-3.13.857-4.903a1.473 1.473 0 0 0-1.522-1.42 1.472 1.472 0 0 0-1.425 1.517c.076 2.32-.01 4.393-1.74 5.485-.49.31-1.062.58-1.604.58.42-1.145.738-2.353.869-3.655.083-.83.091-1.818-.003-2.585-.148-1.188-.325-2.535.126-3.55.405-.874 1.313-1.24 2.645-1.24.814 0 1.473-.659 1.473-1.47 0-.811-.659-1.47-1.473-1.47-1.98 0-3.481 1.042-4.332 2.3-.445-.95-.987-1.929-1.642-2.943a1.474 1.474 0 0 0-2.037-.44z"/>
    </svg>`,
  },
};

async function checkAndRenderInstalledEditors() {
  if (!invoke || !els.editorActions) return;
  els.editorActions.style.display = 'none';
  els.editorActions.innerHTML = '';
  try {
    const editors = await invoke('detect_installed_editors');
    if (!editors || editors.length === 0) return;

    els.editorActions.innerHTML = editors.map((editor) => {
      const cfg = EDITOR_CONFIGS[editor.id] || {
        className: '',
        icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
      };

      return `
        <button class="editor-btn ${cfg.className}" type="button" data-editor-id="${escapeHtml(editor.id)}" title="Open in ${escapeHtml(editor.name)}">
          ${cfg.icon}
          <span>Open in ${escapeHtml(editor.name)}</span>
        </button>
      `;
    }).join('');

    els.editorActions.querySelectorAll('.editor-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.editorId;
        try {
          setStatus(`Opening in ${id}...`);
          await invoke('open_in_editor', { editorId: id });
          setStatus(`Opened repository in ${id}`);
        } catch (err) {
          setStatus(`Failed to open editor: ${err}`);
          alert(`Error launching ${id}: ${err}`);
        }
      });
    });

    els.editorActions.style.display = 'flex';
  } catch (err) {
    console.error('Failed to detect editors:', err);
  }
}

// ─── Git Remote Management ───────────────────────────────────────────────────

async function loadGitRemotes() {
  if (!invoke || !els.selectActiveRemote) return;
  try {
    const remotes = await invoke('get_git_remotes');
    state.remotes = remotes;
    if (els.remotesCount) els.remotesCount.textContent = remotes.length;

    if (remotes.length === 0) {
      els.selectActiveRemote.innerHTML = '<option value="">No remotes configured</option>';
      return;
    }

    if (!state.activeRemote || !remotes.some((r) => r.name === state.activeRemote)) {
      state.activeRemote = remotes.some((r) => r.name === 'origin') ? 'origin' : remotes[0].name;
    }

    els.selectActiveRemote.innerHTML = remotes.map((r) => `
      <option value="${escapeHtml(r.name)}" ${r.name === state.activeRemote ? 'selected' : ''}>
        ${escapeHtml(r.name)} (${escapeHtml(r.url.slice(0, 26))}${r.url.length > 26 ? '...' : ''})
      </option>
    `).join('');

    updateActiveRemoteContext();
  } catch (err) {
    console.error('Failed to load remotes:', err);
  }
}

function updateActiveRemoteContext() {
  const active = state.remotes.find((r) => r.name === state.activeRemote);
  if (active && active.isGithub && active.githubOwner && active.githubRepo && state.repoInfo) {
    state.repoInfo.github_owner = active.githubOwner;
    state.repoInfo.github_repo = active.githubRepo;
  }
  showGhNavIfGitHub();
}

async function switchActiveRemote(remoteName) {
  state.activeRemote = remoteName;
  updateActiveRemoteContext();
  setStatus(`Switched remote to ${remoteName}`);
  await refreshRepositoryData();
  if (state.ghPanel === 'issues') loadGhIssues();
  if (state.ghPanel === 'prs') loadGhPrs();
  if (state.ghPanel === 'actions') loadGhActions();
}

async function fetchActiveRemote() {
  const remoteName = state.activeRemote || 'origin';
  try {
    setStatus(`Fetching from remote ${remoteName}...`);
    const res = await invoke('fetch_remote', { remoteName });
    setStatus(`Fetched from ${remoteName} successfully!`);
    await refreshRepositoryData();
    await loadGitRemotes();
  } catch (err) {
    setStatus(`Fetch from ${remoteName} failed`);
    alert(`Fetch error: ${err}`);
  }
}




function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function checkAppUpdate() {
  if (!els.btnCheckUpdate) return;
  els.btnCheckUpdate.disabled = true;
  els.btnCheckUpdate.innerHTML = `
    <div class="spinner" style="width:12px;height:12px;border:2px solid var(--line);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;margin-right:6px;"></div>
    <span>Checking...</span>`;

  els.updateStatusBox.style.display = 'block';
  els.updateStatusInfo.innerHTML = '<span style="color:var(--text-dim);"><div class="action-log-loading" style="padding:10px;"><div class="spinner"></div> Checking github.com/noirlang/differ releases...</div></span>';
  els.updateNotesBox.style.display = 'none';
  els.updateAssetsBox.style.display = 'none';

  try {
    const update = await invoke('check_app_update');
    els.btnCheckUpdate.disabled = false;
    els.btnCheckUpdate.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;">
        <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"></path>
        <path d="M3 21v-5h5"></path>
        <path d="M3 12A9 9 0 0 1 18.5 5.7L21 8"></path>
        <path d="M21 3v5h-5"></path>
      </svg>
      <span>Check for Updates</span>`;

    if (els.settingsAppVersion) {
      els.settingsAppVersion.textContent = `v${update.currentVersion}`;
    }

    if (update.hasUpdate) {
      els.updateStatusInfo.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <span class="update-badge available">🎉 New Update Available!</span>
            <div style="margin-top:6px;font-size:13px;font-weight:600;color:var(--text);">
              ${escapeHtml(update.releaseName || update.tagName)} (<span style="color:#3fb950;">v${escapeHtml(update.latestVersion)}</span>)
            </div>
            <small style="color:var(--text-dim);">Published: ${formatRelativeDate(update.publishedAt)}</small>
          </div>
          <button class="mini-btn primary" type="button" data-url="${escapeHtml(update.htmlUrl)}">
            Open Release on GitHub
          </button>
        </div>`;

      els.updateStatusInfo.querySelector('button[data-url]')?.addEventListener('click', (e) => {
        openUrl(e.target.closest('button').dataset.url);
      });

      if (update.releaseNotes) {
        els.updateNotesContent.textContent = update.releaseNotes;
        els.updateNotesBox.style.display = 'block';
      }

      if (update.assets && update.assets.length > 0) {
        els.updateAssetsList.innerHTML = update.assets.map((asset) => `
          <div class="update-asset-item">
            <span class="update-asset-name">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              ${escapeHtml(asset.name)}
            </span>
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="update-asset-size">${formatBytes(asset.size)}</span>
              <button class="mini-btn primary" type="button" data-url="${escapeHtml(asset.downloadUrl)}">
                Download Package
              </button>
            </div>
          </div>
        `).join('');

        els.updateAssetsList.querySelectorAll('button[data-url]').forEach((btn) => {
          btn.addEventListener('click', () => openUrl(btn.dataset.url));
        });

        els.updateAssetsBox.style.display = 'block';
      }
    } else {
      els.updateStatusInfo.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="update-badge latest">✓ Up to Date</span>
          <span style="font-size:12px;color:var(--text-muted);">
            You are running the latest version (<strong>v${escapeHtml(update.currentVersion)}</strong>).
          </span>
        </div>`;
    }
  } catch (err) {
    els.btnCheckUpdate.disabled = false;
    els.btnCheckUpdate.innerHTML = `<span>Check for Updates</span>`;
    els.updateStatusInfo.innerHTML = `
      <div style="color:#f85149;font-size:12px;">
        Failed to check updates: ${escapeHtml(String(err))}
      </div>`;
  }
}

// ─── PR Detail Modal Functions ───────────────────────────────────────────────

let currentModalPr = null;

function activatePrTab(tabName) {
  if (els.btnPrTabDiff) els.btnPrTabDiff.classList.toggle('active', tabName === 'diff');
  if (els.btnPrTabCommits) els.btnPrTabCommits.classList.toggle('active', tabName === 'commits');
  if (els.btnPrTabBody) els.btnPrTabBody.classList.toggle('active', tabName === 'body');

  if (els.prPanelDiff) els.prPanelDiff.style.display = tabName === 'diff' ? 'block' : 'none';
  if (els.prPanelCommits) els.prPanelCommits.style.display = tabName === 'commits' ? 'block' : 'none';
  if (els.prPanelBody) els.prPanelBody.style.display = tabName === 'body' ? 'block' : 'none';
}

async function openPrModal(pr) {
  currentModalPr = pr;
  if (els.prModalNumber) els.prModalNumber.textContent = pr.number;
  if (els.prDetailTitle) els.prDetailTitle.textContent = pr.title;
  if (els.prModalAuthor) els.prModalAuthor.textContent = `@${pr.author}`;
  if (els.prModalBranches) {
    els.prModalBranches.textContent = pr.headRef || pr.head_ref
      ? `${pr.headRef || pr.head_ref} → ${pr.baseRef || pr.base_ref}`
      : '';
  }

  let stateClass = pr.state || 'open';
  if (pr.isDraft || pr.is_draft) stateClass = 'draft';
  if (pr.state === 'merged') stateClass = 'merged';
  if (els.prModalStatusDot) els.prModalStatusDot.className = `gh-status-dot ${stateClass}`;

  if (els.prBodyContent) els.prBodyContent.textContent = pr.body || 'No description provided.';
  if (els.btnOpenPrBrowser) els.btnOpenPrBrowser.onclick = () => openUrl(pr.url);

  // Show/hide merge button
  const isOpen = pr.state === 'open';
  if (els.btnConfirmPrMerge) els.btnConfirmPrMerge.style.display = isOpen ? 'inline-flex' : 'none';
  if (els.prMergeMethod) els.prMergeMethod.style.display = isOpen ? 'inline-block' : 'none';

  activatePrTab('diff');
  if (els.prDetailModal) els.prDetailModal.hidden = false;

  // Fetch PR Diff
  if (els.prDiffLoading) els.prDiffLoading.style.display = 'flex';
  if (els.prDiffContent) els.prDiffContent.textContent = '';
  try {
    const diff = await invoke('get_pr_diff', { prNumber: pr.number });
    if (els.prDiffContent) els.prDiffContent.textContent = diff || 'No diff available.';
  } catch (err) {
    if (els.prDiffContent) els.prDiffContent.textContent = `Error loading PR diff: ${err}`;
  } finally {
    if (els.prDiffLoading) els.prDiffLoading.style.display = 'none';
  }

  // Fetch PR Commits
  if (els.prCommitsLoading) els.prCommitsLoading.style.display = 'flex';
  if (els.prCommitsList) els.prCommitsList.innerHTML = '';
  try {
    const commits = await invoke('get_pr_commits', { prNumber: pr.number });
    if (els.prCommitsCount) els.prCommitsCount.textContent = commits.length;
    if (els.prCommitsList) {
      if (commits.length === 0) {
        els.prCommitsList.innerHTML = '<div class="gh-empty-state">No commits found in PR.</div>';
      } else {
        els.prCommitsList.innerHTML = commits.map((c) => `
          <div class="pr-commit-item">
            <div>
              <div class="pr-commit-msg">${escapeHtml(c.messageHeadline)}</div>
              <small style="color:var(--text-dim);">by ${escapeHtml(c.authorName || c.authors?.join(', ') || 'Unknown')}</small>
            </div>
            <span class="pr-commit-hash">${escapeHtml((c.oid || '').slice(0, 7))}</span>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    if (els.prCommitsList) els.prCommitsList.innerHTML = `<div class="gh-not-auth">Failed to load PR commits: ${escapeHtml(String(err))}</div>`;
  } finally {
    if (els.prCommitsLoading) els.prCommitsLoading.style.display = 'none';
  }
}

function closePrModal() {
  if (els.prDetailModal) els.prDetailModal.hidden = true;
  currentModalPr = null;
}

async function confirmPrMerge() {
  if (!currentModalPr) return;
  const prNumber = currentModalPr.number;
  const method = els.prMergeMethod?.value || 'merge';

  if (!confirm(`Are you sure you want to merge PR #${prNumber} using ${method} method?`)) return;

  if (els.btnConfirmPrMerge) {
    els.btnConfirmPrMerge.disabled = true;
    els.btnConfirmPrMerge.textContent = 'Merging...';
  }

  try {
    setStatus(`Merging PR #${prNumber}...`);
    const res = await invoke('merge_github_pr', { prNumber, mergeMethod: method });
    setStatus(`PR #${prNumber} merged successfully!`);
    alert(`PR #${prNumber} merged successfully!\n${res}`);
    closePrModal();
    loadGhPrs();
  } catch (err) {
    setStatus(`Failed to merge PR #${prNumber}`);
    alert(`Merge failed: ${err}`);
  } finally {
    if (els.btnConfirmPrMerge) {
      els.btnConfirmPrMerge.disabled = false;
      els.btnConfirmPrMerge.textContent = 'Merge Pull Request';
    }
  }
}



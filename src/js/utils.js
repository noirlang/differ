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

  if (minutes < 1) return 'az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  if (hours < 24) return `${hours} sa önce`;
  if (days < 7) return `${days} gün önce`;

  return date.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatFullDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function firstLine(message) {
  return (message || '(commit mesajı yok)').split('\n')[0];
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
    button.setAttribute('aria-label', `${getRepoDisplayName(repoPath)} deposunu aç`);

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

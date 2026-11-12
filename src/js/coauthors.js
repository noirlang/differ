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

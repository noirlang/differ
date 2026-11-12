function renderTeam() {
  const authors = getAuthorStats();

  if (authors.length === 0) {
    els.teamList.innerHTML = '<div class="muted-row">Henüz commit yok</div>';
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
    els.contributorsPodium.innerHTML = '<div class="muted-row">Henüz katkıda bulunan yok</div>';
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

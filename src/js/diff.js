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
    <span>${stats.files} dosya</span>
    <span class="positive">+${stats.additions}</span>
    <span class="negative">-${stats.deletions}</span>
  `;

  if (state.diffData.length === 0) {
    els.changedFiles.innerHTML = '';
    els.diffContainer.innerHTML = `
      <div class="empty-state compact">
        <strong>Değişiklik yok</strong>
        <span>Bu commit için diff içeriği bulunamadı.</span>
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
        ${hunks || '<div class="diff-placeholder">Dosya değişti fakat gösterilecek satır yok.</div>'}
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
    : '<div class="muted-row">Dosya ağacı boş</div>';
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
        ? `<a class="description-coauthor-github-link" href="https://github.com/${encodeURIComponent(co.githubUsername)}" target="_blank" rel="noopener noreferrer" title="GitHub'da İncele">
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
          Ortak Yazarlar
        </h3>
        <div class="description-coauthors-list">
          ${coauthorCards}
        </div>
      </div>
    `;
  }

  els.commitDescriptionView.innerHTML = `
    <div class="description-header">${escapeHtml(subject)}</div>
    ${cleanBody ? `<div class="description-body">${escapeHtml(cleanBody)}</div>` : '<div class="description-body italic text-dim">Commit açıklaması bulunmuyor.</div>'}
    ${coauthorsHtml}
  `;

  hydrateAvatarFallbacks(els.commitDescriptionView);
}

/* ==================================
   Co-Authors feature logic
   ================================== */

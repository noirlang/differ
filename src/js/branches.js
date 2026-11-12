function currentHeadBranch() {
  return state.syncStatus?.current_branch || state.repoInfo?.current_branch || '';
}

function isMainlineBranch(name) {
  return name === 'main' || name === 'master';
}

function unmergedSourceBranch() {
  // The branch whose unmerged work we inspect: the viewed branch, or HEAD.
  return state.selectedBranch || currentHeadBranch();
}

function listUnmergedCandidates() {
  // Targets must be local branches (merge/cherry-pick checks the target out).
  const source = unmergedSourceBranch();
  return state.branches.filter((b) => (
    b.name && !b.is_remote && !b.is_tag && b.name !== 'detached' && b.name !== source
  ));
}

function pickUnmergedTarget() {
  const candidates = listUnmergedCandidates();
  if (candidates.length === 0) return null;

  if (state.unmergedTarget && candidates.some((b) => b.name === state.unmergedTarget)) {
    return state.unmergedTarget;
  }

  const preferred = candidates.find((b) => b.name === 'main' || b.name === 'master');
  if (preferred) return preferred.name;
  return candidates[0].name;
}

async function loadUnmergedCommits() {
  if (!els.unmergedBanner) return;

  const source = unmergedSourceBranch();

  // The banner only makes sense on a feature branch: on main/master (or a
  // detached HEAD) there is nothing "waiting to be merged" to show.
  if (!source || source === 'detached' || isMainlineBranch(source)) {
    state.unmergedCommits = [];
    state.unmergedTarget = null;
    state.unmergedManual = false;
    renderUnmergedBanner();
    return;
  }

  const target = pickUnmergedTarget();
  state.unmergedTarget = target;

  if (!target) {
    state.unmergedCommits = [];
    renderUnmergedBanner();
    return;
  }

  try {
    state.unmergedCommits = await invoke('get_unmerged_commits', {
      targetBranch: target,
      sourceBranch: state.selectedBranch || null,
    });
  } catch (err) {
    console.error('Unmerged commits could not be loaded:', err);
    state.unmergedCommits = [];
  }

  renderUnmergedBanner();
}

function renderUnmergedBanner() {
  if (!els.unmergedBanner) return;

  const commits = state.unmergedCommits;
  const target = state.unmergedTarget;
  const source = unmergedSourceBranch();

  if (!target || !source || source === 'detached' || isMainlineBranch(source)
      || (commits.length === 0 && !state.unmergedManual)) {
    els.unmergedBanner.style.display = 'none';
    return;
  }

  els.unmergedBanner.style.display = 'flex';
  els.unmergedBannerCount.textContent = commits.length;
  if (els.unmergedBannerSource) {
    els.unmergedBannerSource.textContent = source;
  }

  if (els.unmergedTargetSelect) {
    const candidates = listUnmergedCandidates();
    els.unmergedTargetSelect.innerHTML = candidates.map((b) => `
      <option value="${escapeHtml(b.name)}" ${b.name === target ? 'selected' : ''}>${escapeHtml(b.name)}</option>
    `).join('');
  }

  if (commits.length === 0) {
    els.unmergedCommitList.innerHTML = `
      <div class="muted-row" style="padding: 8px 10px; font-size: 11px; color: var(--text-dim);">
        ${escapeHtml(source)} dalı ${escapeHtml(target)} dalına tamamen birleştirildi.
      </div>`;
    if (els.btnUnmergedMergeAll) els.btnUnmergedMergeAll.disabled = true;
    return;
  }

  if (els.btnUnmergedMergeAll) els.btnUnmergedMergeAll.disabled = false;

  els.unmergedCommitList.innerHTML = commits.map((c) => `
    <div class="unmerged-commit-card" data-commit-id="${c.id}">
      <div class="unpushed-commit-info">
        <span class="unpushed-hash">${escapeHtml(c.short_id)}</span>
        <span class="unpushed-msg" title="${escapeHtml(firstLine(c.message))}">${escapeHtml(firstLine(c.message))}</span>
      </div>
      <div class="unpushed-meta">
        <span>${escapeHtml(c.author_name || 'Bilinmiyor')}</span>
        <span>&bull; ${formatDate(c.timestamp)}</span>
        <span class="commit-state-label unmerged-badge">BİRLEŞTİRİLMEDİ</span>
        <button class="cherry-pick-btn" type="button" data-commit-id="${c.id}" title="Bu commit'i ${escapeHtml(target)} dalına cherry-pick yap">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="18" r="3"></circle>
            <circle cx="6" cy="6" r="3"></circle>
            <path d="M6 21V9a9 9 0 0 0 9 9"></path>
          </svg>
          <span>Cherry-pick</span>
        </button>
      </div>
    </div>
  `).join('');

  els.unmergedCommitList.querySelectorAll('.cherry-pick-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cherryPickCommit(btn.dataset.commitId, btn);
    });
  });
}

async function followMergedBranch(target) {
  // merge/cherry-pick checks out the target branch in the backend;
  // re-open the repo so the UI follows the new active branch (e.g. main).
  try {
    if (state.repoInfo?.path) {
      state.repoInfo = await invoke('open_repo', { path: state.repoInfo.path });
    }
  } catch (repoErr) {
    console.warn('Could not refresh repo info after merge:', repoErr);
  }
  state.selectedBranch = null;
  state.selectedCommit = null;
  state.unmergedTarget = null;
  state.unmergedManual = false;

  await refreshRepositoryData({ selectLatest: true });
}

async function offerPush(target) {
  const remoteName = state.activeRemote || 'origin';
  const canPush = state.syncStatus?.can_push && state.syncStatus?.has_origin;
  if (canPush && confirm(`${target} dalını şimdi ${remoteName} uzak deposuna göndermek (push) ister misiniz?`)) {
    await pushOrigin();
  }
}

async function cherryPickCommit(commitId, btn) {
  if (!commitId) return;

  const target = state.unmergedTarget;
  if (!target) return;

  const commit = state.unmergedCommits.find((c) => c.id === commitId);
  const label = commit ? `${commit.short_id} — ${firstLine(commit.message)}` : commitId;

  if (!confirm(`Bu commit ${target} dalına cherry-pick yapılsın mı?\n\n${label}`)) return;

  try {
    if (btn) {
      btn.disabled = true;
      btn.classList.add('is-loading');
    }
    setStatus(`${commitId.substring(0, 7)} commit'i ${target} dalına cherry-pick ediliyor...`);

    const res = await invoke('cherry_pick_commit', { commitId, targetBranch: target });

    if (typeof res === 'string' && res.includes('already applied')) {
      setStatus(res);
    } else {
      setStatus(`${commitId.substring(0, 7)} commit'i ${target} dalına başarıyla cherry-pick edildi`);
    }
    await followMergedBranch(target);
    await offerPush(target);
  } catch (err) {
    console.error(err);
    setStatus('Cherry-pick başarısız oldu');
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
    await handleOpFailure('cherry-pick', target, target, `incoming commit ${commitId.substring(0, 7)}`, err);
  }
}

async function refreshBranchesFromOrigin() {
  const btn = els.btnRefreshBranches;
  if (btn) {
    btn.disabled = true;
    btn.classList.add('spinning');
  }

  const remoteName = state.activeRemote || 'origin';
  const hasRemote = Array.isArray(state.remotes) && state.remotes.length > 0;
  let fetched = false;

  try {
    if (hasRemote) {
      await invoke('fetch_remote', { remoteName });
      fetched = true;
    }
  } catch (err) {
    console.warn(`Fetch from ${remoteName} failed, reloading local branches only:`, err);
  }

  try {
    state.branches = await invoke('get_branches');
    renderBranches();
    await loadUnmergedCommits();
    setStatus(fetched ? `Dallar ${remoteName} uzak deposundan getirildi` : 'Dallar yenilendi');
  } catch (err) {
    console.error(err);
    setStatus('Dallar yenilenemedi');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('spinning');
    }
  }
}

function renderBranches() {
  const currentBranchName = state.selectedBranch || state.repoInfo?.current_branch || 'Tüm Geçmiş';
  if (els.activeBranch) els.activeBranch.textContent = currentBranchName;
  if (els.branchCount) els.branchCount.textContent = state.branches.length;

  if (!els.topBranchList) return;

  const branchRows = [
    `<button class="dropdown-menu-item ${!state.selectedBranch ? 'active' : ''}" type="button" data-branch="">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16"></path><path d="M4 6h16"></path><path d="M4 18h16"></path></svg>
      <span class="item-title">Tüm Geçmiş</span>
      <span class="item-badge local">tümü</span>
    </button>`,
  ];

  for (const branch of state.branches) {
    const active = state.selectedBranch === branch.name || (!state.selectedBranch && branch.is_head);
    let badgeClass = 'local';
    let badgeLabel = 'yerel';
    let itemIcon = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 3v12"></path>
        <circle cx="6" cy="18" r="3"></circle>
        <circle cx="18" cy="6" r="3"></circle>
        <path d="M18 9a9 9 0 0 1-9 9"></path>
      </svg>
    `;

    if (branch.is_head) {
      badgeClass = 'head';
      badgeLabel = 'HEAD';
    } else if (branch.is_tag) {
      badgeClass = 'tag';
      badgeLabel = 'etiket';
      itemIcon = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
          <line x1="7" y1="7" x2="7.01" y2="7"></line>
        </svg>
      `;
    } else if (branch.is_remote) {
      badgeClass = 'remote';
      badgeLabel = 'uzak';
      itemIcon = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
        </svg>
      `;
    }

    const branchDisplayName = escapeHtml(branch.name);

    branchRows.push(`
      <button class="dropdown-menu-item ${active ? 'active' : ''}" type="button" data-branch="${escapeHtml(branch.name)}">
        ${itemIcon}
        <span class="item-title">${branchDisplayName}</span>
        <span class="item-badge ${badgeClass}">${badgeLabel}</span>
      </button>
    `);
  }

  els.topBranchList.innerHTML = branchRows.join('');

  els.topBranchList.querySelectorAll('.dropdown-menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const branch = item.dataset.branch || null;
      closeAllDropdowns();
      loadCommits(branch);
    });
  });
}

async function pushOrigin() {
  try {
    els.btnPushOrigin.disabled = true;
    els.topPushBtn.disabled = true;
    const rName = state.activeRemote || 'origin';
    setStatus(`${rName} deposuna gönderiliyor (push)...`);
    await invoke('push_origin', { targetRemote: rName });
    await refreshRepositoryData();
    setStatus(`${rName} deposuna başarıyla gönderildi`);
  } catch (err) {
    console.error(err);
    setStatus('Gönderim (push) başarısız oldu');
    alert(`Gönderim (push) başarısız oldu: ${err}`);
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
    alert('Lütfen geçerli bir uzak depo URL\'si girin.');
    els.remoteUrlInput.focus();
    return;
  }

  try {
    els.btnSaveOrigin.disabled = true;
    els.btnSaveOrigin.textContent = 'Kaydediliyor...';
    setStatus('origin uzak deposu ekleniyor...');

    await invoke('add_origin', { url });

    els.remoteUrlInput.value = '';
    els.addOriginForm.style.display = 'none';
    setStatus('origin uzak deposu başarıyla eklendi');

    await loadSyncStatus();
  } catch (err) {
    console.error(err);
    setStatus('origin uzak deposu eklenemedi');
    alert(`origin uzak deposu eklenemedi: ${err}`);
  } finally {
    els.btnSaveOrigin.disabled = false;
    els.btnSaveOrigin.textContent = 'Uzak Depoyu Kaydet';
  }
}

// ─── Git Remote Management & Dropdown Controls ──────────────────────────────

function closeAllDropdowns() {
  if (els.branchDropdownMenu) els.branchDropdownMenu.style.display = 'none';
  if (els.remoteDropdownMenu) els.remoteDropdownMenu.style.display = 'none';
  els.topBranchPill?.classList.remove('is-open');
  els.topSyncPill?.classList.remove('is-open');
  hideTopAddRemoteForm();
}

function toggleBranchDropdown() {
  const isHidden = !els.branchDropdownMenu || els.branchDropdownMenu.style.display === 'none';
  closeAllDropdowns();
  if (isHidden && els.branchDropdownMenu) {
    els.branchDropdownMenu.style.display = 'flex';
    els.topBranchPill?.classList.add('is-open');
  }
}

function toggleRemoteDropdown() {
  const isHidden = !els.remoteDropdownMenu || els.remoteDropdownMenu.style.display === 'none';
  closeAllDropdowns();
  if (isHidden && els.remoteDropdownMenu) {
    els.remoteDropdownMenu.style.display = 'flex';
    els.topSyncPill?.classList.add('is-open');
  }
}

function toggleTopAddRemoteForm() {
  if (!els.topAddRemoteForm) return;
  const isHidden = els.topAddRemoteForm.style.display === 'none';
  if (isHidden) {
    els.topAddRemoteForm.style.display = 'flex';
    if (els.topRemoteNameInput) {
      els.topRemoteNameInput.value = '';
      els.topRemoteNameInput.focus();
    }
    if (els.topRemoteUrlInput) {
      els.topRemoteUrlInput.value = '';
    }
  } else {
    hideTopAddRemoteForm();
  }
}

function hideTopAddRemoteForm() {
  if (els.topAddRemoteForm) els.topAddRemoteForm.style.display = 'none';
  if (els.topRemoteNameInput) els.topRemoteNameInput.value = '';
  if (els.topRemoteUrlInput) els.topRemoteUrlInput.value = '';
}

async function saveTopRemote() {
  const name = (els.topRemoteNameInput?.value || 'origin').trim();
  const url = (els.topRemoteUrlInput?.value || '').trim();

  if (!url) {
    alert('Lütfen geçerli bir uzak depo URL\'si girin.');
    els.topRemoteUrlInput?.focus();
    return;
  }

  try {
    if (els.btnSaveTopRemote) {
      els.btnSaveTopRemote.disabled = true;
      els.btnSaveTopRemote.textContent = 'Kaydediliyor...';
    }
    setStatus(`${name} uzak deposu ekleniyor...`);

    await invoke('add_git_remote', { name, url });

    hideTopAddRemoteForm();
    setStatus(`'${name}' uzak deposu başarıyla eklendi!`);
    await loadGitRemotes();
    await switchActiveRemote(name);
  } catch (err) {
    console.error(err);
    setStatus('Uzak depo eklenemedi');
    alert(`Uzak depo eklenemedi: ${err}`);
  } finally {
    if (els.btnSaveTopRemote) {
      els.btnSaveTopRemote.disabled = false;
      els.btnSaveTopRemote.textContent = 'Kaydet';
    }
  }
}

async function loadGitRemotes() {
  if (!invoke) return;
  try {
    const remotes = await invoke('get_git_remotes');
    state.remotes = remotes || [];
    if (els.remotesCount) els.remotesCount.textContent = state.remotes.length;

    if (state.remotes.length === 0) {
      state.activeRemote = null;
    } else if (!state.activeRemote || !state.remotes.some((r) => r.name === state.activeRemote)) {
      state.activeRemote = state.remotes.some((r) => r.name === 'origin') ? 'origin' : state.remotes[0].name;
    }

    renderTopRemoteDropdown();
    updateActiveRemoteContext();
  } catch (err) {
    console.error('Failed to load remotes:', err);
  }
}

function renderTopRemoteDropdown() {
  if (!els.topRemoteList) return;

  if (!state.remotes || state.remotes.length === 0) {
    els.topRemoteList.innerHTML = '<div class="muted-row" style="padding: 8px 10px; font-size: 11px; color: var(--text-dim);">Yapılandırılmış uzak depo yok</div>';
    return;
  }

  els.topRemoteList.innerHTML = state.remotes.map((r) => `
    <button class="dropdown-menu-item ${r.name === state.activeRemote ? 'active' : ''}" type="button" data-remote="${escapeHtml(r.name)}">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span class="item-title">${escapeHtml(r.name)}</span>
      <span class="item-badge remote" style="max-width: 120px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(r.url)}</span>
    </button>
  `).join('');

  els.topRemoteList.querySelectorAll('.dropdown-menu-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const remoteName = item.dataset.remote;
      closeAllDropdowns();
      if (remoteName && remoteName !== state.activeRemote) {
        await switchActiveRemote(remoteName);
      }
    });
  });
}

function updateActiveRemoteContext() {
  const active = (state.remotes || []).find((r) => r.name === state.activeRemote);
  if (active && active.isGithub && active.githubOwner && active.githubRepo && state.repoInfo) {
    state.repoInfo.github_owner = active.githubOwner;
    state.repoInfo.github_repo = active.githubRepo;
  }
  showGhNavIfGitHub();
}

async function switchActiveRemote(remoteName) {
  state.activeRemote = remoteName;
  updateActiveRemoteContext();
  setStatus(`Uzak depo ${remoteName} olarak değiştirildi`);
  await refreshRepositoryData();
  if (state.ghPanel === 'issues') loadGhIssues();
  if (state.ghPanel === 'prs') loadGhPrs();
  if (state.ghPanel === 'actions') loadGhActions();
}

async function fetchActiveRemote() {
  const remoteName = state.activeRemote || 'origin';
  try {
    setStatus(`${remoteName} uzak deposundan getiriliyor (fetch)...`);
    const res = await invoke('fetch_remote', { remoteName });
    setStatus(`${remoteName} uzak deposundan başarıyla getirildi!`);
    await refreshRepositoryData();
    await loadGitRemotes();
  } catch (err) {
    setStatus(`${remoteName} uzak deposundan getirme başarısız oldu`);
    alert(`Getirme (fetch) hatası: ${err}`);
  }
}

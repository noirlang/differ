function initDetailToggle() {
  const toggleBtn = document.getElementById('btn-toggle-detail-panel');
  const mainContent = document.getElementById('main-content');
  const detailPanel = document.getElementById('commit-detail-panel');

  function updateToggleBtnState(isHidden) {
    if (toggleBtn) {
      if (isHidden) {
        toggleBtn.classList.add('is-closed');
        toggleBtn.title = 'Commit Detay Panelini Aç';
      } else {
        toggleBtn.classList.remove('is-closed');
        toggleBtn.title = 'Commit Detay Panelini Kapat';
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
  els.btnOpenRepo?.addEventListener('click', () => openRepo());
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
      setStatus(`Varsayılan yapay zeka modeli ${provider.toUpperCase()}: ${modelName} olarak ayarlandı`);
    });
  }

  const btnSaveOllama = document.getElementById('btn-save-ollama-default');
  if (btnSaveOllama) {
    btnSaveOllama.addEventListener('click', () => {
      appSettings.aiProvider = 'ollama';
      appSettings.selectedModel = els.settingAiModel?.value || 'gemma4:12b';
      saveAppSettings(appSettings);
      updateAiModelSelectOptions();
      setStatus(`Ollama (${appSettings.selectedModel}) varsayılan yapay zeka modeli olarak ayarlandı`);
      alert(`Ollama (${appSettings.selectedModel}) varsayılan yapay zeka modeli olarak kaydedildi.`);
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
      setStatus(`Gemini (${m}) varsayılan yapay zeka modeli olarak ayarlandı`);
      alert(`Gemini (${m}) varsayılan yapay zeka modeli olarak kaydedildi.`);
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
      setStatus(`LM Studio (${m}) varsayılan yapay zeka modeli olarak ayarlandı`);
      alert(`LM Studio (${m}) varsayılan yapay zeka modeli olarak kaydedildi.`);
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
  if (btnToggleKey && geminiKeyInput) {
    btnToggleKey.addEventListener('click', () => {
      const isPassword = geminiKeyInput.type === 'password';
      geminiKeyInput.type = isPassword ? 'text' : 'password';
      btnToggleKey.textContent = isPassword ? 'Gizle' : 'Göster';
    });
  }
  document.getElementById('btn-remove-gemini-key')?.addEventListener('click', removeGeminiApiKey);
  if (els.btnFetchGeminiModels) {
    els.btnFetchGeminiModels.addEventListener('click', fetchGeminiModels);
  }

  els.settingAiModel.addEventListener('change', (e) => {
    appSettings.selectedModel = e.target.value;
    if (currentSystemInfo) renderSystemInfo(currentSystemInfo);
  });

  els.btnRefreshStatus.addEventListener('click', async () => {
    try {
      setStatus('Durum yenileniyor...');
      await Promise.all([loadWorktreeStatus(), loadSyncStatus()]);
      setStatus('Durum yenilendi');
    } catch (err) {
      console.error(err);
      setStatus('Durum yenilenemedi');
    }
  });
  els.btnCommitSelected?.addEventListener('click', commitSelectedChanges);
  els.btnPushOrigin?.addEventListener('click', pushOrigin);
  els.btnFetchOrigin?.addEventListener('click', fetchActiveRemote);
  els.btnShowAddOrigin?.addEventListener('click', showAddOriginForm);
  els.btnCancelOrigin?.addEventListener('click', hideAddOriginForm);
  els.btnSaveOrigin?.addEventListener('click', saveRemoteOrigin);
  els.remoteUrlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveRemoteOrigin();
    }
  });

  // Topbar Branch & Remote dropdown listeners
  els.topBranchPill?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleBranchDropdown();
  });
  els.branchDropdownMenu?.addEventListener('click', (e) => e.stopPropagation());

  els.topSyncPill?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleRemoteDropdown();
  });
  els.remoteDropdownMenu?.addEventListener('click', (e) => e.stopPropagation());

  els.btnTopAddRemoteToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTopAddRemoteForm();
  });
  els.btnCancelTopRemote?.addEventListener('click', hideTopAddRemoteForm);
  els.btnSaveTopRemote?.addEventListener('click', saveTopRemote);
  els.topRemoteUrlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTopRemote();
    }
  });

  document.addEventListener('click', closeAllDropdowns);

  // Refresh shortly after the window regains focus (e.g. commit made in a
  // terminal while the app was in the background).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.repoInfo || !state.refreshTimer) return;
    if (Date.now() - state.lastAutoCheck < 10000) return;
    autoRefreshTick();
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

  els.btnKeepOurs?.addEventListener('click', () => resolveConflictChoice('ours'));
  els.btnKeepTheirs?.addEventListener('click', () => resolveConflictChoice('theirs'));
  els.btnAbortConflict?.addEventListener('click', abortConflictOp);
  els.btnCloseConflict?.addEventListener('click', () => {
    // Closing leaves the repo mid-merge; offer to abort so it is not stuck.
    if (state.activeConflict?.op
        && confirm(`Çözmeden kapatılsın mı? ${state.activeConflict.op} işlemi devam edecek.\n\nİşlemi (${state.activeConflict.op}) iptal etmek ister misiniz?`)) {
      abortConflictOp();
    } else {
      closeConflictModal();
    }
  });
  els.conflictModal?.addEventListener('click', (event) => {
    if (event.target === els.conflictModal) els.btnCloseConflict?.click();
  });

  els.coauthorInput.addEventListener('input', handleCoauthorInput);
  els.coauthorInput.addEventListener('keydown', handleCoauthorKeyDown);
  document.addEventListener('click', (event) => {
    if (!els.coauthorInput.contains(event.target) && !els.coauthorSuggestions.contains(event.target)) {
      renderCoauthorSuggestions([]);
      state.activeCoauthorSuggestionIndex = -1;
    }
  });

  els.searchInput.addEventListener('input', (event) => onSearchInput(event.target.value));
  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && els.searchInput.value) {
      event.stopPropagation();
      clearSearch();
    }
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

  // Branch dropdown refresh (fetch from origin) & Unmerged banner listeners
  els.btnRefreshBranches?.addEventListener('click', (e) => {
    e.stopPropagation();
    refreshBranchesFromOrigin();
  });
  els.unmergedTargetSelect?.addEventListener('change', (e) => {
    state.unmergedTarget = e.target.value || null;
    state.unmergedManual = !!state.unmergedTarget;
    loadUnmergedCommits();
  });
  els.btnUnmergedMergeAll?.addEventListener('click', () => {
    const source = unmergedSourceBranch();
    if (source && source !== 'detached' && state.unmergedTarget) {
      openMergeModal(source, state.unmergedTarget);
    }
  });

  // Application update check button
  els.btnCheckUpdate?.addEventListener('click', checkAppUpdate);

  // PR Detail Modal events
  els.btnClosePrDetail?.addEventListener('click', closePrModal);
  els.btnClosePrModalBottom?.addEventListener('click', closePrModal);
  els.prDetailModal?.addEventListener('click', (e) => {
    if (e.target === els.prDetailModal) closePrModal();
  });
  els.btnConfirmPrMerge?.addEventListener('click', confirmPrMerge);

  // Branch modal events
  els.btnNewBranch?.addEventListener('click', (e) => {
    e.stopPropagation();
    openBranchModal({ mode: 'create' });
  });
  els.btnCloseBranchModal?.addEventListener('click', closeBranchModal);
  els.btnCancelBranchModal?.addEventListener('click', closeBranchModal);
  els.btnConfirmBranchModal?.addEventListener('click', submitBranchModal);
  els.branchNameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBranchModal();
  });
  els.branchModal?.addEventListener('click', (e) => {
    if (e.target === els.branchModal) closeBranchModal();
  });

  // Create PR Modal events
  els.btnNewPr?.addEventListener('click', openCreatePrModal);
  els.btnCloseCreatePr?.addEventListener('click', closeCreatePrModal);
  els.btnCancelCreatePr?.addEventListener('click', closeCreatePrModal);
  els.btnConfirmCreatePr?.addEventListener('click', submitCreatePr);
  els.createPrHead?.addEventListener('change', prefillCreatePrTitle);
  els.createPrModal?.addEventListener('click', (e) => {
    if (e.target === els.createPrModal) closeCreatePrModal();
  });

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

    if (event.key === 'Escape') {
      closeAllDropdowns();
    }

    if (event.key === 'Escape' && !els.actionLogModal.hidden) {
      closeActionLogModal();
      return;
    }
    if (event.key === 'Escape' && !els.prDetailModal.hidden) {
      closePrModal();
      return;
    }
    if (event.key === 'Escape' && els.branchModal && !els.branchModal.hidden) {
      closeBranchModal();
      return;
    }
    if (event.key === 'Escape' && els.createPrModal && !els.createPrModal.hidden) {
      closeCreatePrModal();
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

  const recent = readRecentRepos();
  if (recent.length > 0) {
    openRepo(recent[0]);
  }

  // Move any legacy plaintext secrets into the OS keychain, then
  // auto-fetch Gemini models if a key is stored.
  await migrateLegacySecrets();
  if (secretStatus.geminiApiKey) {
    fetchGeminiModels();
  }
  // Auto-fetch LM Studio models
  checkLmStudioStatus();
});

// ─── GitHub Functions ──────────────────────────────────────────────────────────

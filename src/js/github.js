function formatRelativeDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} gün önce`;
  return d.toLocaleDateString('tr-TR');
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

  els.issuesList.innerHTML = '<div class="gh-empty-state"><div class="action-log-loading"><div class="spinner"></div><span>Sorunlar yükleniyor...</span></div></div>';

  if (!state.ghAuthenticated) {
    const authed = await checkGhAuth();
    if (!authed) {
      renderGhNotAuth(els.issuesList);
      return;
    }
  }

  try {
    setStatus('GitHub Sorunları yükleniyor...');
    const issues = await invoke('get_github_issues', { filter: f, limit: 50 });
    state.ghIssues = issues;
    renderIssues(issues);
    // Update count badge
    const openCount = issues.filter((i) => i.state === 'open').length;
    if (openCount > 0) {
      els.ghIssuesCount.textContent = openCount;
      els.ghIssuesCount.style.display = 'inline-flex';
    }
    setStatus(`${issues.length} sorun yüklendi`);
  } catch (err) {
    els.issuesList.innerHTML = `<div class="gh-not-auth"><p>Sorunlar yüklenemedi: ${escapeHtml(String(err))}</p></div>`;
    setStatus('Sorunlar yüklenemedi');
  }
}

function renderIssues(issues) {
  if (issues.length === 0) {
    els.issuesList.innerHTML = `
      <div class="gh-empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"></circle><path d="M12 8v4"></path><circle cx="12" cy="16" r="0.5" fill="currentColor"></circle></svg>
        <strong>Sorun bulunamadı</strong>
        <span>Farklı bir filtre deneyin veya daha sonra tekrar kontrol edin.</span>
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
          <span>@${escapeHtml(issue.author)}</span>
          <span>${formatRelativeDate(issue.updatedAt || issue.updated_at)}</span>
          ${issue.comments > 0 ? `<span>💬 ${issue.comments}</span>` : ''}
          ${issue.body ? `<span style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(issue.body)}</span>` : ''}
        </div>
        <div class="gh-item-actions">
          <button class="gh-view-btn" type="button" data-url="${escapeHtml(issue.url)}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Aç
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

  els.prsList.innerHTML = '<div class="gh-empty-state"><div class="action-log-loading"><div class="spinner"></div><span>Pull Request\'ler yükleniyor...</span></div></div>';

  if (!state.ghAuthenticated) {
    const authed = await checkGhAuth();
    if (!authed) {
      renderGhNotAuth(els.prsList);
      return;
    }
  }

  try {
    setStatus('GitHub PR\'ları yükleniyor...');
    const prs = await invoke('get_github_prs', { filter: f, limit: 50 });
    state.ghPrs = prs;
    renderPrs(prs);
    const openCount = prs.filter((p) => p.state === 'open').length;
    if (openCount > 0) {
      els.ghPrsCount.textContent = openCount;
      els.ghPrsCount.style.display = 'inline-flex';
    }
    setStatus(`${prs.length} PR yüklendi`);
  } catch (err) {
    els.prsList.innerHTML = `<div class="gh-not-auth"><p>PR'lar yüklenemedi: ${escapeHtml(String(err))}</p></div>`;
    setStatus('PR\'lar yüklenemedi');
  }
}

function renderPrs(prs) {
  if (prs.length === 0) {
    els.prsList.innerHTML = `
      <div class="gh-empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M6 15V6"></path><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
        <strong>Pull Request bulunamadı</strong>
        <span>Farklı bir filtre deneyin.</span>
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
          ${pr.isDraft || pr.is_draft ? '<span class="gh-label">Taslak</span>' : ''}
          ${labels ? `<div class="gh-item-labels">${labels}</div>` : ''}
        </div>
        <div class="gh-item-meta">
          <span>@${escapeHtml(pr.author)}</span>
          ${branchFlow}
          <span>${formatRelativeDate(pr.updatedAt || pr.updated_at)}</span>
          ${pr.reviews > 0 ? `<span>🔍 ${pr.reviews} inceleme</span>` : ''}
        </div>
        <div class="gh-item-actions">
          <button class="gh-log-btn gh-pr-detail-btn" type="button" data-pr-number="${pr.number}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"></path><polyline points="14 2 14 7 19 7"></polyline></svg>
            Diff & Commit'leri İncele
          </button>
          ${isOpen ? `
          <button class="gh-view-btn gh-pr-quick-merge-btn" type="button" data-pr-number="${pr.number}" style="border-color:rgba(46,160,67,0.4);color:#3fb950;background:rgba(46,160,67,0.1);">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="6" r="3"></circle><path d="M6 15V6"></path><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
            Birleştir
          </button>` : ''}
          <button class="gh-view-btn" type="button" data-url="${escapeHtml(pr.url)}">
            <svg viewBox="0 0 24 24" width="12" height="12"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            Aç
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
  els.actionsList.innerHTML = '<div class="gh-empty-state"><div class="action-log-loading"><div class="spinner"></div><span>İşlemler yükleniyor...</span></div></div>';

  if (!state.ghAuthenticated) {
    const authed = await checkGhAuth();
    if (!authed) {
      renderGhNotAuth(els.actionsList);
      return;
    }
  }

  try {
    setStatus('GitHub İşlemleri (Actions) yükleniyor...');
    const actions = await invoke('get_github_actions', { limit: 30 });
    state.ghActions = actions;
    renderActions(actions);
    if (actions.length > 0) {
      els.ghActionsCount.textContent = actions.length;
      els.ghActionsCount.style.display = 'inline-flex';
    }
    setStatus(`${actions.length} işlem çalıştırması yüklendi`);
  } catch (err) {
    els.actionsList.innerHTML = `<div class="gh-not-auth"><p>İşlemler yüklenemedi: ${escapeHtml(String(err))}</p></div>`;
    setStatus('İşlemler yüklenemedi');
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
  if (action.status === 'in_progress') return 'Çalışıyor';
  if (action.status === 'queued') return 'Sırada';
  const c = (action.conclusion || '').toLowerCase();
  if (c === 'success') return 'Başarılı';
  if (c === 'failure') return 'Başarısız';
  if (c === 'cancelled') return 'İptal Edildi';
  if (c === 'skipped') return 'Atlandı';
  return c || action.status || '';
}

function renderActions(actions) {
  if (actions.length === 0) {
    els.actionsList.innerHTML = `
      <div class="gh-empty-state">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <strong>İşlem çalıştırması bulunamadı</strong>
        <span>Bu depo için herhangi bir iş akışı çalıştırması yok.</span>
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
            Günlüğü İncele
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
    els.actionLogPre.textContent = `Çalıştırma günlüğü yüklenirken hata oluştu:\n${err}`;
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
      <strong>GitHub CLI ile kimlik doğrulanmadı</strong>
      <p>GitHub'a bağlanmak için terminalde <code>gh auth login</code> komutunu çalıştırın.</p>
      <p style="font-size:11px;">Sorunlar, Pull Request'ler ve İşlemler <strong>gh</strong> CLI gerektirir.</p>
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

let currentModalPr = null;
let currentPrDiffFiles = null;

function renderPrDiff() {
  if (!els.prDiffContent || !currentPrDiffFiles) return;
  renderDiffFiles(currentPrDiffFiles, els.prDiffContent, { scope: `pr${currentModalPr?.number || ''}`, idPrefix: 'pr-diff-file-' });
}

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

  if (els.prBodyContent) els.prBodyContent.textContent = pr.body || 'Açıklama girilmedi.';
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
  currentPrDiffFiles = null;
  try {
    const diff = await invoke('get_pr_diff', { prNumber: pr.number });
    currentPrDiffFiles = parseUnifiedDiff(diff || '');
    if (currentPrDiffFiles.length) renderPrDiff();
    else if (els.prDiffContent) els.prDiffContent.textContent = diff || 'Diff bulunamadı.';
  } catch (err) {
    if (els.prDiffContent) els.prDiffContent.textContent = `PR diff yüklenirken hata oluştu: ${err}`;
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
        els.prCommitsList.innerHTML = '<div class="gh-empty-state">PR içinde commit bulunamadı.</div>';
      } else {
        els.prCommitsList.innerHTML = commits.map((c) => `
          <div class="pr-commit-item">
            <div>
              <div class="pr-commit-msg">${escapeHtml(c.messageHeadline)}</div>
              <small style="color:var(--text-dim);">${escapeHtml(c.authorName || c.authors?.join(', ') || 'Bilinmeyen')} tarafından</small>
            </div>
            <span class="pr-commit-hash">${escapeHtml((c.oid || '').slice(0, 7))}</span>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    if (els.prCommitsList) els.prCommitsList.innerHTML = `<div class="gh-not-auth">PR commit'leri yüklenemedi: ${escapeHtml(String(err))}</div>`;
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

  if (!confirm(`#${prNumber} numaralı PR'ı ${method} yöntemiyle birleştirmek istediğinizden emin misiniz?`)) return;

  if (els.btnConfirmPrMerge) {
    els.btnConfirmPrMerge.disabled = true;
    els.btnConfirmPrMerge.textContent = 'Birleştiriliyor...';
  }

  try {
    setStatus(`PR #${prNumber} birleştiriliyor...`);
    await invoke('merge_github_pr', { prNumber, mergeMethod: method });
    setStatus(`PR #${prNumber} başarıyla birleştirildi!`);
    closePrModal();
    loadGhPrs();

    // PR was merged on GitHub — offer to update local branches from origin.
    const baseBranch = currentModalPr.baseRef || currentModalPr.base_ref || 'main';
    if (confirm(`PR #${prNumber} GitHub üzerinde ${baseBranch} dalına birleştirildi.\n\nYerel dalları güncellemek için ${state.activeRemote || 'origin'} deposundan getirilsin mi (fetch)?`)) {
      await fetchActiveRemote();
    }
  } catch (err) {
    setStatus(`PR #${prNumber} birleştirilemedi`);
    alert(`Birleştirme başarısız oldu: ${err}`);
  } finally {
    if (els.btnConfirmPrMerge) {
      els.btnConfirmPrMerge.disabled = false;
      els.btnConfirmPrMerge.textContent = 'Pull Request\'i Birleştir';
    }
  }
}



// ─── Create Pull Request ─────────────────────────────────────────────────────

function setCreatePrError(message) {
  if (!els.createPrError) return;
  els.createPrError.textContent = message || '';
  els.createPrError.hidden = !message;
}

function fillSelect(select, values, selected) {
  select.innerHTML = values
    .map((v) => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`)
    .join('');
}

function prefillCreatePrTitle() {
  const head = els.createPrHead.value;
  const branch = state.branches.find((b) => !b.is_remote && b.name === head);
  const commit = branch && state.commits.find((c) => c.id === branch.commit_id);
  const subject = commit ? commit.message.split('\n')[0].trim() : '';
  els.createPrTitleInput.value = subject || head;
}

async function openCreatePrModal() {
  setCreatePrError('');
  els.createPrBody.value = '';
  els.createPrDraft.checked = false;
  els.btnConfirmCreatePr.disabled = true;
  els.createPrModal.hidden = false;
  setStatus('PR bilgileri yükleniyor...');

  try {
    const ctx = await invoke('get_pr_create_context');
    const localBranches = state.branches.filter((b) => !b.is_remote && !b.is_tag).map((b) => b.name);
    const heads = localBranches.length ? localBranches : [ctx.currentBranch];
    fillSelect(els.createPrHead, heads, ctx.currentBranch);
    fillSelect(els.createPrBase, ctx.branches, ctx.defaultBranch);
    prefillCreatePrTitle();
    els.btnConfirmCreatePr.disabled = false;
    els.createPrTitleInput.focus();
    setStatus('Hazır');
  } catch (err) {
    setCreatePrError(`GitHub bilgileri alınamadı: ${err}`);
    setStatus('PR bilgileri alınamadı');
  }
}

function closeCreatePrModal() {
  if (els.createPrModal) els.createPrModal.hidden = true;
}

async function submitCreatePr() {
  const head = els.createPrHead.value;
  const base = els.createPrBase.value;
  const title = els.createPrTitleInput.value.trim();
  const body = els.createPrBody.value;
  const draft = els.createPrDraft.checked;

  if (!title) return setCreatePrError('Başlık boş olamaz.');
  if (head === base) return setCreatePrError('Kaynak ve hedef dal aynı olamaz.');
  setCreatePrError('');

  els.btnConfirmCreatePr.disabled = true;
  const originalLabel = els.btnConfirmCreatePr.textContent;

  try {
    // The head branch must exist on GitHub. If it is the current branch and has
    // unpushed commits (or no upstream yet), offer to push it first.
    const remote = state.activeRemote || 'origin';
    const sync = await invoke('get_sync_status', { targetRemote: remote });
    if (sync.current_branch === head && (!sync.upstream || sync.unpushed_count > 0)) {
      const reason = sync.upstream
        ? `${sync.unpushed_count} commit henüz gönderilmedi`
        : 'dal henüz GitHub\'a gönderilmedi';
      if (!confirm(`"${head}": ${reason}.\n\nPR açmadan önce ${remote} deposuna push edilsin mi?`)) {
        els.btnConfirmCreatePr.disabled = false;
        return;
      }
      els.btnConfirmCreatePr.textContent = 'Gönderiliyor...';
      setStatus(`${head} dalı ${remote} deposuna gönderiliyor...`);
      await invoke('push_origin', { targetRemote: remote });
    }

    els.btnConfirmCreatePr.textContent = 'Oluşturuluyor...';
    setStatus('Pull Request oluşturuluyor...');
    const url = await invoke('create_github_pr', { base, head, title, body, draft });
    closeCreatePrModal();
    setStatus(`Pull Request oluşturuldu: ${url}`);
    state.ghPrFilter = 'open';
    await loadGhPrs('open');
    refreshRepositoryData().catch(() => {});
  } catch (err) {
    setCreatePrError(`PR oluşturulamadı: ${err}`);
    setStatus('PR oluşturulamadı');
  } finally {
    els.btnConfirmCreatePr.disabled = false;
    els.btnConfirmCreatePr.textContent = originalLabel;
  }
}

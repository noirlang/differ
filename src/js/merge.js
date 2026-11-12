state.activeMergeSource = null;

function openMergeModal(sourceBranch, preferredTarget = null) {
  state.activeMergeSource = sourceBranch;

  const localBranches = state.branches.filter((b) => !b.is_remote && !b.is_tag && b.name !== 'detached');
  const activeBranch = state.branches.find((b) => b.is_head);
  const activeBranchName = activeBranch ? activeBranch.name : '';

  const targetBranches = localBranches.filter((b) => b.name !== sourceBranch);

  if (targetBranches.length === 0) {
    alert('Birleştirme yapılabilecek başka bir yerel dal bulunamadı.');
    return;
  }

  const chosenTarget = preferredTarget && targetBranches.some((b) => b.name === preferredTarget)
    ? preferredTarget
    : (targetBranches.some((b) => b.name === activeBranchName)
      ? activeBranchName
      : targetBranches[0].name);

  els.mergeSourceLabel.textContent = sourceBranch;
  els.mergeTargetLabel.textContent = chosenTarget;

  els.mergeTargetSelect.innerHTML = targetBranches.map((b) => {
    const selected = b.name === chosenTarget ? 'selected' : '';
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
    els.btnConfirmMerge.textContent = 'Birleştiriliyor...';
    setStatus(`${source} dalı ${target} dalına birleştiriliyor...`);

    await invoke('merge_branches', { source, target });

    setStatus(`${source} dalı ${target} dalına başarıyla birleştirildi`);
    closeMergeModal();

    await followMergedBranch(target);
    await offerPush(target);
  } catch (err) {
    console.error(err);
    setStatus('Birleştirme başarısız oldu');
    closeMergeModal();
    await handleOpFailure('merge', target, target, source, err);
  } finally {
    els.btnConfirmMerge.disabled = false;
    els.btnConfirmMerge.textContent = 'Birleştirmeyi Onayla';
  }
}

function closeConflictModal() {
  if (els.conflictModal) els.conflictModal.setAttribute('hidden', '');
  state.activeConflict = null;
}

function openConflictModal(op, target, oursLabel, theirsLabel, files) {
  state.activeConflict = { op, target, oursLabel, theirsLabel };

  const opName = op === 'cherry-pick' ? 'Cherry-pick' : 'Birleştirme';
  if (els.conflictKicker) els.conflictKicker.textContent = `${opName} Çakışmaları`;
  if (els.conflictTitle) els.conflictTitle.textContent = `${opName} Çakışmalarını Çöz`;
  if (els.conflictSubtitle) {
    els.conflictSubtitle.textContent = `${files.length} dosyada çakışma var. Tüm dosyalar için hangi sürümün korunacağını seçin:`;
  }
  if (els.conflictFileList) {
    els.conflictFileList.innerHTML = files.map((f) => `<span>${escapeHtml(f)}</span>`).join('');
  }
  if (els.keepOursLabel) els.keepOursLabel.textContent = oursLabel;
  if (els.keepTheirsLabel) els.keepTheirsLabel.textContent = theirsLabel;
  if (els.conflictLegendOurs) els.conflictLegendOurs.textContent = oursLabel;
  if (els.conflictLegendTheirs) els.conflictLegendTheirs.textContent = theirsLabel;
  if (els.btnKeepOurs) els.btnKeepOurs.disabled = false;
  if (els.btnKeepTheirs) els.btnKeepTheirs.disabled = false;
  if (els.btnAbortConflict) els.btnAbortConflict.textContent = `İşlemi (${op}) İptal Et`;

  if (els.conflictDiffList) {
    els.conflictDiffList.innerHTML = '<div class="muted-row" style="padding: 8px 10px; font-size: 11px; color: var(--text-dim);">Diff yükleniyor...</div>';
    loadConflictDiffs(files);
  }

  els.conflictModal.removeAttribute('hidden');
}

async function loadConflictDiffs(files) {
  if (!els.conflictDiffList) return;

  const blocks = await Promise.all(files.map(async (filePath) => {
    try {
      const diff = await invoke('get_conflict_diff', { filePath });
      return { filePath, diff, error: null };
    } catch (err) {
      console.warn(`Conflict diff failed for ${filePath}:`, err);
      return { filePath, diff: null, error: String(err) };
    }
  }));

  // The user may have closed/resolved meanwhile — do not render into a dead modal.
  if (!state.activeConflict || els.conflictModal?.hasAttribute('hidden')) return;

  els.conflictDiffList.innerHTML = blocks.map(({ filePath, diff, error }) => {
    if (error) {
      return `
        <section class="diff-file-block">
          <div class="diff-file-header">
            <span>${escapeHtml(filePath)}</span>
            <small>diff yok</small>
          </div>
          <div class="diff-placeholder" style="padding: 8px 12px; font-size: 11px; color: var(--text-dim);">Diff yüklenemedi: ${escapeHtml(error)}</div>
        </section>`;
    }
    if (!diff || !diff.hunks || diff.hunks.length === 0) {
      return `
        <section class="diff-file-block">
          <div class="diff-file-header">
            <span>${escapeHtml(filePath)}</span>
            <small>ikili dosya veya metin diff'i yok</small>
          </div>
        </section>`;
    }

    const hunks = diff.hunks.map((hunk) => `
      <div class="diff-hunk">
        <div class="diff-hunk-header">${escapeHtml(hunk.header)}</div>
        ${hunk.lines.map((line) => `
          <div class="diff-line ${line.line_type}">
            <span class="diff-line-num">${line.old_lineno || ''}</span>
            <span class="diff-line-num">${line.new_lineno || ''}</span>
            <span class="diff-line-content">${escapeHtml((line.content || '').replace(/\n$/, ''))}</span>
          </div>
        `).join('')}
      </div>
    `).join('');

    return `
      <section class="diff-file-block">
        <div class="diff-file-header">
          <span>${escapeHtml(filePath)}</span>
          <small>hedef ve gelen karşılaştırması</small>
        </div>
        ${hunks}
      </section>`;
  }).join('');
}

// When a merge/cherry-pick fails, check whether it left real conflicts behind.
// If so, offer the 2-option resolver; otherwise show the plain error.
async function handleOpFailure(op, target, oursLabel, theirsLabel, err) {
  let files = [];
  try {
    files = await invoke('get_merge_conflicts');
  } catch (conflictErr) {
    console.warn('Could not read conflicted files:', conflictErr);
  }

  if (files && files.length > 0) {
    openConflictModal(op, target, oursLabel, theirsLabel, files);
  } else {
    const opName = op === 'cherry-pick' ? 'Cherry-pick' : 'Birleştirme';
    alert(`${opName} başarısız oldu: ${err}`);
  }
}

async function resolveConflictChoice(side) {
  const ctx = state.activeConflict;
  if (!ctx) return;

  if (!confirm(`Çakışan tüm dosyalar için ${side === 'ours' ? ctx.oursLabel : ctx.theirsLabel} sürümü korunsun ve ${ctx.op} tamamlansın mı?`)) {
    return;
  }

  try {
    if (els.btnKeepOurs) els.btnKeepOurs.disabled = true;
    if (els.btnKeepTheirs) els.btnKeepTheirs.disabled = true;
    setStatus(`Çakışmalar çözülüyor (${side} sürümü korunuyor)...`);

    const res = await invoke('resolve_conflicts', { side });

    setStatus(typeof res === 'string' && res ? res : 'Çakışmalar çözüldü');
    closeConflictModal();

    await followMergedBranch(ctx.target);
    await offerPush(ctx.target);
  } catch (err) {
    console.error(err);
    setStatus('Çakışma çözümü başarısız oldu');
    alert(`Çakışmalar çözülemedi: ${err}`);
    if (els.btnKeepOurs) els.btnKeepOurs.disabled = false;
    if (els.btnKeepTheirs) els.btnKeepTheirs.disabled = false;
  }
}

async function abortConflictOp() {
  const ctx = state.activeConflict;

  try {
    const res = await invoke('abort_in_progress');
    setStatus(typeof res === 'string' && res ? res : 'İşlem iptal edildi');
  } catch (err) {
    console.error(err);
    alert(`İptal başarısız oldu: ${err}`);
  }

  closeConflictModal();
  await refreshRepositoryData({ selectLatest: true });
}

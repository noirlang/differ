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
      els.btnCommitSelected.textContent = `${count} dosyayı commit'e ekle (amend)`;
    } else if (hasMessage) {
      els.btnCommitSelected.disabled = false;
      els.btnCommitSelected.textContent = 'Commit\'i Düzenle (Amend)';
    } else {
      els.btnCommitSelected.disabled = true;
      els.btnCommitSelected.textContent = 'Commit\'i Düzenle (Amend)';
    }
  } else {
    els.btnCommitSelected.classList.remove('is-editing');
    els.btnCommitSelected.disabled = count === 0 || !hasMessage;
    els.btnCommitSelected.textContent = count > 0 ? `${count} dosyayı commit'le` : 'Seçilen dosyaları commit\'le';
  }
}

function cancelCommitEdit() {
  state.editingCommitId = null;
  els.commitMessageInput.value = '';
  state.selectedCoauthors = [];
  renderCoauthors();
  updateCommitAction();
  setStatus('Commit düzenleme iptal edildi.');
}

function renderWorktreeStatus() {
  const validPaths = new Set(state.worktreeFiles.map((file) => file.path));
  [...state.selectedWorktreePaths].forEach((path) => {
    if (!validPaths.has(path)) state.selectedWorktreePaths.delete(path);
  });

  if (state.worktreeFiles.length === 0) {
    els.worktreeList.innerHTML = '<div class="muted-row">Commit\'lenecek bekleyen değişiklik yok</div>';
    updateCommitAction();
    return;
  }

  els.worktreeList.innerHTML = state.worktreeFiles.map((file) => {
    const config = worktreeStatusConfig[file.status] || { label: '?', text: file.status };
    const { name, dir } = splitPath(file.path);
    const checked = state.selectedWorktreePaths.has(file.path) ? 'checked' : '';
    const stagedText = file.conflicted ? 'çakışma' : file.staged && file.unstaged ? 'hazırlandı + hazırlanmadı' : file.staged ? 'hazırlandı' : 'hazırlanmadı';

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
    setStatus(isAmend ? 'Commit düzenleniyor (amend)...' : 'Commit oluşturuluyor...');
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
    setStatus(isAmend ? 'Commit başarıyla düzenlendi (amended)' : 'Commit oluşturuldu');

    if (appSettings.smtpEnabled) {
      try {
        setStatus('Yama e-postası gönderiliyor...');
        const emailResult = await invoke('send_patch_email');
        setStatus(emailResult);
      } catch (emailErr) {
        console.error('Patch email error:', emailErr);
        setStatus(`Commit oluşturuldu fakat e-posta gönderilemedi: ${emailErr}`);
      }
    }
  } catch (err) {
    console.error(err);
    setStatus('Commit oluşturulamadı');
    alert(`Commit oluşturulamadı: ${err}`);
  } finally {
    updateCommitAction();
  }
}

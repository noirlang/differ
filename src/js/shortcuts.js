// ─── Keyboard shortcuts ──────────────────────────────────────────────────────
//
// One registry drives both the key handling and the help dialog (Shift+?).
// `keys` is matched against the pressed combination, e.g. 'Ctrl+Shift+P'.
// Shortcuts without Ctrl are ignored while typing in a text field.

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');

const SHORTCUTS = [
  { group: 'Genel', keys: 'Ctrl+O', label: 'Depo aç', run: () => openRepo() },
  { group: 'Genel', keys: 'Ctrl+F', label: 'Commit ara', needsRepo: true, run: () => { els.searchInput.focus(); els.searchInput.select(); } },
  { group: 'Genel', keys: 'Ctrl+Shift+R', label: 'Depoyu yenile', needsRepo: true, run: async () => { await refreshRepositoryData(); setStatus('Depo yenilendi'); } },
  { group: 'Genel', keys: 'Ctrl+,', label: 'Ayarlar', run: () => openSettingsModal() },
  { group: 'Genel', keys: 'Shift+?', label: 'Kısayol listesi', run: () => toggleShortcutHelp() },

  { group: 'Gezinme', keys: '↑ / ↓', label: 'Önceki / sonraki commit', display: true },
  { group: 'Gezinme', keys: 'Shift+ArrowUp', label: '10 commit yukarı', needsRepo: true, run: () => moveCommitSelection(-10) },
  { group: 'Gezinme', keys: 'Shift+ArrowDown', label: '10 commit aşağı', needsRepo: true, run: () => moveCommitSelection(10) },
  { group: 'Gezinme', keys: 'Shift+Home', label: 'En yeni commit', needsRepo: true, run: () => moveCommitSelection(-Infinity) },
  { group: 'Gezinme', keys: 'Ctrl+1', label: 'Geçmiş', needsRepo: true, run: () => switchGhPanel('history') },
  { group: 'Gezinme', keys: 'Ctrl+2', label: 'Sorunlar (Issues)', needsRepo: true, run: () => switchGhPanel('issues') },
  { group: 'Gezinme', keys: 'Ctrl+3', label: 'Pull Request\'ler', needsRepo: true, run: () => switchGhPanel('prs') },
  { group: 'Gezinme', keys: 'Ctrl+4', label: 'İşlemler (Actions)', needsRepo: true, run: () => switchGhPanel('actions') },

  { group: 'Dallar', keys: 'Ctrl+Shift+B', label: 'Dal menüsünü aç', needsRepo: true, run: () => toggleBranchDropdown() },
  { group: 'Dallar', keys: 'Ctrl+Shift+N', label: 'Yeni dal', needsRepo: true, run: () => openBranchModal({ mode: 'create' }) },

  { group: 'Commit ve senkron', keys: 'Ctrl+Shift+C', label: 'Commit mesajına odaklan', needsRepo: true, run: () => focusCommitMessage() },
  { group: 'Commit ve senkron', keys: 'Ctrl+Enter', label: 'Commit oluştur (mesaj kutusundayken)', display: true },
  { group: 'Commit ve senkron', keys: 'Ctrl+Shift+G', label: 'Yapay zeka ile commit mesajı üret', needsRepo: true, run: () => generateAiCommitMessage() },
  { group: 'Commit ve senkron', keys: 'Ctrl+Shift+P', label: 'Push', needsRepo: true, run: () => pushOrigin() },
  { group: 'Commit ve senkron', keys: 'Ctrl+Shift+F', label: 'Fetch', needsRepo: true, run: () => fetchActiveRemote() },
  { group: 'Commit ve senkron', keys: 'Ctrl+Shift+M', label: 'Yeni Pull Request', needsRepo: true, run: () => { switchGhPanel('prs'); openCreatePrModal(); } },

  { group: 'Diff', keys: 'Ctrl+Shift+D', label: 'Satır içi / yan yana görünüm', run: () => toggleDiffViewMode() },
  { group: 'Diff', keys: 'Ctrl+Shift+E', label: 'Tüm dosyaları daralt / genişlet', needsRepo: true, run: () => toggleAllDiffFiles() },
];

function eventCombo(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  // '?' already implies Shift on most layouts; keep Shift explicit for others.
  if (event.shiftKey) parts.push('Shift');
  let key = event.key;
  if (key.length === 1) key = key.toUpperCase();
  if (key === ' ') key = 'Space';
  parts.push(key);
  return parts.join('+');
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function isAnyModalOpen() {
  return [...document.querySelectorAll('.modal-overlay')].some((m) => !m.hidden);
}

function handleShortcut(event) {
  const combo = eventCombo(event);
  const typing = isTypingTarget(event.target);

  const shortcut = SHORTCUTS.find((s) => s.run && s.keys.toUpperCase() === combo.toUpperCase());
  if (!shortcut) return false;
  // Plain/Shift shortcuts must not hijack typing; Ctrl ones are fine.
  if (typing && !combo.startsWith('Ctrl+')) return false;
  if (shortcut.needsRepo && !state.repoInfo) return false;
  // Don't trigger actions behind an open dialog (the help dialog toggles itself).
  if (isAnyModalOpen() && shortcut.keys !== 'Shift+?') return false;

  event.preventDefault();
  event.stopPropagation();
  Promise.resolve(shortcut.run()).catch((err) => console.error('Shortcut failed:', shortcut.keys, err));
  return true;
}

function moveCommitSelection(delta) {
  const ids = state.filteredCommitIds;
  if (!ids.length) return;
  const current = ids.indexOf(state.selectedCommit);
  const base = current === -1 ? 0 : current;
  const next = delta === -Infinity ? 0 : Math.max(0, Math.min(ids.length - 1, base + delta));
  if (next === current) return;
  const nextId = ids[next];
  selectCommit(nextId);
  requestAnimationFrame(() => {
    els.commitList.querySelector(`[data-commit-id="${nextId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function focusCommitMessage() {
  switchGhPanel('history');
  els.commitMessageInput?.focus();
  els.commitMessageInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function toggleAllDiffFiles() {
  const blocks = [...els.diffContainer.querySelectorAll('.diff-file-block')];
  if (!blocks.length) return;
  const anyOpen = blocks.some((b) => !b.classList.contains('collapsed'));
  setAllDiffFilesOpen(els.diffContainer, state.diffData, !anyOpen);
}

// ── Help dialog ──

function formatShortcutKeys(keys) {
  if (keys === 'Shift+?') return '<kbd>Shift</kbd><kbd>?</kbd>';
  return keys
    .replace('ArrowUp', '↑').replace('ArrowDown', '↓')
    .split(/\+(?!$)/)
    .map((k) => {
      const label = k === 'Ctrl' && isMac ? '⌘' : k;
      return label.includes(' / ') ? label.split(' / ').map((x) => `<kbd>${escapeHtml(x)}</kbd>`).join(' / ') : `<kbd>${escapeHtml(label)}</kbd>`;
    })
    .join('');
}

function renderShortcutHelp() {
  const groups = new Map();
  SHORTCUTS.forEach((s) => {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group).push(s);
  });
  els.shortcutHelpBody.innerHTML = [...groups].map(([group, items]) => `
    <section class="shortcut-group">
      <h3>${escapeHtml(group)}</h3>
      ${items.map((s) => `
        <div class="shortcut-row">
          <span>${escapeHtml(s.label)}</span>
          <span class="shortcut-keys">${formatShortcutKeys(s.keys)}</span>
        </div>
      `).join('')}
    </section>
  `).join('');
}

function toggleShortcutHelp(force) {
  const open = force ?? els.shortcutHelpModal.hidden;
  if (open) renderShortcutHelp();
  els.shortcutHelpModal.hidden = !open;
}

function initShortcuts() {
  // Capture phase so shortcuts win over component handlers.
  document.addEventListener('keydown', handleShortcut, true);

  els.commitMessageInput?.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (els.btnCommitSelected && !els.btnCommitSelected.disabled) commitSelectedChanges();
    }
  });

  els.btnCloseShortcutHelp?.addEventListener('click', () => toggleShortcutHelp(false));
  els.shortcutHelpModal?.addEventListener('click', (e) => {
    if (e.target === els.shortcutHelpModal) toggleShortcutHelp(false);
  });
}

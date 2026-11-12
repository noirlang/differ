function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

async function checkAppUpdate() {
  if (!els.btnCheckUpdate) return;
  els.btnCheckUpdate.disabled = true;
  els.btnCheckUpdate.innerHTML = `
    <div class="spinner" style="width:12px;height:12px;border:2px solid var(--line);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;display:inline-block;margin-right:6px;"></div>
    <span>Kontrol ediliyor...</span>`;

  els.updateStatusBox.style.display = 'block';
  els.updateStatusInfo.innerHTML = '<span style="color:var(--text-dim);"><div class="action-log-loading" style="padding:10px;"><div class="spinner"></div> github.com/noirlang/differ sürümleri kontrol ediliyor...</div></span>';
  els.updateNotesBox.style.display = 'none';
  els.updateAssetsBox.style.display = 'none';

  try {
    const update = await invoke('check_app_update');
    els.btnCheckUpdate.disabled = false;
    els.btnCheckUpdate.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; vertical-align: middle;">
        <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"></path>
        <path d="M3 21v-5h5"></path>
        <path d="M3 12A9 9 0 0 1 18.5 5.7L21 8"></path>
        <path d="M21 3v5h-5"></path>
      </svg>
      <span>Güncellemeleri Kontrol Et</span>`;

    if (els.settingsAppVersion) {
      els.settingsAppVersion.textContent = `v${update.currentVersion}`;
    }

    if (update.hasUpdate) {
      els.updateStatusInfo.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div>
            <span class="update-badge available">🎉 Yeni Güncelleme Mevcut!</span>
            <div style="margin-top:6px;font-size:13px;font-weight:600;color:var(--text);">
              ${escapeHtml(update.releaseName || update.tagName)} (<span style="color:#3fb950;">v${escapeHtml(update.latestVersion)}</span>)
            </div>
            <small style="color:var(--text-dim);">Yayınlanma: ${formatRelativeDate(update.publishedAt)}</small>
          </div>
          <button class="mini-btn primary" type="button" data-url="${escapeHtml(update.htmlUrl)}">
            Sürümü GitHub'da Aç
          </button>
        </div>`;

      els.updateStatusInfo.querySelector('button[data-url]')?.addEventListener('click', (e) => {
        openUrl(e.target.closest('button').dataset.url);
      });

      if (update.releaseNotes) {
        els.updateNotesContent.textContent = update.releaseNotes;
        els.updateNotesBox.style.display = 'block';
      }

      if (update.assets && update.assets.length > 0) {
        els.updateAssetsList.innerHTML = update.assets.map((asset) => `
          <div class="update-asset-item">
            <span class="update-asset-name">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              ${escapeHtml(asset.name)}
            </span>
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="update-asset-size">${formatBytes(asset.size)}</span>
              <button class="mini-btn primary" type="button" data-url="${escapeHtml(asset.downloadUrl)}">
                Paketi İndir
              </button>
            </div>
          </div>
        `).join('');

        els.updateAssetsList.querySelectorAll('button[data-url]').forEach((btn) => {
          btn.addEventListener('click', () => openUrl(btn.dataset.url));
        });

        els.updateAssetsBox.style.display = 'block';
      }
    } else {
      els.updateStatusInfo.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="update-badge latest">✓ Güncel</span>
          <span style="font-size:12px;color:var(--text-muted);">
            En son sürümü kullanıyorsunuz (<strong>v${escapeHtml(update.currentVersion)}</strong>).
          </span>
        </div>`;
    }
  } catch (err) {
    els.btnCheckUpdate.disabled = false;
    els.btnCheckUpdate.innerHTML = `<span>Güncellemeleri Kontrol Et</span>`;
    els.updateStatusInfo.innerHTML = `
      <div style="color:#f85149;font-size:12px;">
        Güncellemeler kontrol edilemedi: ${escapeHtml(String(err))}
      </div>`;
  }
}

// ─── PR Detail Modal Functions ───────────────────────────────────────────────

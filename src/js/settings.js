let currentSystemInfo = null;
let aiLoadingInterval = null;

const aiLoadingStages = [
  'Diff inceleniyor...',
  'Degisiklikler analiz ediliyor...',
  'Commit mesaji olusturuluyor...',
  'Conventional Commit formatina donusturuluyor...',
  'Son duzenlemeler yapiliyor...',
];

function startAiLoadingAnimation(model) {
  const subtitleEl = $('commit-loading-subtitle');
  if (!subtitleEl) return;
  let stageIndex = 0;
  subtitleEl.textContent = aiLoadingStages[0];
  aiLoadingInterval = window.setInterval(() => {
    stageIndex = (stageIndex + 1) % aiLoadingStages.length;
    subtitleEl.textContent = aiLoadingStages[stageIndex];
  }, 3000);
}

function stopAiLoadingAnimation() {
  if (aiLoadingInterval) {
    window.clearInterval(aiLoadingInterval);
    aiLoadingInterval = null;
  }
}

async function generateAiCommitMessage() {
  const provider = appSettings.aiProvider || 'ollama';
  if (provider === 'gemini' && !secretStatus.geminiApiKey) {
    alert('Gemini API anahtarı ayarlanmamış. Lütfen Ayarlar bölümünden API anahtarınızı girin.');
    openSettingsModal();
    return;
  }

  const selectedPaths = [...state.selectedWorktreePaths];
  if (selectedPaths.length === 0) {
    alert('Commit mesajı oluşturmak için lütfen en az bir değiştirilmiş dosya seçin.');
    return;
  }

  let currentModel = 'gemma4:12b';
  let displayTag = 'AI';
  if (provider === 'gemini') {
    currentModel = appSettings.geminiModel || 'gemini-2.5-flash';
    displayTag = `Gemini: ${currentModel}`;
  } else if (provider === 'lmstudio') {
    await checkLmStudioStatus();
    currentModel = state.lmStudioModels[0] || 'local-model';
    displayTag = `LM Studio: ${currentModel}`;
  } else {
    currentModel = appSettings.selectedModel || 'gemma4:12b';
    displayTag = `Ollama: ${currentModel}`;
  }

  try {
    els.btnAiGenerateCommit.disabled = true;
    els.btnAiGenerateCommit.classList.add('is-loading');
    els.btnAiGenerateCommit.innerHTML = `
      <span class="spinner-icon"></span>
      <span>Yapay Zeka Yazıyor...</span>
      <span class="ai-model-tag">${escapeHtml(displayTag)}</span>
    `;
    if (els.commitBox) {
      els.commitBox.classList.add('is-loading');
    }
    startAiLoadingAnimation(displayTag);
    setStatus('Yapay zeka commit mesajı oluşturuyor...');

    let generatedMessage;
    if (provider === 'gemini') {
      generatedMessage = await invoke('generate_ai_commit_message_gemini', {
        diff: null,
        paths: selectedPaths,
        model: appSettings.geminiModel || 'gemini-2.5-flash',
        apiKey: null, // backend reads the key from the OS keychain
      });
    } else if (provider === 'lmstudio') {
      generatedMessage = await invoke('generate_ai_commit_message_lm_studio', {
        diff: null,
        paths: selectedPaths,
        model: currentModel,
      });
    } else {
      generatedMessage = await invoke('generate_ai_commit_message', {
        diff: null,
        paths: selectedPaths,
        model: currentModel,
      });
    }

    if (generatedMessage) {
      els.commitMessageInput.value = generatedMessage;
      updateCommitAction();
      setStatus('Yapay zeka commit mesajı oluşturuldu!');
    }
  } catch (err) {
    console.error(err);
    setStatus('Yapay zeka commit mesajı oluşturulamadı');
    alert(`Yapay Zeka Commit Hatası: ${err}\n\nNot: ${provider === 'gemini' ? 'Gemini API anahtarınızın geçerli olduğundan' : `Ollama\'nın çalıştığından ve (${currentModel}) modelinin indirildiğinden`} emin olun.`);
  } finally {
    stopAiLoadingAnimation();
    els.btnAiGenerateCommit.disabled = false;
    els.btnAiGenerateCommit.classList.remove('is-loading');
    els.btnAiGenerateCommit.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
      </svg>
      <span>Yapay Zeka ile Commit Yaz</span>
      <span class="ai-model-tag" id="commit-ai-model-tag">${escapeHtml(displayTag)}</span>
    `;
    if (els.commitBox) {
      els.commitBox.classList.remove('is-loading');
    }
  }
}

async function openSettingsModal() {
  try {
    setStatus('Ayarlar yükleniyor...');

    let gitSettings = null;
    try {
      gitSettings = await invoke('get_git_settings');
      state.gitIdentities = gitSettings.identities;
      state.gpgKeys = gitSettings.gpg_keys;
    } catch (e) {
      console.log('get_git_settings error:', e);
    }

    els.settingGitName.value = appSettings.gitName || gitSettings?.current_name || '';
    els.settingGitEmail.value = appSettings.gitEmail || gitSettings?.current_email || '';
    els.settingGpgSign.checked = appSettings.gpgSign || gitSettings?.gpg_sign_enabled || false;

    const uiScaleSelect = document.getElementById('setting-ui-scale');
    if (uiScaleSelect) {
      uiScaleSelect.value = appSettings.uiScale || '1.0';
      uiScaleSelect.onchange = (e) => applyUiScale(e.target.value);
    }

    const signedOffByCheckbox = document.getElementById('commit-signed-off-by');
    if (signedOffByCheckbox) signedOffByCheckbox.checked = appSettings.signedOffBy || false;

    const provider = appSettings.aiProvider || 'ollama';
    const radioOllama = document.getElementById('ai-provider-ollama');
    const radioGemini = document.getElementById('ai-provider-gemini');
    const radioLmStudio = document.getElementById('ai-provider-lmstudio');
    if (radioOllama) radioOllama.checked = provider === 'ollama';
    if (radioGemini) radioGemini.checked = provider === 'gemini';
    if (radioLmStudio) radioLmStudio.checked = provider === 'lmstudio';
    switchAiProviderPanel(provider);
    checkLmStudioStatus();

    const geminiKeyInput = document.getElementById('setting-gemini-api-key');
    if (geminiKeyInput) {
      geminiKeyInput.value = '';
      geminiKeyInput.placeholder = secretStatus.geminiApiKey
        ? '•••••••• kayıtlı (değiştirmek için yeni anahtar girin)'
        : 'AIza...';
    }
    updateGeminiKeyRemoveButton();

    if (provider === 'gemini' && secretStatus.geminiApiKey) {
      fetchGeminiModels();
    }

    els.settingGpgKey.innerHTML = '<option value="none">Yok / Git Varsayılanı</option>';
    if (gitSettings && gitSettings.gpg_keys.length > 0) {
      gitSettings.gpg_keys.forEach((key) => {
        const sel = (appSettings.gpgKey === key.key_id || key.is_default) ? 'selected' : '';
        els.settingGpgKey.innerHTML += `<option value="${escapeHtml(key.key_id)}" ${sel}>${escapeHtml(key.key_id)} (${escapeHtml(key.uid)})</option>`;
      });
    }

    updateCommitOptionDropdowns(gitSettings);

    currentSystemInfo = await invoke('get_system_info');
    renderSystemInfo(currentSystemInfo);

    await loadSmtpSettings();

    els.settingsModal.removeAttribute('hidden');
    setStatus('Ayarlar açıldı');
  } catch (err) {
    console.error('Error opening settings:', err);
    alert(`Ayarlar yüklenirken hata oluştu: ${err}`);
  }
}

function switchAiProviderPanel(provider) {
  const ollamaPanel = document.getElementById('ollama-panel');
  const geminiPanel = document.getElementById('gemini-panel');
  const lmstudioPanel = document.getElementById('lmstudio-panel');
  if (ollamaPanel) ollamaPanel.style.display = provider === 'ollama' ? 'block' : 'none';
  if (geminiPanel) geminiPanel.style.display = provider === 'gemini' ? 'block' : 'none';
  if (lmstudioPanel) lmstudioPanel.style.display = provider === 'lmstudio' ? 'block' : 'none';
}

async function checkLmStudioStatus() {
  const specStatus = document.getElementById('spec-lmstudio-status');
  const selectLmStudio = document.getElementById('setting-lmstudio-model');
  try {
    const res = await invoke('check_lm_studio_status');
    state.lmStudioRunning = res.running;
    state.lmStudioModels = res.models || [];

    if (specStatus) {
      if (res.running) {
        specStatus.textContent = `Sunucu Çalışıyor (${res.models.length} model yüklü)`;
        specStatus.style.color = '#3fb950';
      } else {
        specStatus.textContent = 'Sunucu Çalışmıyor (127.0.0.1:1234)';
        specStatus.style.color = '#ff7b72';
      }
    }

    if (selectLmStudio) {
      selectLmStudio.innerHTML = '';
      if (res.models && res.models.length > 0) {
        const savedLm = appSettings.lmStudioModel || res.models[0];
        res.models.forEach((m) => {
          const isSel = m === savedLm ? 'selected' : '';
          selectLmStudio.innerHTML += `<option value="${escapeHtml(m)}" ${isSel}>${escapeHtml(m)}</option>`;
        });
      } else {
        selectLmStudio.innerHTML = `<option value="">${res.running ? 'LM Studio\'da yüklü model yok' : 'LM Studio Sunucusu Kapalı'}</option>`;
      }
    }
    updateAiModelSelectOptions();
    return res;
  } catch (err) {
    if (specStatus) {
      specStatus.textContent = 'LM Studio durumu kontrol edilirken hata oluştu';
      specStatus.style.color = '#ff7b72';
    }
    return { running: false, models: [] };
  }
}

function updateAiModelSelectOptions() {
  const selectEl = document.getElementById('commit-ai-model-select');
  if (!selectEl) return;

  const currentProvider = appSettings.aiProvider || 'ollama';
  let html = '';

  // 1. Ollama (Local)
  html += '<optgroup label="Ollama (Yerel)">';
  const ollamaModels = currentSystemInfo?.installed_models || ['gemma4:12b', 'gemma2:9b', 'gemma:2b'];
  const curOllama = appSettings.selectedModel || 'gemma4:12b';
  ollamaModels.forEach((m) => {
    html += `<option value="ollama:${escapeHtml(m)}">Ollama: ${escapeHtml(m)}</option>`;
  });
  html += '</optgroup>';

  // 2. Gemini (Cloud)
  html += '<optgroup label="Gemini (Bulut)">';
  const geminiList = (state.geminiModels && state.geminiModels.length > 0)
    ? state.geminiModels
    : ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  if (appSettings.geminiModel && !geminiList.includes(appSettings.geminiModel)) {
    geminiList.unshift(appSettings.geminiModel);
  }
  geminiList.forEach((m) => {
    html += `<option value="gemini:${escapeHtml(m)}">Gemini: ${escapeHtml(m)}</option>`;
  });
  html += '</optgroup>';

  // 3. LM Studio (Local)
  html += '<optgroup label="LM Studio (Yerel)">';
  const lmList = (state.lmStudioModels && state.lmStudioModels.length > 0)
    ? state.lmStudioModels
    : ['local-model'];
  if (appSettings.lmStudioModel && !lmList.includes(appSettings.lmStudioModel)) {
    lmList.unshift(appSettings.lmStudioModel);
  }
  lmList.forEach((m) => {
    html += `<option value="lmstudio:${escapeHtml(m)}">LM Studio: ${escapeHtml(m)}</option>`;
  });
  html += '</optgroup>';

  selectEl.innerHTML = html;

  // Set the selected value explicitly
  let activeVal = `ollama:${appSettings.selectedModel || 'gemma4:12b'}`;
  if (currentProvider === 'gemini') {
    activeVal = `gemini:${appSettings.geminiModel || 'gemini-2.5-flash'}`;
  } else if (currentProvider === 'lmstudio') {
    activeVal = `lmstudio:${appSettings.lmStudioModel || 'local-model'}`;
  }

  selectEl.value = activeVal;

  if (els.commitAiModelTag) {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    els.commitAiModelTag.textContent = selectedOpt ? selectedOpt.text : activeVal;
  }
}

async function fetchGeminiModels() {
  const apiKey = document.getElementById('setting-gemini-api-key')?.value?.trim() || null;
  const select = els.settingGeminiModel;
  const statusEl = els.geminiModelStatus;

  if (!apiKey && !secretStatus.geminiApiKey) {
    if (statusEl) {
      statusEl.textContent = 'Önce bir API anahtarı girin.';
      statusEl.className = 'gemini-model-status error';
    }
    return;
  }

  const savedModel = appSettings.geminiModel || '';
  if (statusEl) {
    statusEl.textContent = 'Modeller getiriliyor...';
    statusEl.className = 'gemini-model-status';
  }

  try {
    if (els.btnFetchGeminiModels) {
      els.btnFetchGeminiModels.disabled = true;
      els.btnFetchGeminiModels.textContent = 'Yükleniyor...';
    }

    const models = await invoke('list_gemini_models', { apiKey });

    if (!models || models.length === 0) {
      if (statusEl) {
        statusEl.textContent = 'Bu anahtar için generateContent modelleri bulunamadı.';
        statusEl.className = 'gemini-model-status error';
      }
      return;
    }

    state.geminiModels = models;

    if (select) {
      select.innerHTML = '';
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        select.appendChild(opt);
      });

      if (savedModel && models.includes(savedModel)) {
        select.value = savedModel;
      }
    }

    if (statusEl) {
      statusEl.textContent = `${models.length} model yüklendi.`;
      statusEl.className = 'gemini-model-status ok';
    }

    updateAiModelSelectOptions();
  } catch (err) {
    console.error('fetchGeminiModels error:', err);
    if (statusEl) {
      statusEl.textContent = `Hata: ${err}`;
      statusEl.className = 'gemini-model-status error';
    }
  } finally {
    if (els.btnFetchGeminiModels) {
      els.btnFetchGeminiModels.disabled = false;
      els.btnFetchGeminiModels.textContent = 'Yenile';
    }
  }
}

function closeSettingsModal() {
  els.settingsModal.setAttribute('hidden', '');
}

async function loadSmtpSettings() {
  try {
    const smtp = await invoke('get_smtp_settings');
    const smtpEnabled = document.getElementById('setting-smtp-enabled');
    const smtpFields = document.getElementById('smtp-config-fields');
    const smtpHost = document.getElementById('setting-smtp-host');
    const smtpPort = document.getElementById('setting-smtp-port');
    const smtpTls = document.getElementById('setting-smtp-tls');
    const smtpUsername = document.getElementById('setting-smtp-username');
    const smtpPassword = document.getElementById('setting-smtp-password');
    const smtpFrom = document.getElementById('setting-smtp-from');
    const smtpTo = document.getElementById('setting-smtp-to');

    if (smtpEnabled) smtpEnabled.checked = smtp.enabled;
    if (smtpFields) smtpFields.style.display = smtp.enabled ? 'block' : 'none';
    if (smtpHost) smtpHost.value = smtp.host || '';
    if (smtpPort) smtpPort.value = smtp.port || 587;
    if (smtpTls) smtpTls.checked = smtp.useTls !== false;
    if (smtpUsername) smtpUsername.value = smtp.username || '';
    if (smtpPassword) {
      smtpPassword.value = '';
      smtpPassword.placeholder = smtp.hasPassword
        ? '•••••••• kayıtlı (değiştirmek için yeni parola girin)'
        : 'Uygulama parolası';
    }
    if (smtpFrom) smtpFrom.value = smtp.fromEmail || '';
    if (smtpTo) smtpTo.value = smtp.toEmail || '';

    if (smtpEnabled) {
      smtpEnabled.addEventListener('change', () => {
        if (smtpFields) smtpFields.style.display = smtpEnabled.checked ? 'block' : 'none';
      });
    }
  } catch (e) {
    console.log('loadSmtpSettings error:', e);
  }
}

async function fetchAndPopulateGitSettings() {
  try {
    const gitSettings = await invoke('get_git_settings');
    state.gitIdentities = gitSettings.identities || [];
    state.gpgKeys = gitSettings.gpg_keys || [];
    updateCommitOptionDropdowns(gitSettings);
    return gitSettings;
  } catch (err) {
    console.error('Error fetching git settings:', err);
    updateCommitOptionDropdowns(null);
  }
}

function updateCommitOptionDropdowns(gitSettings) {
  let identityHtml = '';
  
  if (appSettings.gitName && appSettings.gitEmail) {
    const customVal = `${appSettings.gitName} <${appSettings.gitEmail}>`;
    identityHtml += `<option value="${escapeHtml(customVal)}">${escapeHtml(appSettings.gitName)} &lt;${escapeHtml(appSettings.gitEmail)}&gt; (Yapılandırılmış)</option>`;
  }
  
  if (gitSettings && gitSettings.current_name && gitSettings.current_email) {
    const currVal = `${gitSettings.current_name} <${gitSettings.current_email}>`;
    if (!identityHtml.includes(escapeHtml(currVal))) {
      identityHtml += `<option value="${escapeHtml(currVal)}" selected>${escapeHtml(gitSettings.current_name)} &lt;${escapeHtml(gitSettings.current_email)}&gt; (Git Varsayılanı)</option>`;
    }
  } else if (!identityHtml) {
    identityHtml += `<option value="">Varsayılan Kimlik</option>`;
  }

  if (gitSettings && gitSettings.identities && gitSettings.identities.length > 0) {
    gitSettings.identities.forEach((id) => {
      const val = `${id.name} <${id.email}>`;
      if (!identityHtml.includes(escapeHtml(val))) {
        identityHtml += `<option value="${escapeHtml(val)}">${escapeHtml(id.name)} &lt;${escapeHtml(id.email)}&gt;</option>`;
      }
    });
  }
  
  identityHtml += `<option value="__manage__">+ Ayarlar'dan Yönet...</option>`;
  els.commitIdentitySelect.innerHTML = identityHtml;

  let gpgHtml = `
    <option value="none" ${!gitSettings?.gpg_sign_enabled ? 'selected' : ''}>İmzalama Yok (--no-gpg-sign)</option>
    <option value="default" ${gitSettings?.gpg_sign_enabled ? 'selected' : ''}>Varsayılan Anahtar (-S)</option>
  `;

  if (gitSettings && gitSettings.gpg_keys && gitSettings.gpg_keys.length > 0) {
    gitSettings.gpg_keys.forEach((key) => {
      const sel = (appSettings.gpgKey === key.key_id || key.is_default) ? 'selected' : '';
      gpgHtml += `<option value="${escapeHtml(key.key_id)}" ${sel}>Anahtar: ${escapeHtml(key.key_id)} (${escapeHtml(key.uid)})</option>`;
    });
  }

  gpgHtml += `<option value="__manage__">+ Ayarlar'da Anahtarları Yönet...</option>`;
  els.commitGpgSelect.innerHTML = gpgHtml;
}

function renderSystemInfo(sys) {
  if (!sys) return;

  els.specOsDistro.textContent = sys.distro || sys.os;
  els.specRam.textContent = `${sys.ram_gb} GB RAM`;
  els.specGpu.textContent = `${sys.gpu_name} (${sys.vram_gb} GB VRAM)`;

  if (sys.ollama_installed && sys.ollama_running) {
    els.specOllamaStatus.textContent = 'Kurulu ve Çalışıyor';
    els.specOllamaStatus.style.color = '#3fb950';
    els.ollamaInstallBox.style.display = 'none';
  } else if (sys.ollama_installed) {
    els.specOllamaStatus.textContent = 'Kurulu (Servis Kapalı)';
    els.specOllamaStatus.style.color = '#d29922';
    els.ollamaInstallBox.style.display = 'none';
  } else {
    els.specOllamaStatus.textContent = 'Kurulu Değil';
    els.specOllamaStatus.style.color = '#f85149';
    els.ollamaInstallBox.style.display = 'flex';
  }

  els.recommendedModelTitle.textContent = `${sys.recommended_model} (En Çok Önerilen)`;
  const currentSel = appSettings.selectedModel || sys.recommended_model || 'gemma4:12b';
  if (els.commitAiModelTag) els.commitAiModelTag.textContent = currentSel;

  if (els.settingAiModel) {
    let html = '';
    const installedList = sys.installed_models || [];

    if (installedList.length > 0) {
      html += '<optgroup label="Yüklü Yerel Modeller">';
      installedList.forEach((m) => {
        const isSel = m === currentSel ? 'selected' : '';
        html += `<option value="${escapeHtml(m)}" ${isSel}>${escapeHtml(m)} (Yüklü)</option>`;
      });
      html += '</optgroup>';
    }

    const defaultModels = ['gemma4:12b', 'gemma2:9b', 'gemma2:27b', 'gemma:7b', 'gemma:2b'];
    html += '<optgroup label="İndirilebilir Modeller">';
    defaultModels.forEach((m) => {
      const isInst = installedList.some((inst) => inst.includes(m));
      if (!isInst) {
        const isSel = m === currentSel ? 'selected' : '';
        const rec = m === sys.recommended_model ? ' - En Çok Önerilen' : '';
        html += `<option value="${escapeHtml(m)}" ${isSel}>${escapeHtml(m)}${rec}</option>`;
      }
    });
    html += '</optgroup>';

    els.settingAiModel.innerHTML = html;
    els.settingAiModel.value = currentSel;
  }

  updateModelPullStatus(sys, currentSel);
}

function updateModelPullStatus(sys, selectedModel) {
  if (!sys) sys = currentSystemInfo;
  if (!selectedModel) selectedModel = els.settingAiModel?.value || appSettings.selectedModel || 'gemma4:12b';

  const isPulled = sys?.installed_models?.some((m) => m.includes(selectedModel));
  if (isPulled) {
    els.modelStatusText.textContent = `Durum: Model (${selectedModel}) Hazır`;
    els.btnPullModel.disabled = true;
    els.btnPullModel.textContent = 'Hazır';
  } else {
    els.modelStatusText.textContent = `Durum: Model (${selectedModel}) henüz indirilmedi`;
    els.btnPullModel.disabled = false;
    els.btnPullModel.textContent = `Modeli İndir (${selectedModel})`;
  }
}

async function saveSettings() {
  try {
    const name = els.settingGitName.value.trim();
    const email = els.settingGitEmail.value.trim();
    const signingKey = els.settingGpgKey.value;
    const gpgSign = els.settingGpgSign.checked;
    const selectedModel = els.settingAiModel.value;
    const signedOffBy = document.getElementById('commit-signed-off-by')?.checked || false;

    const radioOllama = document.getElementById('ai-provider-ollama');
    const radioGemini = document.getElementById('ai-provider-gemini');
    const radioLmStudio = document.getElementById('ai-provider-lmstudio');
    let aiProvider = 'ollama';
    if (radioGemini && radioGemini.checked) aiProvider = 'gemini';
    if (radioLmStudio && radioLmStudio.checked) aiProvider = 'lmstudio';
    const geminiKeyInput = document.getElementById('setting-gemini-api-key');
    const geminiModelSelect = document.getElementById('setting-gemini-model');
    const geminiApiKey = geminiKeyInput ? geminiKeyInput.value.trim() : '';
    const geminiModel = geminiModelSelect ? geminiModelSelect.value : 'gemini-2.5-flash';

    const smtpEnabled = document.getElementById('setting-smtp-enabled')?.checked || false;
    const smtpSettings = {
      enabled: smtpEnabled,
      host: document.getElementById('setting-smtp-host')?.value?.trim() || '',
      port: parseInt(document.getElementById('setting-smtp-port')?.value || '587', 10) || 587,
      username: document.getElementById('setting-smtp-username')?.value?.trim() || '',
      password: document.getElementById('setting-smtp-password')?.value || '',
      fromEmail: document.getElementById('setting-smtp-from')?.value?.trim() || '',
      toEmail: document.getElementById('setting-smtp-to')?.value?.trim() || '',
      useTls: document.getElementById('setting-smtp-tls')?.checked ?? true,
    };

    if (geminiApiKey) {
      await invoke('save_gemini_api_key', { apiKey: geminiApiKey });
    }
    await refreshSecretStatus();

    appSettings = {
      ...appSettings,
      aiProvider,
      geminiModel,
      selectedModel,
      gitName: name,
      gitEmail: email,
      gpgKey: signingKey,
      gpgSign,
      signedOffBy,
      smtpEnabled,
    };
    saveAppSettings(appSettings);

    if (state.repoInfo) {
      await invoke('save_git_settings', {
        name,
        email,
        signingKey: signingKey === 'none' ? '' : signingKey,
        gpgSign,
      });
    }

    try {
      await invoke('save_smtp_settings', { settings: { ...smtpSettings, hasPassword: false }, clearPassword: false });
    } catch (e) {
      console.log('SMTP save error:', e);
    }

    let displayTag = `Ollama: ${selectedModel}`;
    if (aiProvider === 'gemini') displayTag = `Gemini: ${geminiModel}`;
    if (aiProvider === 'lmstudio') {
      const lmModel = state.lmStudioModels[0] || 'local-model';
      displayTag = `LM Studio: ${lmModel}`;
    }
    if (els.commitAiModelTag) els.commitAiModelTag.textContent = displayTag;

    const uiScaleSelect = document.getElementById('setting-ui-scale');
    if (uiScaleSelect) {
      appSettings.uiScale = uiScaleSelect.value;
      applyUiScale(appSettings.uiScale);
    }

    closeSettingsModal();
    setStatus('Ayarlar başarıyla kaydedildi');
  } catch (err) {
    console.error('Error saving settings:', err);
    alert(`Ayarlar kaydedilirken hata oluştu: ${err}`);
  }
}

async function installOllama() {
  try {
    els.btnInstallOllama.disabled = true;
    els.btnInstallOllama.textContent = 'Kuruluyor...';
    setStatus('Ollama otomatik olarak kuruluyor...');

    const res = await invoke('install_ollama');
    alert(`Ollama Kurulum Sonucu: ${res}`);

    currentSystemInfo = await invoke('get_system_info');
    renderSystemInfo(currentSystemInfo);
  } catch (err) {
    console.error(err);
    alert(`Ollama Kurulum Hatası: ${err}`);
  } finally {
    els.btnInstallOllama.disabled = false;
    els.btnInstallOllama.textContent = 'Ollama\'yı Otomatik Kur';
  }
}

async function pullModel() {
  const model = appSettings.selectedModel || 'gemma4:12b';
  try {
    els.btnPullModel.disabled = true;
    els.btnPullModel.textContent = 'İndiriliyor...';
    setStatus(`Model (${model}) indiriliyor... Bu işlem birkaç dakika sürebilir.`);

    const res = await invoke('pull_ollama_model', { modelName: model });
    alert(`Model İndirme Sonucu: ${res}`);

    currentSystemInfo = await invoke('get_system_info');
    renderSystemInfo(currentSystemInfo);
  } catch (err) {
    console.error(err);
    alert(`Model İndirme Hatası: ${err}`);
  } finally {
    els.btnPullModel.disabled = false;
    els.btnPullModel.textContent = 'Modeli İndir (Pull)';
  }
}

// ─── Secret storage ─────────────────────────────────────────────────────────

async function refreshSecretStatus() {
  try {
    secretStatus = await invoke('get_secret_status');
  } catch (err) {
    console.error('Secret status error:', err);
  }
  updateGeminiKeyRemoveButton();
}

// Older versions kept the Gemini key in localStorage as plain text.
// Move it into the OS keychain once and drop the local copy.
async function migrateLegacySecrets() {
  if (appSettings.geminiApiKey) {
    try {
      await invoke('save_gemini_api_key', { apiKey: appSettings.geminiApiKey });
      delete appSettings.geminiApiKey;
      saveAppSettings(appSettings);
    } catch (err) {
      console.error('Gemini key migration failed:', err);
    }
  }
  await refreshSecretStatus();
}

function updateGeminiKeyRemoveButton() {
  const btn = document.getElementById('btn-remove-gemini-key');
  if (btn) btn.style.display = secretStatus.geminiApiKey ? '' : 'none';
}

async function removeGeminiApiKey() {
  if (!confirm('Kayıtlı Gemini API anahtarı silinsin mi?')) return;
  try {
    await invoke('save_gemini_api_key', { apiKey: '' });
    await refreshSecretStatus();
    const input = document.getElementById('setting-gemini-api-key');
    if (input) input.placeholder = 'AIza...';
    setStatus('Gemini API anahtarı silindi');
  } catch (err) {
    alert(`Anahtar silinemedi: ${err}`);
  }
}

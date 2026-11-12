const EDITOR_CONFIGS = {
  code: {
    className: 'editor-btn-vscode',
    icon: `<svg fill="none" viewBox="0 0 100 100" width="16" height="16"><mask id="a" width="100" height="100" x="0" y="0" mask-type="alpha" maskUnits="userSpaceOnUse"><path fill="#fff" fill-rule="evenodd" d="M70.912 99.317a6.22 6.22 0 0 0 4.96-.19l20.589-9.907A6.25 6.25 0 0 0 100 83.587V16.413a6.25 6.25 0 0 0-3.54-5.632L75.874.874a6.23 6.23 0 0 0-7.104 1.21L29.355 38.04 12.187 25.01a4.16 4.16 0 0 0-5.318.236l-5.506 5.009a4.17 4.17 0 0 0-.004 6.162L16.247 50 1.36 63.583a4.17 4.17 0 0 0 .004 6.162l5.506 5.01a4.16 4.16 0 0 0 5.318.236l17.168-13.032L68.77 97.917a6.2 6.2 0 0 0 2.143 1.4M75.015 27.3 45.11 50l29.906 22.701z" clip-rule="evenodd"/></mask><g mask="url(#a)"><path fill="#0065A9" d="M96.461 10.796 75.857.876a6.23 6.23 0 0 0-7.107 1.207l-67.451 61.5a4.167 4.167 0 0 0 .004 6.162l5.51 5.009a4.17 4.17 0 0 0 5.32.236l81.228-61.62c2.725-2.067 6.639-.124 6.639 3.297v-.24a6.25 6.25 0 0 0-3.539-5.63"/><g filter="url(#b)"><path fill="#007ACC" d="m96.461 89.204-20.604 9.92a6.23 6.23 0 0 1-7.107-1.207l-67.451-61.5a4.167 4.167 0 0 1 .004-6.162l5.51-5.009a4.17 4.17 0 0 1 5.32-.236l81.228 61.62c2.725 2.067 6.639.124 6.639-3.297v.24a6.25 6.25 0 0 1-3.539 5.63"/></g><g filter="url(#c)"><path fill="#1F9CF0" d="M75.858 99.126a6.23 6.23 0 0 1-7.108-1.21c2.306 2.307 6.25.674 6.25-2.588V4.672c0-3.262-3.944-4.895-6.25-2.589a6.23 6.23 0 0 1 7.108-1.21l20.6 9.908A6.25 6.25 0 0 1 100 16.413v67.174a6.25 6.25 0 0 1-3.541 5.633z"/></g><path fill="url(#d)" fill-rule="evenodd" d="M70.851 99.317a6.22 6.22 0 0 0 4.96-.19L96.4 89.22a6.25 6.25 0 0 0 3.54-5.633V16.413a6.25 6.25 0 0 0-3.54-5.632L75.812.874a6.23 6.23 0 0 0-7.104 1.21L29.294 38.04 12.126 25.01a4.16 4.16 0 0 0-5.317.236l-5.507 5.009a4.17 4.17 0 0 0-.004 6.162L16.186 50 1.298 63.583a4.17 4.17 0 0 0 .004 6.162l5.507 5.009a4.16 4.16 0 0 0 5.317.236l17.168-13.03 39.414 35.958a6.2 6.2 0 0 0 2.143 1.4M74.954 27.3 45.048 50l29.906 22.701z" clip-rule="evenodd" opacity=".25" style="mix-blend-mode:overlay"/></g><defs><filter id="b" width="116.727" height="92.246" x="-8.394" y="15.829" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset/><feGaussianBlur stdDeviation="4.167"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/><feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow"/><feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape"/></filter><filter id="c" width="47.917" height="116.151" x="60.417" y="-8.076" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset/><feGaussianBlur stdDeviation="4.167"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/><feBlend in2="BackgroundImageFix" mode="overlay" result="effect1_dropShadow"/><feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape"/></filter><linearGradient id="d" x1="49.939" x2="49.939" y1=".258" y2="99.742" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs></svg>`,
  },
  'code-oss': {
    className: 'editor-btn-codeoss',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3.5" y="2.5" width="17" height="19" rx="3.5"/>
      <line x1="8.5" y1="2.5" x2="8.5" y2="21.5"/>
      <line x1="12" y1="6.5" x2="17" y2="6.5"/>
      <line x1="14" y1="10" x2="18.5" y2="10"/>
      <line x1="14" y1="13.5" x2="18.5" y2="13.5"/>
      <line x1="14" y1="17" x2="18.5" y2="17"/>
      <line x1="12" y1="20.5" x2="17" y2="20.5"/>
    </svg>`,
  },
  zed: {
    className: 'editor-btn-zed',
    icon: `<svg viewBox="0 0 512 512" width="16" height="16"><path d="M48 32c-8.8 0-16 7.2-16 16v352H0V48C0 21.5 21.5 0 48 0h428.7c21.4 0 32.1 25.9 17 41l-264 264H304v-33h32v41c0 13.3-10.7 24-24 24H197.6l-55 55H392V192h32v200c0 17.7-14.3 32-32 32H110.6l-56 56H464c8.8 0 16-7.2 16-16V112h32v352c0 26.5-21.5 48-48 48H35.3c-21.4 0-32.1-25.9-17-41l263-263H208v32h-32v-40c0-13.3 10.7-24 24-24h113.4l56-56H120v200H88V120c0-17.7 14.3-32 32-32h281.4l56-56z" style="fill-rule:evenodd;clip-rule:evenodd;fill:#ffffff"/></svg>`,
  },
  cursor: {
    className: 'editor-btn-cursor',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.726V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/>
    </svg>`,
  },
  codium: {
    className: 'editor-btn-codium',
    icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <path d="M11.583.54a1.467 1.467 0 0 0-.441 2.032c2.426 3.758 2.999 6.592 2.75 9.075-1.004 4.756-3.187 5.721-5.094 5.721-1.863 0-1.364-3.065.036-3.962.836-.522 1.906-.861 2.728-.861.814 0 1.474-.658 1.474-1.47 0-.812-.66-1.47-1.474-1.47-.96 0-1.901.202-2.78.545.18-.847.246-1.762.014-2.735-.352-1.477-1.367-2.889-3.128-4.257a1.476 1.476 0 0 0-2.069.256c-.5.64-.384 1.564.259 2.063 1.435 1.114 1.908 1.939 2.07 2.618.162.679.032 1.407-.293 2.408-.416 1.349-.9 2.553-1.11 3.708-.105.568-.114 1.187-.14 1.68-1.034-1.006-1.438-2.336-1.438-4.279 0-.811-.66-1.47-1.474-1.47-.814.001-1.473.659-1.473 1.47 0 2.654.776 5.179 2.855 6.863 1.883 1.793 6.67 1.13 6.67 4.01 0 .812 1.19 1.208 2.004 1.208.834 0 1.885-.558 1.885-1.208 0-3.267 3.443-5.253 9.11-5.244A1.472 1.472 0 0 0 24 15.773 1.472 1.472 0 0 0 22.53 14.3c-.388 0-.765.013-1.138.035.634-1.49.915-3.13.857-4.903a1.473 1.473 0 0 0-1.522-1.42 1.472 1.472 0 0 0-1.425 1.517c.076 2.32-.01 4.393-1.74 5.485-.49.31-1.062.58-1.604.58.42-1.145.738-2.353.869-3.655.083-.83.091-1.818-.003-2.585-.148-1.188-.325-2.535.126-3.55.405-.874 1.313-1.24 2.645-1.24.814 0 1.473-.659 1.473-1.47 0-.811-.659-1.47-1.473-1.47-1.98 0-3.481 1.042-4.332 2.3-.445-.95-.987-1.929-1.642-2.943a1.474 1.474 0 0 0-2.037-.44z"/>
    </svg>`,
  },
};

async function checkAndRenderInstalledEditors() {
  if (!invoke || !els.editorActions) return;
  els.editorActions.style.display = 'none';
  els.editorActions.innerHTML = '';
  try {
    const editors = await invoke('detect_installed_editors');
    if (!editors || editors.length === 0) return;

    els.editorActions.innerHTML = editors.map((editor) => {
      const cfg = EDITOR_CONFIGS[editor.id] || {
        className: '',
        icon: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
      };

      return `
        <button class="editor-btn icon-only ${cfg.className}" type="button" data-editor-id="${escapeHtml(editor.id)}" title="${escapeHtml(editor.name)} içinde aç" aria-label="${escapeHtml(editor.name)} içinde aç">
          ${cfg.icon}
        </button>
      `;
    }).join('');

    els.editorActions.querySelectorAll('.editor-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.editorId;
        try {
          setStatus(`${id} ile açılıyor...`);
          await invoke('open_in_editor', { editorId: id });
          setStatus(`Depo ${id} ile açıldı`);
        } catch (err) {
          setStatus(`Düzenleyici açılamadı: ${err}`);
          alert(`${id} başlatılırken hata: ${err}`);
        }
      });
    });

    els.editorActions.style.display = 'flex';
  } catch (err) {
    console.error('Failed to detect editors:', err);
  }
}

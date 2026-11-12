// ─── Diff view engine ────────────────────────────────────────────────────────
//
// Renders DiffFile[] ({ old_path, new_path, status, hunks: [{ header, lines }] })
// as a unified or side-by-side view with syntax highlighting (highlight.js,
// vendored) and word-level change highlighting. Used by the commit diff and
// the PR diff modal.

const DIFF_VIEW_KEY = 'differ.diffView';
const DIFF_AUTO_COLLAPSE_LINES = 1500; // files with bigger diffs start collapsed
const WORD_DIFF_MAX_CELLS = 40000; // token LCS budget per line pair

let diffViewMode = (() => {
  try {
    return localStorage.getItem(DIFF_VIEW_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
})();

// Per-file collapsed state, keyed by "<scope>:<path>". Survives re-renders
// (e.g. switching view mode) but not commit changes.
const diffCollapsed = new Map();

function setDiffViewMode(mode) {
  diffViewMode = mode === 'split' ? 'split' : 'unified';
  try { localStorage.setItem(DIFF_VIEW_KEY, diffViewMode); } catch { /* ignore */ }
}

// ── Syntax highlighting ──

const EXT_LANGUAGE = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript',
  rs: 'rust', py: 'python', rb: 'ruby', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', swift: 'swift', m: 'objectivec', php: 'php', pl: 'perl', lua: 'lua', r: 'r',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  md: 'markdown', markdown: 'markdown', sql: 'sql', graphql: 'graphql', gql: 'graphql',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', mk: 'makefile', vb: 'vbnet',
};

const NAME_LANGUAGE = { makefile: 'makefile', 'cargo.lock': 'ini', pkgbuild: 'bash' };

function diffLanguageForPath(path = '') {
  if (!window.hljs) return null;
  const name = path.split('/').pop().toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const lang = NAME_LANGUAGE[name] || EXT_LANGUAGE[ext];
  return lang && window.hljs.getLanguage(lang) ? lang : null;
}

function highlightCode(code, lang) {
  if (!lang || !code) return escapeHtml(code);
  try {
    return window.hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

// ── Word-level diff ──

function tokenizeLine(text) {
  return text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || [];
}

/**
 * Returns segments for both sides: [{ text, changed }]. Uses a token LCS,
 * falling back to common prefix/suffix for very long lines.
 */
function wordDiff(oldText, newText) {
  const a = tokenizeLine(oldText);
  const b = tokenizeLine(newText);

  if (a.length * b.length > WORD_DIFF_MAX_CELLS) {
    let p = 0;
    while (p < oldText.length && p < newText.length && oldText[p] === newText[p]) p += 1;
    let s = 0;
    while (s < oldText.length - p && s < newText.length - p
      && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s += 1;
    const split = (t) => [
      { text: t.slice(0, p), changed: false },
      { text: t.slice(p, t.length - s), changed: true },
      { text: t.slice(t.length - s), changed: false },
    ].filter((seg) => seg.text);
    return { oldSegs: split(oldText), newSegs: split(newText), similarity: (p + s) / Math.max(oldText.length, newText.length, 1) };
  }

  // LCS table
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const oldSegs = [];
  const newSegs = [];
  const push = (segs, text, changed) => {
    const last = segs[segs.length - 1];
    if (last && last.changed === changed) last.text += text;
    else segs.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  let common = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(oldSegs, a[i], false);
      push(newSegs, b[j], false);
      common += a[i].length;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(oldSegs, a[i], true);
      i += 1;
    } else {
      push(newSegs, b[j], true);
      j += 1;
    }
  }
  while (i < n) push(oldSegs, a[i++], true);
  while (j < m) push(newSegs, b[j++], true);

  return { oldSegs, newSegs, similarity: common / Math.max(oldText.length, newText.length, 1) };
}

function renderSegments(segs, lang) {
  return segs.map((seg) => (seg.changed
    ? `<span class="word-change">${highlightCode(seg.text, lang)}</span>`
    : highlightCode(seg.text, lang))).join('');
}

// ── Row model ──

function lineText(line) {
  return (line.content || '').replace(/\r?\n$/, '');
}

/**
 * Converts a hunk into rows. Runs of deleted lines followed by added lines
 * are paired so changed words can be highlighted and so the split view can
 * show them side by side.
 *   { kind: 'context', old, new }
 *   { kind: 'change', old: line|null, new: line|null }
 * Each line object gets an `html` field.
 */
function buildHunkRows(hunk, lang) {
  const rows = [];
  const lines = hunk.lines;
  let k = 0;

  while (k < lines.length) {
    const line = lines[k];
    if (line.line_type !== 'add' && line.line_type !== 'delete') {
      rows.push({ kind: 'context', old: line, new: line, html: highlightCode(lineText(line), lang) });
      k += 1;
      continue;
    }

    const dels = [];
    const adds = [];
    while (k < lines.length && lines[k].line_type === 'delete') dels.push(lines[k++]);
    while (k < lines.length && lines[k].line_type === 'add') adds.push(lines[k++]);

    const pairs = Math.max(dels.length, adds.length);
    for (let p = 0; p < pairs; p += 1) {
      const del = dels[p] || null;
      const add = adds[p] || null;
      let delHtml = del ? highlightCode(lineText(del), lang) : '';
      let addHtml = add ? highlightCode(lineText(add), lang) : '';
      if (del && add) {
        const wd = wordDiff(lineText(del), lineText(add));
        // Only mark words when the lines are actually related.
        if (wd.similarity >= 0.3) {
          delHtml = renderSegments(wd.oldSegs, lang);
          addHtml = renderSegments(wd.newSegs, lang);
        }
      }
      rows.push({ kind: 'change', old: del, new: add, oldHtml: delHtml, newHtml: addHtml });
    }
  }
  return rows;
}

function unifiedRowsHtml(rows) {
  const out = [];
  let block = [];
  // Within a change block show all deletions first, then all additions (like git).
  const flush = () => {
    block.forEach((r) => { if (r.old) out.push(diffLineHtml('delete', r.old.old_lineno, null, r.oldHtml)); });
    block.forEach((r) => { if (r.new) out.push(diffLineHtml('add', null, r.new.new_lineno, r.newHtml)); });
    block = [];
  };
  for (const row of rows) {
    if (row.kind === 'context') {
      flush();
      out.push(diffLineHtml('context', row.old.old_lineno, row.new.new_lineno, row.html));
    } else {
      block.push(row);
    }
  }
  flush();
  return out.join('');
}

function diffLineHtml(type, oldNo, newNo, html) {
  return `<div class="diff-line ${type}">`
    + `<span class="diff-line-num">${oldNo || ''}</span>`
    + `<span class="diff-line-num">${newNo || ''}</span>`
    + `<span class="diff-line-content">${html}</span></div>`;
}

function splitRowsHtml(rows) {
  return rows.map((row) => {
    if (row.kind === 'context') {
      return `<div class="diff-split-row">${splitCell('context', row.old.old_lineno, row.html)}${splitCell('context', row.new.new_lineno, row.html)}</div>`;
    }
    const left = row.old ? splitCell('delete', row.old.old_lineno, row.oldHtml) : splitCell('empty', '', '');
    const right = row.new ? splitCell('add', row.new.new_lineno, row.newHtml) : splitCell('empty', '', '');
    return `<div class="diff-split-row">${left}${right}</div>`;
  }).join('');
}

function splitCell(type, lineNo, html) {
  return `<span class="diff-line-num ${type}">${lineNo || ''}</span><span class="diff-split-content ${type}">${html}</span>`;
}

function fileDiffStats(file) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.line_type === 'add') additions += 1;
      else if (line.line_type === 'delete') deletions += 1;
    }
  }
  return { additions, deletions };
}

function renderDiffFileBody(file) {
  if (!file.hunks.length) {
    return '<div class="diff-placeholder">Dosya değişti fakat gösterilecek satır yok (ikili dosya veya yalnızca izin değişikliği).</div>';
  }
  const lang = diffLanguageForPath(file.new_path || file.old_path);
  return file.hunks.map((hunk) => {
    const rows = buildHunkRows(hunk, lang);
    const body = diffViewMode === 'split' ? splitRowsHtml(rows) : unifiedRowsHtml(rows);
    return `<div class="diff-hunk ${diffViewMode}">
      <div class="diff-hunk-header">${escapeHtml(hunk.header.trim())}</div>
      ${body}
    </div>`;
  }).join('');
}

/**
 * Renders files into `container`. `scope` namespaces collapse state and
 * element ids so several diff views can coexist (commit view, PR modal).
 */
function renderDiffFiles(files, container, { scope = 'commit', idPrefix = 'diff-file-' } = {}) {
  const statusMap = typeof statusConfig !== 'undefined' ? statusConfig : {};

  container.innerHTML = files.map((file, index) => {
    const path = file.new_path || file.old_path;
    const renamed = file.old_path && file.new_path && file.old_path !== file.new_path;
    const config = statusMap[file.status] || statusMap.unknown || { label: '?', text: '' };
    const stats = fileDiffStats(file);
    const key = `${scope}:${path}`;
    if (!diffCollapsed.has(key)) diffCollapsed.set(key, stats.additions + stats.deletions > DIFF_AUTO_COLLAPSE_LINES);
    const collapsed = diffCollapsed.get(key);

    return `
      <section class="diff-file-block ${collapsed ? 'collapsed' : ''}" id="${idPrefix}${index}" data-diff-key="${escapeHtml(key)}" data-file-idx="${index}">
        <div class="diff-file-header" role="button" tabindex="0" title="Daralt / genişlet">
          <svg class="diff-file-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          <span class="file-status ${file.status}">${config.label}</span>
          <span class="diff-file-path">${renamed ? `${escapeHtml(file.old_path)} → ` : ''}${escapeHtml(path)}</span>
          <span class="diff-file-stats"><b class="positive">+${stats.additions}</b> <b class="negative">-${stats.deletions}</b></span>
          <small>${config.text || ''}</small>
        </div>
        <div class="diff-file-body">${collapsed ? '' : renderDiffFileBody(file)}</div>
      </section>
    `;
  }).join('');

  container.querySelectorAll('.diff-file-block').forEach((block) => {
    const header = block.querySelector('.diff-file-header');
    const toggle = () => toggleDiffFile(block, files[Number(block.dataset.fileIdx)]);
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
}

function toggleDiffFile(block, file, forceOpen = null) {
  const key = block.dataset.diffKey;
  const open = forceOpen ?? block.classList.contains('collapsed');
  diffCollapsed.set(key, !open);
  block.classList.toggle('collapsed', !open);
  const body = block.querySelector('.diff-file-body');
  // Bodies of collapsed files are rendered lazily.
  if (open && !body.innerHTML.trim()) body.innerHTML = renderDiffFileBody(file);
}

function setAllDiffFilesOpen(container, files, open) {
  container.querySelectorAll('.diff-file-block').forEach((block) => {
    toggleDiffFile(block, files[Number(block.dataset.fileIdx)], open);
  });
}

// ── Unified diff text parser (for `gh pr diff` output) ──

function parseUnifiedDiff(text = '') {
  const files = [];
  let file = null;
  let hunk = null;
  let oldNo = 0;
  let newNo = 0;
  const stripPrefix = (p) => p.replace(/^[ab]\//, '');

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/^diff --git a\/(.*) b\/(.*)$/);
      file = { old_path: m ? m[1] : '', new_path: m ? m[2] : '', status: 'modified', hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (raw.startsWith('new file mode')) file.status = 'added';
      else if (raw.startsWith('deleted file mode')) file.status = 'deleted';
      else if (raw.startsWith('rename from ')) { file.status = 'renamed'; file.old_path = raw.slice(12); }
      else if (raw.startsWith('rename to ')) file.new_path = raw.slice(10);
      else if (raw.startsWith('--- ')) { if (raw !== '--- /dev/null') file.old_path = stripPrefix(raw.slice(4)); }
      else if (raw.startsWith('+++ ')) { if (raw !== '+++ /dev/null') file.new_path = stripPrefix(raw.slice(4)); }
    }

    const hm = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hm) {
      oldNo = Number(hm[1]);
      newNo = Number(hm[2]);
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const sign = raw[0];
    const content = raw.slice(1);
    if (sign === '+') hunk.lines.push({ content, line_type: 'add', old_lineno: null, new_lineno: newNo++ });
    else if (sign === '-') hunk.lines.push({ content, line_type: 'delete', old_lineno: oldNo++, new_lineno: null });
    else if (sign === ' ') hunk.lines.push({ content, line_type: 'context', old_lineno: oldNo++, new_lineno: newNo++ });
    // "\ No newline at end of file" and trailing blank lines are ignored.
  }

  for (const f of files) {
    if (f.status === 'added' && !f.new_path) f.new_path = f.old_path;
    if (f.status === 'deleted' && !f.old_path) f.old_path = f.new_path;
  }
  return files;
}

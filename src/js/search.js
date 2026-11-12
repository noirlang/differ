// ─── Commit search ───────────────────────────────────────────────────────────
//
// Query syntax (Turkish and English keys):
//   login                 free text: message, author name/e-mail, hash
//   yazar:ali  author:ali author name or e-mail
//   dosya:src/app.js      commits touching a file or folder (file:, path:)
//   hash:abc123           a single commit
//   tarih>2026-01-01      since (also since:, after:)
//   tarih<2026-02-01      until (also until:, before:)
// Values with spaces can be quoted: yazar:"Ali Veli"

const SEARCH_KEYS = {
  yazar: 'author', author: 'author',
  dosya: 'path', file: 'path', path: 'path',
  hash: 'hash', commit: 'hash',
  since: 'since', after: 'since',
  until: 'until', before: 'until',
};

const SEARCH_LIMIT = 500;
let searchDebounceTimer = null;
let searchRequestSeq = 0;

function parseSearchQuery(raw = '') {
  const q = { text: '', author: '', hash: '', path: '', since: '', until: '' };
  const words = [];
  const tokenRe = /([\p{L}\w]+)(:|>=?|<=?)("([^"]*)"|\S+)|"([^"]*)"|(\S+)/gu;
  let m;
  while ((m = tokenRe.exec(raw)) !== null) {
    const [, key, op, rawValue, quoted, quotedWord, word] = m;
    if (key) {
      const value = quoted ?? rawValue;
      const k = key.toLowerCase();
      if ((k === 'tarih' || k === 'date') && op.startsWith('>')) { q.since = value; continue; }
      if ((k === 'tarih' || k === 'date') && op.startsWith('<')) { q.until = value; continue; }
      if (op === ':' && SEARCH_KEYS[k]) { q[SEARCH_KEYS[k]] = value; continue; }
      words.push(m[0]); // unknown key: treat as plain text, e.g. "fix:typo"
      continue;
    }
    words.push(quotedWord ?? word);
  }
  q.text = words.join(' ').trim();
  return q;
}

function isSearchEmpty(q) {
  return !q.text && !q.author && !q.hash && !q.path && !q.since && !q.until;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses YYYY-MM-DD into a unix timestamp (local time); null if not a plain date. */
function searchDateToTs(value, endOfDay = false) {
  if (!ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  return Number.isNaN(d.getTime()) ? null : Math.floor(d.getTime() / 1000);
}

/** True when the query can't be answered from the commits already loaded. */
function searchNeedsBackend(q) {
  if (isSearchEmpty(q)) return false;
  const historyTruncated = state.commits.length >= SEARCH_LIMIT;
  return Boolean(
    q.path
    || (q.since && searchDateToTs(q.since) === null)
    || (q.until && searchDateToTs(q.until, true) === null)
    || historyTruncated,
  );
}

function matchesLocalSearch(commit, q) {
  const has = (haystack, needle) => haystack.toLowerCase().includes(needle.toLowerCase());
  if (q.text) {
    const hit = has(commit.message, q.text)
      || has(commit.author_name, q.text)
      || has(commit.author_email, q.text)
      || commit.id.startsWith(q.text.toLowerCase());
    if (!hit) return false;
  }
  if (q.author && !has(commit.author_name, q.author) && !has(commit.author_email, q.author)) return false;
  if (q.hash && !commit.id.startsWith(q.hash.toLowerCase())) return false;
  const since = q.since ? searchDateToTs(q.since) : null;
  const until = q.until ? searchDateToTs(q.until, true) : null;
  if (since !== null && commit.timestamp < since) return false;
  if (until !== null && commit.timestamp > until) return false;
  return true;
}

/** Escapes text and wraps case-insensitive matches of `term` in <mark>. */
function highlightMatch(text, term) {
  if (!term) return escapeHtml(text);
  const lower = text.toLowerCase();
  const needle = term.toLowerCase();
  let out = '';
  let from = 0;
  let idx;
  while ((idx = lower.indexOf(needle, from)) !== -1) {
    out += escapeHtml(text.slice(from, idx));
    out += `<mark class="search-hit">${escapeHtml(text.slice(idx, idx + needle.length))}</mark>`;
    from = idx + needle.length;
  }
  return out + escapeHtml(text.slice(from));
}

function activeSearchText() {
  return state.searchQuery ? parseSearchQuery(state.searchQuery).text : '';
}

/** The base commit list for the current search: backend results or loaded commits. */
function searchBaseCommits() {
  const r = state.searchResults;
  if (r && r.query === state.searchQuery && r.branch === state.selectedBranch) return { commits: r.commits, fromBackend: true };
  return { commits: state.commits, fromBackend: false };
}

function onSearchInput(value) {
  state.searchQuery = value.trim();
  state.searchResults = null;
  renderCommits();

  window.clearTimeout(searchDebounceTimer);
  const q = parseSearchQuery(state.searchQuery);
  state.searchPending = searchNeedsBackend(q);
  if (!state.searchPending) {
    if (state.searchQuery) setStatus(`${state.filteredCommitIds.length} sonuç`);
    return;
  }
  setStatus('Tüm geçmişte aranıyor...');
  searchDebounceTimer = window.setTimeout(() => runBackendSearch(state.searchQuery, q), 300);
}

async function runBackendSearch(query, q) {
  const seq = ++searchRequestSeq;
  const branch = state.selectedBranch;
  const toGitDate = (v, end) => (ISO_DATE.test(v) ? `${v} ${end ? '23:59:59' : '00:00:00'}` : v);
  try {
    const commits = await invoke('search_commits', {
      search: { ...q, since: toGitDate(q.since, false), until: toGitDate(q.until, true) },
      branch,
      targetRemote: state.activeRemote,
      limit: SEARCH_LIMIT,
    });
    if (seq !== searchRequestSeq || query !== state.searchQuery) return; // stale
    state.searchResults = { query, branch, commits };
    state.searchPending = false;
    renderCommits();
    const more = commits.length >= SEARCH_LIMIT ? ` (ilk ${SEARCH_LIMIT})` : '';
    setStatus(`${state.filteredCommitIds.length} sonuç, tüm geçmiş${more}`);
  } catch (err) {
    if (seq !== searchRequestSeq) return;
    state.searchPending = false;
    renderCommits();
    setStatus(`Arama başarısız: ${err}`);
  }
}

function clearSearch() {
  els.searchInput.value = '';
  onSearchInput('');
}

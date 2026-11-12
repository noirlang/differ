const GRAPH_CONFIG = {
  rowHeight: 46,
  cy: 23,
  laneWidth: 20,
  laneOffset: 16,
  strokeWidth: 2.5,
  dotRadius: 5,
  mergeDotRadius: 6,
};

function assignLanes(commits) {
  const commitCount = commits.length;
  const commitIndexMap = new Map();
  commits.forEach((c, i) => commitIndexMap.set(c.id, i));

  const laneMap = new Map();
  const activeLanes = [];
  let maxLane = 0;

  for (let i = 0; i < commitCount; i++) {
    const commit = commits[i];
    let lane = activeLanes.indexOf(commit.id);

    if (lane === -1) {
      if (i === 0 || activeLanes[0] === null || activeLanes[0] === undefined) {
        lane = 0;
      } else {
        let freeIdx = -1;
        for (let l = 1; l < activeLanes.length; l++) {
          if (activeLanes[l] === null) {
            freeIdx = l;
            break;
          }
        }
        lane = freeIdx !== -1 ? freeIdx : Math.max(1, activeLanes.length);
      }
    }

    activeLanes[lane] = null;
    laneMap.set(commit.id, lane);
    maxLane = Math.max(maxLane, lane);

    const validParents = (commit.parent_ids || []).filter((pid) => commitIndexMap.has(pid));
    if (validParents.length > 0) {
      const p0 = validParents[0];
      if (activeLanes.indexOf(p0) === -1) {
        activeLanes[lane] = p0;
      }

      for (let p = 1; p < validParents.length; p++) {
        const pOther = validParents[p];
        if (activeLanes.indexOf(pOther) === -1) {
          let freeL = -1;
          for (let l = 1; l < activeLanes.length; l++) {
            if (activeLanes[l] === null) {
              freeL = l;
              break;
            }
          }
          if (freeL === -1) {
            freeL = Math.max(1, activeLanes.length);
          }
          activeLanes[freeL] = pOther;
          maxLane = Math.max(maxLane, freeL);
        }
      }
    }
  }

  return { laneMap, laneCount: Math.max(maxLane + 1, 1), maxLane };
}

function buildCommitGraph(commits) {
  const count = commits.length;
  if (count === 0) {
    return {
      laneMap: new Map(),
      laneCount: 1,
      graphWidth: 50,
      rowSvgs: [],
    };
  }

  const commitIndexMap = new Map();
  commits.forEach((c, i) => commitIndexMap.set(c.id, i));

  const { laneMap, laneCount, maxLane } = assignLanes(commits);

  // Distinct branch color assignment:
  // Lane 0 is always GRAPH_PALETTE[0] (#eab308 golden trunk).
  // Each branch chain gets a distinct vibrant color from GRAPH_PALETTE[1..7].
  const commitColorMap = new Map();
  let branchColorSeq = 1;

  for (let i = 0; i < count; i++) {
    const commit = commits[i];
    const lane = laneMap.get(commit.id) || 0;
    if (lane === 0) {
      commitColorMap.set(commit.id, GRAPH_PALETTE[0]);
    } else if (!commitColorMap.has(commit.id)) {
      const color = GRAPH_PALETTE[1 + ((branchColorSeq - 1) % (GRAPH_PALETTE.length - 1))];
      commitColorMap.set(commit.id, color);
      branchColorSeq++;
    }

    if ((commit.parent_ids || []).length > 1) {
      for (let p = 1; p < commit.parent_ids.length; p++) {
        const pId = commit.parent_ids[p];
        if (!commitColorMap.has(pId)) {
          const color = GRAPH_PALETTE[1 + ((branchColorSeq - 1) % (GRAPH_PALETTE.length - 1))];
          commitColorMap.set(pId, color);
          branchColorSeq++;
        }
      }
    }

    if (lane > 0 && (commit.parent_ids || []).length > 0) {
      const myColor = commitColorMap.get(commit.id);
      const p0 = commit.parent_ids[0];
      const p0Lane = laneMap.get(p0) || 0;
      if (p0Lane > 0 && !commitColorMap.has(p0)) {
        commitColorMap.set(p0, myColor);
      }
    }
  }

  // Construct edges
  const edges = [];
  for (let i = 0; i < count; i++) {
    const commit = commits[i];
    const cLane = laneMap.get(commit.id) || 0;
    (commit.parent_ids || []).forEach((pid) => {
      if (commitIndexMap.has(pid)) {
        const pIdx = commitIndexMap.get(pid);
        const pLane = laneMap.get(pid) || 0;
        let edgeColor = GRAPH_PALETTE[0];
        if (cLane > 0) {
          edgeColor = commitColorMap.get(commit.id) || GRAPH_PALETTE[1];
        } else if (pLane > 0) {
          edgeColor = commitColorMap.get(pid) || GRAPH_PALETTE[1];
        }
        edges.push({
          from: i,
          to: pIdx,
          fromLane: cLane,
          toLane: pLane,
          color: edgeColor,
        });
      }
    });
  }

  const graphWidth = Math.max(50, laneCount * GRAPH_CONFIG.laneWidth + 24);
  const getX = (lane) => GRAPH_CONFIG.laneOffset + lane * GRAPH_CONFIG.laneWidth;

  const rowSvgs = commits.map((commit, r) => {
    const cLane = laneMap.get(commit.id) || 0;
    const cColor = commitColorMap.get(commit.id) || GRAPH_PALETTE[0];
    const cx = getX(cLane);
    const cy = GRAPH_CONFIG.cy;
    const sw = GRAPH_CONFIG.strokeWidth;

    const paths = [];
    const drawnKeys = new Set();

    const addPath = (key, svgStr) => {
      if (!drawnKeys.has(key)) {
        drawnKeys.add(key);
        paths.push(svgStr);
      }
    };

    edges.forEach((e) => {
      if (r < e.from || r > e.to) return;
      const xFrom = getX(e.fromLane);
      const xTo = getX(e.toLane);

      if (e.fromLane === e.toLane) {
        if (r === e.from) {
          addPath(`down_${xFrom}`, `<line x1="${xFrom}" y1="${cy}" x2="${xFrom}" y2="46" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;" />`);
        } else if (r === e.to) {
          addPath(`up_${xFrom}`, `<line x1="${xFrom}" y1="0" x2="${xFrom}" y2="${cy}" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;" />`);
        } else {
          addPath(`pass_${xFrom}`, `<line x1="${xFrom}" y1="0" x2="${xFrom}" y2="46" stroke="${e.color}" stroke-width="${sw}" style="stroke:${e.color}!important;" />`);
        }
      } else {
        if (e.to === e.from + 1) {
          if (r === e.from) {
            addPath(`curve_${xFrom}_${xTo}_${e.color}`, `<path d="M ${xFrom} ${cy} C ${xFrom} 35.65, ${xTo} 33.35, ${xTo} 46" fill="none" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;fill:none!important;" />`);
          } else if (r === e.to) {
            addPath(`up_${xTo}`, `<line x1="${xTo}" y1="0" x2="${xTo}" y2="${cy}" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;" />`);
          }
        } else {
          if (e.fromLane < e.toLane) {
            if (r === e.from) {
              addPath(`curve_${xFrom}_${xTo}_${e.color}`, `<path d="M ${xFrom} ${cy} C ${xFrom} 35.65, ${xTo} 33.35, ${xTo} 46" fill="none" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;fill:none!important;" />`);
            } else if (r === e.to) {
              addPath(`up_${xTo}`, `<line x1="${xTo}" y1="0" x2="${xTo}" y2="${cy}" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;" />`);
            } else {
              addPath(`pass_${xTo}`, `<line x1="${xTo}" y1="0" x2="${xTo}" y2="46" stroke="${e.color}" stroke-width="${sw}" style="stroke:${e.color}!important;" />`);
            }
          } else {
            if (r === e.from) {
              addPath(`down_${xFrom}`, `<line x1="${xFrom}" y1="${cy}" x2="${xFrom}" y2="46" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;" />`);
            } else if (r === e.to - 1) {
              addPath(`curve_in_${xFrom}_${xTo}_${e.color}`, `<path d="M ${xFrom} 0 C ${xFrom} 23, ${xTo} 23, ${xTo} 46" fill="none" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;fill:none!important;" />`);
            } else if (r === e.to) {
              addPath(`up_${xTo}`, `<line x1="${xTo}" y1="0" x2="${xTo}" y2="${cy}" stroke="${e.color}" stroke-width="${sw}" stroke-linecap="round" style="stroke:${e.color}!important;" />`);
            } else {
              addPath(`pass_${xFrom}`, `<line x1="${xFrom}" y1="0" x2="${xFrom}" y2="46" stroke="${e.color}" stroke-width="${sw}" style="stroke:${e.color}!important;" />`);
            }
          }
        }
      }
    });

    const hasUnresolvedParent = (commit.parent_ids || []).some((pid) => !commitIndexMap.has(pid));
    if (hasUnresolvedParent) {
      addPath(`missing_stem_${cx}`, `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="46" stroke="${cColor}" stroke-width="${sw}" stroke-dasharray="3 3" opacity="0.6" stroke-linecap="round" style="stroke:${cColor}!important;" />`);
    }

    const isMerge = (commit.parent_ids || []).length > 1;
    if (isMerge) {
      paths.push(`<circle cx="${cx}" cy="${cy}" r="${GRAPH_CONFIG.mergeDotRadius}" fill="${cColor}" stroke="#141416" stroke-width="2.5" style="fill:${cColor}!important;stroke:#141416!important;" />`);
      paths.push(`<circle cx="${cx}" cy="${cy}" r="2.2" fill="#141416" stroke="#141416" style="fill:#141416!important;stroke:#141416!important;" />`);
    } else {
      paths.push(`<circle cx="${cx}" cy="${cy}" r="${GRAPH_CONFIG.dotRadius}" fill="${cColor}" stroke="#141416" stroke-width="2" style="fill:${cColor}!important;stroke:#141416!important;" />`);
    }

    return paths.join('');
  });

  return {
    laneMap,
    laneCount,
    graphWidth,
    rowSvgs,
  };
}

function renderCommits() {
  const commits = getFilteredCommits();
  state.filteredCommitIds = commits.map((commit) => commit.id);

  if (commits.length === 0) {
    const isRepoEmpty = state.commits.length === 0;
    els.commitList.innerHTML = isRepoEmpty
      ? `
        <div class="empty-state compact" style="padding: 40px 20px; text-align: center;">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px; color: var(--text-dim); display: block;">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 8v4l3 3"></path>
          </svg>
          <strong style="font-size: 14px; display: block; margin-bottom: 6px;">Depoda henüz commit yok</strong>
          <span style="font-size: 12px; color: var(--text-dim);">Bu Git deposunda henüz commit bulunmuyor. Soldan dosyaları hazırlayıp ilk commit'inizi oluşturun!</span>
        </div>
      `
      : `
        <div class="empty-state compact">
          <strong>Sonuç bulunamadı</strong>
          <span>Arama kriterine veya seçili dala uygun commit bulunamadı.</span>
        </div>
      `;
    return;
  }

  const unpushedCommits = commits.filter((c) => c.is_unpushed);
  if (els.unpushedBanner) {
    if (unpushedCommits.length > 0) {
      els.unpushedBanner.style.display = 'flex';
      els.unpushedBannerCount.textContent = unpushedCommits.length;
      if (els.unpushedBannerRemote) {
        els.unpushedBannerRemote.textContent = state.activeRemote || 'origin';
      }
      els.unpushedCommitList.innerHTML = unpushedCommits.map((c) => `
        <div class="unpushed-commit-card" data-commit-id="${c.id}">
          <div class="unpushed-commit-info">
            <span class="unpushed-hash">${c.short_id}</span>
            <span class="unpushed-msg">${escapeHtml(firstLine(c.message))}</span>
          </div>
          <div class="unpushed-meta">
            <span>${escapeHtml(c.author_name || 'Bilinmiyor')}</span>
            <span>&bull; ${formatDate(c.timestamp)}</span>
            <span class="commit-state-label unpushed-badge">GÖNDERİLMEDİ</span>
          </div>
        </div>
      `).join('');

      els.unpushedCommitList.querySelectorAll('.unpushed-commit-card').forEach((card) => {
        card.addEventListener('click', () => selectCommit(card.dataset.commitId));
      });
    } else {
      els.unpushedBanner.style.display = 'none';
    }
  }

  const branchLabels = new Map();
  state.branches.forEach((branch) => {
    if (!branch.commit_id) return;
    if (!branchLabels.has(branch.commit_id)) branchLabels.set(branch.commit_id, []);
    branchLabels.get(branch.commit_id).push(branch);
  });

  const { laneMap, laneCount, graphWidth, rowSvgs } = buildCommitGraph(commits);

  if (els.commitList) {
    els.commitList.style.setProperty('--graph-col-width', `${graphWidth}px`);
  }
  if (els.commitListHeader) {
    els.commitListHeader.style.setProperty('--graph-col-width', `${graphWidth}px`);
  }

  els.commitList.innerHTML = commits.map((commit, index) => {
    const lane = laneMap.get(commit.id) || 0;
    const color = getGraphColor(lane);
    const rowSvg = rowSvgs[index] || '';
    const labels = (branchLabels.get(commit.id) || []).slice(0, 3).map((branch) => (
      `<span class="branch-label ${branch.is_remote ? 'remote' : 'local'}">${escapeHtml(branch.name)}</span>`
    )).join('');
    const selected = state.selectedCommit === commit.id ? 'selected' : '';
    const localOnly = commit.is_unpushed ? 'local-only' : '';
    const syncLabel = commit.is_unpushed ? '<span class="commit-state-label unpushed-badge">gönderilmedi</span>' : '';

    const coauthors = parseCoauthorsFromMessage(commit.message);
    const coauthorsTitle = coauthors.length > 0 ? ` + Ortak yazar: ${coauthors.map(c => c.name).join(', ')}` : '';
    const avatarHtml = coauthors.length > 0
      ? `<span class="avatar-stack" title="${escapeHtml(commit.author_name || 'Bilinmiyor')}${escapeHtml(coauthorsTitle)}">
           ${renderAuthorAvatar(commit)}
           ${coauthors.map(co => renderAuthorAvatar(co, 'mini')).join('')}
         </span>`
      : renderAuthorAvatar(commit);

    return `
      <div class="commit-row ${selected} ${localOnly}" role="button" tabindex="0" data-commit-id="${commit.id}" style="--row-delay:${Math.min(index * 12, 220)}ms">
        <span class="commit-graph-cell" style="--lane:${lane};--lane-count:${laneCount};--graph-color:${color};">
          <svg class="graph-svg" style="width:${graphWidth}px;height:46px;display:block;" width="${graphWidth}" height="46" viewBox="0 0 ${graphWidth} 46" aria-hidden="true">
            ${rowSvg}
          </svg>
        </span>
        <span class="commit-message-cell">
          <span class="commit-hash" title="${escapeHtml(commit.id || '')}">${escapeHtml(commit.short_id || (commit.id || '').substring(0, 7))}</span>
          <button class="btn-edit-commit-pencil" type="button" data-commit-id="${commit.id}" title="Commit formuna yükle">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          ${labels ? `<span class="branch-labels">${labels}</span>` : ''}
          ${syncLabel}
          <span class="commit-message" title="${escapeHtml(firstLine(commit.message))}">${escapeHtml(firstLine(commit.message))}</span>
        </span>
        <span class="commit-author-cell">
          ${avatarHtml}
          <span class="author-name" title="${escapeHtml(commit.author_name || 'Bilinmiyor')}${escapeHtml(coauthorsTitle)}">${escapeHtml(commit.author_name || 'Bilinmiyor')}</span>
        </span>
        <span class="commit-date-cell">${formatDate(commit.timestamp)}</span>
      </div>
    `;
  }).join('');

  els.commitList.querySelectorAll('.commit-row').forEach((row) => {
    row.addEventListener('click', () => selectCommit(row.dataset.commitId));
  });
  els.commitList.querySelectorAll('.btn-edit-commit-pencil').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadCommitIntoForm(btn.dataset.commitId);
    });
  });
  hydrateAvatarFallbacks(els.commitList);
  queueGithubAvatarFetches(commits.slice(0, 40));
}

function loadCommitIntoForm(commitId) {
  const commit = state.commits.find((c) => c.id === commitId);
  if (!commit) return;

  const rawMsg = commit.message || '';
  const lines = rawMsg.split('\n');

  const coauthors = [];
  let isSignedOff = false;
  const mainMsgLines = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^co-authored-by:/i.test(trimmed)) {
      const match = trimmed.match(/^co-authored-by:\s*(.*?)\s*<(.*?)>/i);
      if (match) {
        coauthors.push({ name: match[1].trim(), email: match[2].trim() });
      } else {
        const raw = trimmed.replace(/^co-authored-by:\s*/i, '').trim();
        if (raw) coauthors.push({ name: raw, email: '' });
      }
    } else if (/^signed-off-by:/i.test(trimmed)) {
      isSignedOff = true;
    } else {
      mainMsgLines.push(line);
    }
  });

  const cleanMsg = mainMsgLines.join('\n').trim();
  els.commitMessageInput.value = cleanMsg;

  const signedOffCheckbox = document.getElementById('commit-signed-off-by');
  if (signedOffCheckbox) {
    signedOffCheckbox.checked = isSignedOff;
  }

  state.selectedCoauthors = coauthors;
  renderCoauthors();

  state.editingCommitId = commitId;
  updateCommitAction();

  els.commitMessageInput.focus();
  els.commitMessageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });

  setStatus(`${commit.short_id} commit'i düzenleme formuna yüklendi.`);
}

async function selectCommit(commitId) {
  const commit = state.commits.find((item) => item.id === commitId);
  if (!commit) return;

  state.selectedCommit = commitId;
  setStatus(`${commit.short_id} için diff okunuyor...`);
  renderCommits();

  els.detailEmpty.style.display = 'none';
  els.detailContent.style.display = 'flex';

  els.detailAvatar.innerHTML = renderAuthorAvatar(commit, 'large');
  els.detailMessage.textContent = firstLine(commit.message);
  els.detailAuthor.textContent = `${commit.author_name || 'Bilinmiyor'}${commit.author_email ? ` <${commit.author_email}>` : ''}`;
  els.detailDate.textContent = formatFullDate(commit.timestamp);
  els.detailHash.textContent = commit.id;
  hydrateAvatarFallbacks(els.detailAvatar);
  queueGithubAvatarFetches([commit]);

  renderCommitDescription(commit);
  activateDetailTab(state.detailTab);

  try {
    await Promise.all([
      loadCommitDiff(commitId),
      loadFileTree(commitId),
    ]);
    setStatus(`${commit.short_id}: ${state.diffData.length} dosya değişti`);
  } catch (err) {
    console.error(err);
    setStatus('Commit ayrıntıları yüklenemedi');
  }
}

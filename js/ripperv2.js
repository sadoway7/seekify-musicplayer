const RipperV2 = {
  _tab: 'search',
  _downloadJobs: [],
  _pollTimer: null,
  _history: [],
  _resolveCache: {},

  render(container) {
    this.els = { content: container };
    if (!this._downloadJobs.length) {
      Api.getQueue().then(j => { this._downloadJobs = j || []; }).catch(() => {});
    }
    this._renderMain();
    this._startPoll();
  },

  _startPoll() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => this._pollQueue(), 5000);
  },

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  },

  _showToast(msg) { UI.showToast(msg); },

  _isQueued(artist, title) {
    return this._downloadJobs.some(j =>
      j.status !== 'completed' && j.status !== 'failed' &&
      j.artist && j.title &&
      j.artist.toLowerCase() === (artist || '').toLowerCase() &&
      j.title.toLowerCase() === (title || '').toLowerCase()
    );
  },

  _refreshJobs() {
    return Api.getQueue().then(j => { this._downloadJobs = j || []; }).catch(() => {});
  },

  _renderMain() {
    let html = '<div class="page-header">'
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Ripper <span style="font-size:10px;font-weight:700;background:var(--accent);color:#000;padding:2px 6px;border-radius:6px;vertical-align:middle">v2</span></span>'
      + '<button class="chip finder-chip' + (this._tab === 'queue' ? ' active' : '') + '" data-v2tab="queue" style="margin-left:auto;background:#3B82F6;color:#fff;border-color:#3B82F6">Downloads</button>'
      + '</div>';

    html += '<div class="filter-chips finder-type-chips">'
      + '<button class="chip finder-chip' + (this._tab === 'search' ? ' active' : '') + '" data-v2tab="search">URL / Search</button>'
      + '<button class="chip finder-chip' + (this._tab === 'musicbrainz' ? ' active' : '') + '" data-v2tab="musicbrainz">MusicBrainz</button>'
      + '</div>';

    if (this._tab === 'search') {
      html += this._renderUrlSection();
    } else if (this._tab === 'musicbrainz') {
      html += this._renderMBSection();
    } else {
      html += '<div id="v2-queue-stats" class="queue-stats"></div>'
        + '<div id="v2-queue-list" class="queue-job-list"></div>';
    }

    this.els.content.innerHTML = html;
    this._bindMain();
  },

  _renderUrlSection() {
    return '<div style="padding:0 var(--page-margin)">'
      + '<div class="v2-input-group">'
      + '<textarea id="v2-url-input" class="v2-input" rows="2" placeholder="Paste YouTube, SoundCloud, Bandcamp URL... (one per line for batch)">' + this._esc(this._urlValue || '') + '</textarea>'
      + '<button id="v2-url-go" class="v2-btn-primary">Rip</button>'
      + '</div>'
      + '<div id="v2-url-resolve"></div>'
      + '</div>';
  },

  _renderMBSection() {
    let html = '<div class="finder-search-row">'
      + '<div class="search-container finder-search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input finder-search-input" type="text" id="v2-mb-input" placeholder="Artist - Song Title..." value="' + this._esc(this._mbQuery || '') + '">'
      + '</div></div>';

    if (!this._mbQuery && this._history.length > 0) {
      html += '<div class="finder-search-history">';
      this._history.slice(0, 5).forEach(h => {
        html += '<button class="finder-history-chip" data-history="' + this._esc(h) + '">' + this._esc(h) + '</button>';
      });
      html += '</div>';
    }

    html += '<div id="v2-mb-results"></div>';
    return html;
  },

  _bindMain() {
    const c = this.els.content;

    c.querySelectorAll('[data-v2tab]').forEach(chip => {
      chip.addEventListener('click', () => {
        this._tab = chip.dataset.v2tab;
        this._renderMain();
        if (this._tab === 'queue') this._loadQueue();
      });
    });

    if (this._tab === 'search') this._bindUrlTab(c);
    else if (this._tab === 'musicbrainz') this._bindMBTab(c);
    else this._loadQueue();
  },

  _bindUrlTab(c) {
    const urlInput = c.querySelector('#v2-url-input');
    const urlBtn = c.querySelector('#v2-url-go');

    if (urlBtn) urlBtn.addEventListener('click', () => this._resolveUrls());
    if (urlInput) urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._resolveUrls(); }
    });
  },

  _bindMBTab(c) {
    const input = c.querySelector('#v2-mb-input');
    let timer;

    if (input) {
      input.addEventListener('input', e => {
        this._mbQuery = e.target.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => { if (this._mbQuery) this._searchMBPython(); }, 400);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { clearTimeout(timer); if (this._mbQuery) this._searchMBPython(); }
      });
    }

    c.querySelectorAll('.finder-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this._mbQuery = chip.dataset.history;
        this._renderMain();
        this._searchMBPython();
      });
    });
  },

  async _resolveUrls() {
    const input = this.els.content.querySelector('#v2-url-input');
    this._urlValue = input ? input.value.trim() : '';
    const container = this.els.content.querySelector('#v2-url-resolve');
    if (!this._urlValue || !container) return;

    const urls = this._urlValue.split('\n').map(u => u.trim()).filter(u => u && (u.startsWith('http') || u.startsWith('youtu')));

    if (!urls.length) {
      container.innerHTML = '<div class="empty-state-text" style="padding:16px">Enter a valid URL</div>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';

    const results = [];
    for (const url of urls) {
      try {
        const res = await fetch('/api/v2/resolve-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        if (res.ok) {
          const data = await res.json();
          data._sourceUrl = url;
          results.push(data);
        } else {
          results.push({ _sourceUrl: url, error: 'Could not resolve' });
        }
      } catch (e) {
        results.push({ _sourceUrl: url, error: 'Network error' });
      }
    }

    if (results.length === 1 && !results[0].error) {
      const data = results[0];
      this._searchMBForResolve(container, data);
    } else {
      let html = '<div class="finder-list">';
      results.forEach(data => {
        if (data.error) {
          html += '<div class="finder-item" style="opacity:0.5"><div class="finder-item-info"><div class="finder-item-title" style="color:var(--text-muted)">' + this._esc(data._sourceUrl) + '</div><div class="finder-item-subtitle">' + this._esc(data.error) + '</div></div></div>';
        } else {
          html += '<div class="v2-resolve-item" data-url="' + this._esc(data._sourceUrl) + '">'
            + '<div class="finder-item-info">'
            + '<div class="finder-item-title">' + this._esc(data.artist || '') + (data.artist && data.title ? ' - ' : '') + this._esc(data.title || 'Unknown') + '</div>'
            + '</div></div>';
        }
      });
      html += '</div>';
      container.innerHTML = html;
    }
  },

  async _searchMBForResolve(container, resolveData) {
    const artist = resolveData.artist || '';
    const title = resolveData.title || '';

    let mbHtml = '<div class="v2-resolve-card">'
      + '<div style="display:flex;gap:14px;align-items:center">'
      + '<div style="width:64px;height:64px;min-width:64px;border-radius:var(--radius-sm);overflow:hidden;background:var(--l3)">'
      + (resolveData.coverUrl ? '<img src="' + this._esc(resolveData.coverUrl) + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">' : '')
      + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:15px;font-weight:600">' + this._esc(title || 'Unknown') + '</div>'
      + (artist ? '<div style="font-size:var(--fs-caption);color:var(--text-secondary);margin-top:2px">' + this._esc(artist) + '</div>' : '')
      + '</div></div>';

    mbHtml += '<div id="v2-mb-candidates" style="margin-top:12px"><div class="loading-spinner" style="margin:10px auto"></div></div>';
    mbHtml += '</div>';
    container.innerHTML = mbHtml;

    let candidates = [];
    try {
      const res = await fetch('/api/v2/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist, title }),
      });
      if (res.ok) {
        const data = await res.json();
        candidates = data.candidates || [];
      }
    } catch (e) {}

    this._renderCandidates(container.querySelector('#v2-mb-candidates'), candidates, resolveData);
  },

  _renderCandidates(container, candidates, resolveData) {
    if (!candidates.length) {
      container.innerHTML = '<div style="padding:8px;font-size:var(--fs-caption);color:var(--text-muted)">No MusicBrainz matches. Will download with basic metadata.</div>'
        + '<button class="v2-btn-primary" id="v2-dl-basic" style="margin-top:8px;width:100%">' + Icons.download() + ' Download Anyway</button>';
      container.querySelector('#v2-dl-basic').addEventListener('click', () => {
        this._queueV2Download(resolveData._sourceUrl || resolveData.url, resolveData, {});
      });
      return;
    }

    let html = '<div style="font-size:var(--fs-caption);color:var(--text-secondary);margin-bottom:8px">Select the best match:</div>';

    candidates.forEach((c, i) => {
      const selected = i === 0 ? ' v2-candidate-selected' : '';
      html += '<div class="v2-candidate' + selected + '" data-idx="' + i + '">'
        + '<div style="display:flex;gap:10px;align-items:center">'
        + '<div class="v2-candidate-cover">'
        + (c.cover_art_url ? '<img src="' + this._esc(c.cover_art_url) + '" onerror="this.style.display=\'none\'">' : '')
        + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-weight:600;font-size:14px">' + this._esc(c.title) + '</div>'
        + '<div style="font-size:var(--fs-caption);color:var(--text-secondary)">' + this._esc(c.artist) + '</div>'
        + '<div style="font-size:var(--fs-caption);color:var(--text-muted);margin-top:2px">'
        + (c.album ? this._esc(c.album) : '')
        + (c.year ? ' (' + c.year + ')' : '')
        + '</div>'
        + (c.genre ? '<div style="margin-top:4px"><span class="finder-type-badge" style="background:var(--accent-soft);color:var(--accent);font-size:11px">' + this._esc(c.genre) + '</span></div>' : '')
        + '</div>'
        + '<div class="v2-candidate-radio">' + (i === 0 ? '&#9679;' : '&#9675;') + '</div>'
        + '</div></div>';
    });

    html += '<button class="v2-btn-primary" id="v2-dl-enriched" style="margin-top:10px;width:100%">' + Icons.download() + ' Download & Enrich</button>';
    html += '<button class="v2-btn-secondary" id="v2-dl-basic-alt" style="margin-top:6px;width:100%">Skip enrichment</button>';

    container.innerHTML = html;
    this._selectedCandidate = 0;

    container.querySelectorAll('.v2-candidate').forEach(el => {
      el.addEventListener('click', () => {
        container.querySelectorAll('.v2-candidate').forEach(e => {
          e.classList.remove('v2-candidate-selected');
          e.querySelector('.v2-candidate-radio').innerHTML = '&#9675;';
        });
        el.classList.add('v2-candidate-selected');
        el.querySelector('.v2-candidate-radio').innerHTML = '&#9679;';
        this._selectedCandidate = parseInt(el.dataset.idx);
      });
    });

    container.querySelector('#v2-dl-enriched').addEventListener('click', () => {
      const match = candidates[this._selectedCandidate];
      this._queueV2Download(resolveData._sourceUrl || resolveData.url, resolveData, match);
    });

    container.querySelector('#v2-dl-basic-alt').addEventListener('click', () => {
      this._queueV2Download(resolveData._sourceUrl || resolveData.url, resolveData, {});
    });
  },

  async _queueV2Download(url, resolveData, mbMatch) {
    const body = {
      query: url,
      artist: mbMatch.artist || resolveData.artist || '',
      title: mbMatch.title || resolveData.title || '',
      album: mbMatch.album || resolveData.album || '',
      pipeline: 'v2',
      recordingId: mbMatch.recording_id || '',
      releaseId: mbMatch.release_id || '',
      artistId: mbMatch.artist_id || '',
      genre: mbMatch.genre || '',
      year: mbMatch.year || '',
    };

    if (mbMatch.track_number) body.trackNumber = parseInt(mbMatch.track_number);

    try {
      const res = await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this._showToast(err.error || 'Failed');
        return;
      }
      this._showToast('Download queued with enrichment');
      this._refreshJobs();
      const container = this.els.content.querySelector('#v2-url-resolve');
      if (container) container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--accent);font-weight:600">Queued for download + enrichment</div>';
    } catch (e) {
      this._showToast('Failed to queue');
    }
  },

  async _searchMBPython() {
    const container = this.els.content.querySelector('#v2-mb-results');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';

    this._addHistory(this._mbQuery);

    try {
      await this._refreshJobs();
      const res = await fetch('/api/v2/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: this._mbQuery }),
      });
      if (!res.ok) {
        container.innerHTML = '<div class="empty-state-text" style="padding:20px">Search failed</div>';
        return;
      }
      const data = await res.json();
      const parsed = data.parsed || {};
      const candidates = data.candidates || [];
      this._renderPythonResults(container, candidates, parsed);
    } catch (e) {
      container.innerHTML = '<div class="empty-state-text" style="padding:20px">Search failed</div>';
    }
  },

  _renderPythonResults(container, candidates, parsed) {
    if (!candidates.length) {
      container.innerHTML = '<div class="empty-state" style="padding:40px 22px"><div class="empty-state-title">No results</div><div class="empty-state-text">Try different keywords</div></div>';
      return;
    }

    let html = '<div class="finder-results-count">' + candidates.length + ' match' + (candidates.length !== 1 ? 'es' : '') + '</div><div class="finder-list">';

    candidates.forEach(c => {
      const queued = this._isQueued(c.artist, c.title);
      let status;
      if (queued) {
        status = '<span class="finder-status-badge finder-in-queue">Queued</span>';
      } else {
        status = '<button class="finder-download-btn v2-py-dl"'
          + ' data-artist="' + this._esc(c.artist) + '"'
          + ' data-title="' + this._esc(c.title) + '"'
          + ' data-album="' + this._esc(c.album || '') + '"'
          + ' data-recording-id="' + this._esc(c.recording_id || '') + '"'
          + ' data-release-id="' + this._esc(c.release_id || '') + '"'
          + ' data-artist-id="' + this._esc(c.artist_id || '') + '"'
          + ' data-genre="' + this._esc(c.genre || '') + '"'
          + ' data-year="' + this._esc(c.year || '') + '"'
          + '>' + Icons.download() + '<span>Rip</span></button>';
      }

      html += '<div class="finder-item">'
        + '<div class="finder-item-art"><img src="' + (c.cover_art_url || '') + '" alt="" onerror="this.style.display=\'none\'"></div>'
        + '<div class="finder-item-info">'
        + '<div class="finder-item-title">' + this._esc(c.title) + '</div>'
        + '<div class="finder-item-subtitle">' + this._esc(c.artist) + (c.album ? ' · ' + this._esc(c.album) : '') + (c.year ? ' (' + c.year + ')' : '') + '</div>'
        + (c.genre ? '<span class="finder-type-badge" style="background:var(--accent-soft);color:var(--accent);font-size:10px;margin-top:2px;display:inline-block">' + this._esc(c.genre) + '</span>' : '')
        + '</div>'
        + status
        + '</div>';
    });

    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.v2-py-dl').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const badge = document.createElement('span');
        badge.className = 'finder-status-badge finder-in-queue';
        badge.textContent = 'Queued';
        btn.replaceWith(badge);
        try {
          await this._queueV2Download(
            btn.dataset.artist + ' - ' + btn.dataset.title,
            { artist: btn.dataset.artist, title: btn.dataset.title },
            {
              artist: btn.dataset.artist,
              title: btn.dataset.title,
              album: btn.dataset.album,
              recording_id: btn.dataset.recordingId,
              release_id: btn.dataset.releaseId,
              artist_id: btn.dataset.artistId,
              genre: btn.dataset.genre,
              year: btn.dataset.year,
            }
          );
        } catch (err) {
          this._showToast(err.message || 'Failed');
        }
      });
    });
  },

  _addHistory(q) {
    this._history = this._history.filter(h => h !== q);
    this._history.unshift(q);
    if (this._history.length > 20) this._history = this._history.slice(0, 20);
  },

  async _pollQueue() {
    if (this._tab !== 'queue') return;
    await this._loadQueue();
  },

  async _loadQueue() {
    try {
      const [jobs, counts] = await Promise.all([Api.getQueue(100), Api.getQueueCounts()]);
      this._downloadJobs = jobs || [];
      const statsEl = this.els.content.querySelector('#v2-queue-stats');
      const listEl = this.els.content.querySelector('#v2-queue-list');
      if (statsEl) this._renderQueueStats(statsEl, counts);
      if (listEl) this._renderQueueList(listEl, jobs || []);
    } catch (e) {}
  },

  _renderQueueStats(el, counts) {
    const active = (counts.queued || 0) + (counts.searching || 0) + (counts.downloading || 0) + (counts.tagging || 0);
    let html = '<div class="queue-stats-badges">';
    if (counts.queued > 0) html += '<span class="stat-badge stat-queued">' + counts.queued + ' queued</span>';
    if (active > 0 && counts.queued <= 0) html += '<span class="stat-badge stat-active">' + active + ' active</span>';
    if (counts.completed > 0) html += '<span class="stat-badge stat-completed">' + counts.completed + ' done</span>';
    if (counts.failed > 0) html += '<span class="stat-badge stat-failed">' + counts.failed + ' failed</span>';
    html += '</div><div class="queue-stats-actions">';
    if (counts.failed > 0) html += '<button class="settings-btn settings-btn-primary" id="v2-retry-all" style="font-size:11px;padding:4px 10px">Retry All</button>';
    if (counts.completed > 0 || counts.failed > 0) html += '<button class="settings-btn" id="v2-clear" style="font-size:11px;padding:4px 10px">Clear History</button>';
    html += '</div>';
    el.innerHTML = html;

    const retry = el.querySelector('#v2-retry-all');
    if (retry) retry.addEventListener('click', async () => {
      retry.disabled = true;
      for (const j of this._downloadJobs.filter(j => j.status === 'failed')) { await Api.retryJob(j.id); await new Promise(r => setTimeout(r, 200)); }
      this._loadQueue();
    });
    const clear = el.querySelector('#v2-clear');
    if (clear) clear.addEventListener('click', async () => { clear.disabled = true; await Api.clearCompletedJobs(); this._loadQueue(); });
  },

  _renderQueueList(el, jobs) {
    if (!jobs.length) {
      el.innerHTML = '<div class="empty-state" style="padding:40px 22px"><div class="empty-state-title">No Downloads</div><div class="empty-state-text">Search and download music to see it here.</div></div>';
      return;
    }
    const now = Date.now();
    let qi = 0, html = '';
    jobs.forEach(j => {
      const active = j.status === 'searching' || j.status === 'downloading' || j.status === 'tagging';
      const isQ = j.status === 'queued';
      const failed = j.status === 'failed';
      const isV2 = j.pipeline === 'v2';
      let elapsed = '';
      if (active || isQ) {
        const d = Math.floor((now - new Date(j.createdAt).getTime()) / 1000);
        elapsed = d < 60 ? 'just now' : d < 3600 ? Math.floor(d / 60) + 'm ago' : Math.floor(d / 3600) + 'h ago';
      }
      let pos = '';
      if (isQ) { qi++; pos = '<span class="queue-pos">#' + qi + '</span>'; }
      const clickable = j.status === 'completed' && j.filePath;

      const v2Badge = isV2 ? '<span style="font-size:9px;font-weight:700;background:var(--accent);color:#000;padding:1px 4px;border-radius:4px;vertical-align:middle">v2</span> ' : '';
      const genreTag = j.genre ? '<span class="finder-type-badge" style="background:var(--accent-soft);color:var(--accent);font-size:10px">' + this._esc(j.genre) + '</span>' : '';

      html += '<div class="queue-job-card' + (active ? ' queue-active' : isQ ? ' queue-waiting' : '') + (clickable ? ' queue-job-clickable' : '') + '"'
        + (clickable ? ' data-artist="' + this._esc(j.artist || '') + '" data-title="' + this._esc(j.title || '') + '"' : '') + '>'
        + '<div class="queue-job-status ' + (active ? 'job-active' : isQ ? 'job-queued' : failed ? 'job-failed' : 'job-done') + '">'
        + (active ? '<div class="queue-spinner"></div>' : isQ ? '<div class="queue-status-dot dot-waiting"></div>' : failed ? '<div class="queue-status-dot dot-failed"></div>' : '<div class="queue-status-dot dot-done"></div>')
        + '</div>'
        + '<div class="queue-job-info">'
        + '<div class="queue-job-title">' + v2Badge + this._esc(j.artist || '') + (j.artist && j.title ? ' - ' : '') + this._esc(j.title || j.query || 'Unknown') + '</div>'
        + '<div class="queue-job-detail">'
        + (active ? '<span>' + elapsed + '</span>' : isQ ? pos + '<span>' + elapsed + '</span>' : '<span>' + j.status + '</span>')
        + (j.progressStage && !isQ ? '<span class="queue-stage">' + this._esc(j.progressStage) + '</span>' : '')
        + (j.source ? '<span class="source-tag source-tag-' + this._esc(j.source) + '">' + (j.source === 'soulseek' ? 'SLSK' : 'YT') + '</span>' : '')
        + (j.audioQuality ? '<span class="queue-job-quality">' + this._esc(j.audioQuality) + '</span>' : '')
        + (genreTag ? '<span>' + genreTag + '</span>' : '')
        + (failed && j.error ? '<span class="queue-job-error">' + this._esc(j.error) + '</span>' : '')
        + '</div></div>'
        + '<div class="queue-job-actions">'
        + (clickable ? '<a class="queue-item-download" href="' + Api.downloadJobUrl(j.id) + '" download>' + Icons.download() + '</a>' : '')
        + (failed ? '<button class="queue-item-retry v2-q-retry" data-id="' + this._esc(j.id) + '">&#x21bb;</button>' : '')
        + '<button class="queue-item-delete v2-q-del" data-id="' + this._esc(j.id) + '">&times;</button>'
        + '</div></div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('.v2-q-retry').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); Api.retryJob(b.dataset.id).then(() => this._loadQueue()); }));
    el.querySelectorAll('.v2-q-del').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); Api.deleteJob(b.dataset.id).then(() => this._loadQueue()); }));
    el.querySelectorAll('.queue-job-clickable').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.queue-job-actions')) return;
        const artist = card.dataset.artist;
        const title = card.dataset.title;
        const find = () => Store.library.tracks.find(t =>
          t.artist && t.title &&
          t.artist.toLowerCase() === artist.toLowerCase() &&
          t.title.toLowerCase() === title.toLowerCase()
        );
        const track = find();
        if (track && track.albumID) {
          UI.navigateTo('album', { albumId: track.albumID });
        } else {
          UI.showToast('Refreshing library...');
          Store.refreshLibrary().then(() => {
            const t = find();
            if (t && t.albumID) {
              UI.navigateTo('album', { albumId: t.albumID });
            } else {
              UI.showToast('Track not yet in library — try scanning first');
            }
          });
        }
      });
    });
  }
};

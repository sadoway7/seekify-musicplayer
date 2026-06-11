const RipperV2 = {
  _tab: 'search',
  _mbType: 'recording',
  _mbQuery: '',
  _downloadJobs: [],
  _pollTimer: null,
  _history: [],

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

  _showToast(msg) {
    UI._showToast(msg);
  },

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
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Ripper <span style="font-size:10px;font-weight:700;background:var(--accent);color:#000;padding:2px 6px;border-radius:6px;vertical-align:middle">v2</span></span></div>';

    html += '<div class="filter-chips finder-type-chips">'
      + '<button class="chip finder-chip' + (this._tab === 'search' ? ' active' : '') + '" data-v2tab="search">URL / Search</button>'
      + '<button class="chip finder-chip' + (this._tab === 'musicbrainz' ? ' active' : '') + '" data-v2tab="musicbrainz">MusicBrainz</button>'
      + '<button class="chip finder-chip' + (this._tab === 'queue' ? ' active' : '') + '" data-v2tab="queue">Downloads</button>'
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
    let html = '<div style="padding:0 var(--page-margin)">'
      + '<div class="v2-input-group">'
      + '<input type="text" id="v2-url-input" class="v2-input" placeholder="Paste YouTube, SoundCloud, Bandcamp URL..." value="' + this._esc(this._urlValue || '') + '">'
      + '<button id="v2-url-go" class="v2-btn-primary">Rip</button>'
      + '</div>'
      + '<div id="v2-url-resolve"></div>'
      + '</div>'
      + '<div class="v2-divider"><span>or search YouTube</span></div>'
      + '<div class="finder-search-row">'
      + '<div class="search-container finder-search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input finder-search-input" type="text" id="v2-yt-input" placeholder="Artist - Song Title..." value="' + this._esc(this._ytQuery || '') + '">'
      + '</div>'
      + '</div>'
      + '<div id="v2-yt-results"></div>';
    return html;
  },

  _renderMBSection() {
    let html = '<div class="finder-search-row">'
      + '<div class="search-container finder-search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input finder-search-input" type="text" id="v2-mb-input" placeholder="Search artists, songs, albums..." value="' + this._esc(this._mbQuery) + '">'
      + '<div class="finder-sub-chips" style="display:flex">'
      + '<button class="chip finder-chip finder-sub' + (this._mbType === 'artist' ? ' active' : '') + '" data-mbtype="artist">Artists</button>'
      + '<button class="chip finder-chip finder-sub' + (this._mbType === 'recording' ? ' active' : '') + '" data-mbtype="recording">Songs</button>'
      + '<button class="chip finder-chip finder-sub' + (this._mbType === 'release' ? ' active' : '') + '" data-mbtype="release">Albums</button>'
      + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="finder-mobile-chips">'
      + '<button class="chip finder-chip' + (this._mbType === 'artist' ? ' active' : '') + '" data-mbtype="artist">Artists</button>'
      + '<button class="chip finder-chip' + (this._mbType === 'recording' ? ' active' : '') + '" data-mbtype="recording">Songs</button>'
      + '<button class="chip finder-chip' + (this._mbType === 'release' ? ' active' : '') + '" data-mbtype="release">Albums</button>'
      + '</div>';

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

    if (this._tab === 'search') {
      this._bindUrlTab(c);
    } else if (this._tab === 'musicbrainz') {
      this._bindMBTab(c);
    } else {
      this._loadQueue();
    }
  },

  _bindUrlTab(c) {
    const urlInput = c.querySelector('#v2-url-input');
    const urlBtn = c.querySelector('#v2-url-go');
    const ytInput = c.querySelector('#v2-yt-input');

    if (urlBtn) urlBtn.addEventListener('click', () => this._resolveUrl());
    if (urlInput) urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') this._resolveUrl(); });

    if (ytInput) {
      let timer;
      ytInput.addEventListener('input', e => {
        this._ytQuery = e.target.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => { if (this._ytQuery) this._searchYouTube(); }, 400);
      });
      ytInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { clearTimeout(timer); if (this._ytQuery) this._searchYouTube(); }
      });
    }
  },

  _bindMBTab(c) {
    const input = c.querySelector('#v2-mb-input');
    let timer;

    if (input) {
      input.addEventListener('input', e => {
        this._mbQuery = e.target.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => { if (this._mbQuery) this._searchMB(); }, 400);
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { clearTimeout(timer); if (this._mbQuery) this._searchMB(); }
      });
    }

    c.querySelectorAll('[data-mbtype]').forEach(chip => {
      chip.addEventListener('click', () => {
        this._mbType = chip.dataset.mbtype;
        this._renderMain();
        if (this._mbQuery) this._searchMB();
      });
    });

    c.querySelectorAll('.finder-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this._mbQuery = chip.dataset.history;
        this._renderMain();
        this._searchMB();
      });
    });
  },

  async _resolveUrl() {
    const input = this.els.content.querySelector('#v2-url-input');
    this._urlValue = input ? input.value.trim() : '';
    const container = this.els.content.querySelector('#v2-url-resolve');
    if (!this._urlValue || !container) return;

    container.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';

    try {
      const res = await fetch('/api/v2/resolve-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: this._urlValue }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        container.innerHTML = '<div class="empty-state-text" style="padding:16px">' + this._esc(err.error || 'Could not resolve') + '</div>';
        return;
      }
      const data = await res.json();
      this._renderResolveCard(container, data);
    } catch (e) {
      container.innerHTML = '<div class="empty-state-text" style="padding:16px">Failed to resolve URL</div>';
    }
  },

  _renderResolveCard(container, data) {
    const coverUrl = data.coverUrl || '';
    let meta = '';
    if (data.year) meta += '<span class="finder-type-badge">' + this._esc(String(data.year)) + '</span>';
    if (data.genre) meta += '<span class="finder-type-badge" style="background:var(--accent-soft);color:var(--accent)">' + this._esc(data.genre) + '</span>';

    container.innerHTML = '<div style="display:flex;gap:14px;align-items:center;background:var(--l2);border-radius:var(--radius-md);padding:14px">'
      + '<div style="width:64px;height:64px;min-width:64px;border-radius:var(--radius-sm);overflow:hidden;background:var(--l3)">'
      + (coverUrl ? '<img src="' + this._esc(coverUrl) + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\'">' : '')
      + '</div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:15px;font-weight:600">' + this._esc(data.title || 'Unknown') + '</div>'
      + (data.artist ? '<div style="font-size:var(--fs-caption);color:var(--text-secondary);margin-top:2px">' + this._esc(data.artist) + '</div>' : '')
      + (data.album ? '<div style="font-size:var(--fs-caption);color:var(--text-muted);margin-top:1px">' + this._esc(data.album) + '</div>' : '')
      + (meta ? '<div style="display:flex;gap:6px;margin-top:6px">' + meta + '</div>' : '')
      + '</div>'
      + '<button class="finder-download-btn" id="v2-resolve-dl">' + Icons.download() + '<span>Download</span></button>'
      + '</div>';

    container.querySelector('#v2-resolve-dl').addEventListener('click', async () => {
      const btn = container.querySelector('#v2-resolve-dl');
      btn.disabled = true;
      btn.querySelector('span').textContent = '...';
      try {
        const res = await fetch('/api/queue/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: data.url || this._urlValue,
            artist: data.artist || '',
            title: data.title || '',
            album: data.album || '',
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          this._showToast(err.error || 'Failed');
          btn.querySelector('span').textContent = 'Error';
          btn.disabled = false;
          return;
        }
        btn.querySelector('span').textContent = 'Queued';
        this._showToast('Added to queue');
        this._refreshJobs();
      } catch (e) {
        btn.querySelector('span').textContent = 'Error';
        btn.disabled = false;
      }
    });
  },

  async _searchYouTube() {
    const container = this.els.content.querySelector('#v2-yt-results');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';
    try {
      const results = await Api.finderYouTubeSearch(this._ytQuery);
      this._renderYTResults(container, results);
    } catch (e) {
      container.innerHTML = '<div class="empty-state-text" style="padding:20px">Search failed</div>';
    }
  },

  _renderYTResults(container, results) {
    if (!results || results.length === 0) {
      container.innerHTML = '<div class="empty-state-text" style="padding:20px">No results</div>';
      return;
    }
    let html = '<div class="finder-results-count">' + results.length + ' results</div><div class="finder-list">';
    results.forEach(r => {
      const dur = r.duration > 0 ? Math.floor(r.duration / 60) + ':' + String(Math.floor(r.duration % 60)).padStart(2, '0') : '';
      html += '<div class="finder-item">'
        + '<div class="finder-item-art"><img src="https://i.ytimg.com/vi/' + this._esc(r.id) + '/default.jpg" alt="" onerror="this.style.display=\'none\'"></div>'
        + '<div class="finder-item-info">'
        + '<div class="finder-item-title">' + this._esc(r.title) + '</div>'
        + '<div class="finder-item-subtitle">' + this._esc(r.channel || '') + (dur ? ' · ' + dur : '') + '</div>'
        + '</div>'
        + '<button class="finder-download-btn v2-yt-dl" data-url="https://youtube.com/watch?v=' + this._esc(r.id) + '" data-title="' + this._esc(r.title) + '">' + Icons.download() + '<span>Rip</span></button>'
        + '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.v2-yt-dl').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.querySelector('span').textContent = '...';
        try {
          const url = btn.dataset.url;
          let body = { query: url, title: btn.dataset.title };
          try {
            const rr = await fetch('/api/v2/resolve-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });
            if (rr.ok) {
              const d = await rr.json();
              body = { query: url, artist: d.artist || '', title: d.title || '', album: d.album || '' };
            }
          } catch (e) {}
          const res = await fetch('/api/queue/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            this._showToast(err.error || 'Failed');
            btn.querySelector('span').textContent = 'Error';
            return;
          }
          btn.querySelector('span').textContent = 'Queued';
          this._showToast('Added to queue');
          this._refreshJobs();
        } catch (e) {
          btn.querySelector('span').textContent = 'Error';
        }
      });
    });
  },

  async _searchMB() {
    const container = this.els.content.querySelector('#v2-mb-results');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner" style="margin:20px auto"></div>';
    try {
      await this._refreshJobs();
      const results = await Api.finderSearch(this._mbQuery, this._mbType);
      this._addHistory(this._mbQuery);
      this._renderMBResults(container, results);
    } catch (e) {
      container.innerHTML = '<div class="empty-state-text" style="padding:20px">Search failed. Try again.</div>';
    }
  },

  _addHistory(q) {
    this._history = this._history.filter(h => h !== q);
    this._history.unshift(q);
    if (this._history.length > 20) this._history = this._history.slice(0, 20);
  },

  _renderMBResults(container, results) {
    if (!results || results.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:40px 22px"><div class="empty-state-title">No results</div><div class="empty-state-text">Try different keywords</div></div>';
      return;
    }

    let html = '';
    if (this._mbType === 'recording') {
      html += '<div class="finder-results-count">' + results.length + ' song' + (results.length !== 1 ? 's' : '') + '</div><div class="finder-list">';
      results.forEach(r => {
        const len = r.length > 0 ? Math.floor(r.length / 60) + ':' + String(r.length % 60).padStart(2, '0') : '';
        let status;
        if (r.inLibrary) status = '<span class="finder-status-badge finder-in-library">In Library</span>';
        else if (this._isQueued(r.artist, r.title)) status = '<span class="finder-status-badge finder-in-queue">Queued</span>';
        else status = '<button class="finder-download-btn v2-mb-dl" data-artist="' + this._esc(r.artist) + '" data-title="' + this._esc(r.title) + '" data-album="' + this._esc(r.album || '') + '" data-album-mbid="' + this._esc(r.albumId || '') + '">' + Icons.download() + '<span>Download</span></button>';
        html += '<div class="finder-item">'
          + '<div class="finder-item-art"><img src="' + (r.albumId ? Api.finderCoverUrl(r.albumId) : '') + '" alt="" onerror="this.style.display=\'none\'"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.title) + '</div>'
          + '<div class="finder-item-subtitle">' + this._esc(r.artist) + (r.album ? ' · ' + this._esc(r.album) : '') + (r.year ? ' (' + r.year + ')' : '') + '</div>'
          + '</div>'
          + (len ? '<span class="finder-duration">' + len + '</span>' : '')
          + status
          + '</div>';
      });
      html += '</div>';
    } else if (this._mbType === 'artist') {
      html += '<div class="finder-results-count">' + results.length + ' artist' + (results.length !== 1 ? 's' : '') + '</div><div class="finder-list">';
      results.forEach(r => {
        const type = r.type ? '<span class="finder-type-badge">' + this._esc(r.type) + '</span>' : '';
        html += '<div class="finder-item finder-item-artist v2-artist" data-mbid="' + this._esc(r.id) + '" data-name="' + this._esc(r.name) + '">'
          + '<div class="finder-item-art round"><img src="' + Api.artistArtUrl(r.name) + '" alt="" data-artist-art-fetch="' + this._esc(r.name) + '"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.name) + '</div>'
          + '<div class="finder-item-subtitle">' + (r.disambiguation ? this._esc(r.disambiguation) + ' · ' : '') + (r.country || '') + (r.tags ? ' · ' + this._esc(r.tags.slice(0, 3).join(', ')) : '') + '</div>'
          + '</div>'
          + '<div class="finder-item-meta">' + type + (r.inLibrary ? '<span class="finder-status-badge finder-in-library">In Library</span>' : '') + '</div>'
          + '</div>';
      });
      html += '</div>';
    } else if (this._mbType === 'release') {
      html += '<div class="finder-results-count">' + results.length + ' album' + (results.length !== 1 ? 's' : '') + '</div><div class="finder-list">';
      results.forEach(r => {
        const type = r.type ? '<span class="finder-type-badge">' + this._esc(r.type) + '</span>' : '';
        html += '<div class="finder-item v2-release" data-mbid="' + this._esc(r.id) + '" data-title="' + this._esc(r.title) + '" data-artist="' + this._esc(r.artist) + '">'
          + '<div class="finder-item-art"><img src="' + Api.finderCoverUrl(r.id) + '" alt="" onerror="this.style.display=\'none\'"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.title) + '</div>'
          + '<div class="finder-item-subtitle">' + this._esc(r.artist) + (r.year ? ' · ' + r.year : '') + (r.trackCount ? ' · ' + r.trackCount + ' tracks' : '') + '</div>'
          + '</div>'
          + '<div class="finder-item-meta">' + type + (r.inLibrary ? '<span class="finder-status-badge finder-in-library">In Library</span>' : '') + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
    this._bindMBResults(container);
  },

  _bindMBResults(container) {
    container.querySelectorAll('.v2-mb-dl').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const badge = document.createElement('span');
        badge.className = 'finder-status-badge finder-in-queue';
        badge.textContent = 'Queued';
        btn.replaceWith(badge);
        try {
          await Api.queueAdd({ artist: btn.dataset.artist, title: btn.dataset.title, album: btn.dataset.album, albumMbid: btn.dataset.albumMbid });
          this._showToast('Added to queue');
          this._refreshJobs();
        } catch (err) {
          this._showToast(err.message || 'Failed');
        }
      });
    });

    container.querySelectorAll('.v2-artist').forEach(el => {
      el.addEventListener('click', () => this._showArtist(el.dataset.mbid, el.dataset.name));
    });

    container.querySelectorAll('.v2-release').forEach(el => {
      el.addEventListener('click', () => this._showRelease(el.dataset.mbid, el.dataset.title, el.dataset.artist));
    });
  },

  _showArtist(mbid, name) {
    let html = '<div class="page-header">'
      + '<button class="back-btn" id="v2-artist-back">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">' + this._esc(name) + '</span>'
      + '</div>'
      + '<div class="filter-chips finder-type-chips">'
      + '<button class="chip finder-chip active" data-av="tracks">Tracklist</button>'
      + '<button class="chip finder-chip" data-av="albums">Albums</button>'
      + '</div>'
      + '<div id="v2-artist-content"><div class="loading-spinner" style="margin:40px auto"></div></div>';

    this.els.content.innerHTML = html;
    let view = 'tracks';
    let releases = null;

    const setContent = () => {
      if (!releases) return;
      if (view === 'tracks') this._renderArtistTracks($('#v2-artist-content'), releases, name);
      else this._renderArtistAlbums($('#v2-artist-content'), releases);
      this.els.content.querySelectorAll('[data-av]').forEach(c => c.classList.toggle('active', c.dataset.av === view));
    };

    this.els.content.querySelector('#v2-artist-back').addEventListener('click', () => this._renderMain());
    this.els.content.querySelectorAll('[data-av]').forEach(chip => {
      chip.addEventListener('click', () => { view = chip.dataset.av; setContent(); });
    });

    Api.finderArtistReleases(mbid).then(r => {
      releases = r;
      setContent();
    }).catch(() => {
      const c = $('#v2-artist-content');
      if (c) c.innerHTML = '<div class="empty-state-text" style="padding:20px">Failed to load</div>';
    });
  },

  _renderArtistTracks(container, releases, artistName) {
    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';
    Api.finderArtistTracks(releases[0].artistId || '', artistName).then(allTracks => {
      if (!allTracks || allTracks.length === 0) {
        container.innerHTML = '<div class="empty-state-text" style="padding:20px">No tracks found</div>';
        return;
      }
      let html = '<div class="tracklist-toolbar">'
        + '<div class="search-container finder-search-container">'
        + '<span class="search-icon">' + Icons.search() + '</span>'
        + '<input class="search-input artist-tracklist-search" type="text" placeholder="Filter tracks...">'
        + '</div>'
        + '<button class="settings-btn settings-btn-primary" id="v2-dl-all-artist">' + Icons.download() + '<span>Download All</span></button>'
        + '</div>';
      html += '<div class="finder-results-count">' + allTracks.length + ' tracks</div>';
      html += '<div class="finder-tracklist">';
      allTracks.forEach((t, i) => {
        const len = t.length > 0 ? Math.floor(t.length / 60) + ':' + String(t.length % 60).padStart(2, '0') : '';
        let status;
        if (t.inLibrary) status = '<span class="finder-status-badge finder-in-own-library">In Library</span>';
        else if (this._isQueued(t.artist, t.title)) status = '<span class="finder-status-badge finder-in-queue">Queued</span>';
        else status = '<button class="finder-download-btn v2-track-dl" data-artist="' + this._esc(t.artist) + '" data-title="' + this._esc(t.title) + '" data-album="' + this._esc(t.album || '') + '" data-album-mbid="' + this._esc(t.albumId || '') + '">' + Icons.download() + '<span>Download</span></button>';
        html += '<div class="finder-track-row" data-track-search="' + this._esc((t.title + ' ' + (t.album || '') + ' ' + t.artist).toLowerCase()) + '">'
          + '<div class="finder-track-num">' + (i + 1) + '</div>'
          + '<div class="finder-track-info"><div class="finder-track-title">' + this._esc(t.title) + '</div><div class="finder-track-artist">' + this._esc(t.album || '') + '</div></div>'
          + (len ? '<div class="finder-track-length">' + len + '</div>' : '')
          + status
          + '</div>';
      });
      html += '</div>';
      container.innerHTML = html;

      container.querySelector('#v2-dl-all-artist').addEventListener('click', () => {
        const dl = allTracks.filter(t => !t.inLibrary);
        if (!dl.length) { this._showToast('All in library'); return; }
        Api.queueAddBatch(dl.map((t, i) => ({ artist: t.artist, title: t.title, album: t.album || '', albumMbid: t.albumId || '', trackNumber: i + 1, trackTotal: dl.length }))).then(() => {
          this._showToast(dl.length + ' tracks queued');
          container.querySelectorAll('.v2-track-dl').forEach(b => { const badge = document.createElement('span'); badge.className = 'finder-status-badge finder-in-queue'; badge.textContent = 'Queued'; b.replaceWith(badge); });
        });
      });

      const search = container.querySelector('.artist-tracklist-search');
      if (search) search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        container.querySelectorAll('.finder-track-row').forEach(r => { r.style.display = !q || (r.dataset.trackSearch || '').includes(q) ? '' : 'none'; });
      });

      container.querySelectorAll('.v2-track-dl').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const badge = document.createElement('span'); badge.className = 'finder-status-badge finder-in-queue'; badge.textContent = 'Queued'; btn.replaceWith(badge);
          Api.queueAdd({ artist: btn.dataset.artist, title: btn.dataset.title, album: btn.dataset.album, albumMbid: btn.dataset.albumMbid }).then(() => this._showToast('Queued')).catch(err => this._showToast(err.message));
        });
      });
    }).catch(() => { container.innerHTML = '<div class="empty-state-text" style="padding:20px">Failed</div>'; });
  },

  _renderArtistAlbums(container, releases) {
    let html = '<div class="finder-results-count">' + releases.length + ' albums</div><div class="scroll-row" style="flex-wrap:wrap">';
    releases.forEach(r => {
      html += '<div class="card v2-release-card" data-mbid="' + this._esc(r.id) + '" data-title="' + this._esc(r.title) + '" data-artist="' + this._esc(r.artist) + '">'
        + '<div class="card-art"><img src="' + Api.finderCoverUrl(r.id) + '" alt="" onerror="this.style.display=\'none\'"></div>'
        + '<div class="card-title">' + this._esc(r.title) + '</div>'
        + '<div class="card-subtitle">' + (r.year || '') + (r.type ? ' · ' + r.type : '') + '</div>'
        + '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('.v2-release-card').forEach(el => {
      el.addEventListener('click', () => this._showRelease(el.dataset.mbid, el.dataset.title, el.dataset.artist));
    });
  },

  _showRelease(mbid, title, artist) {
    let html = '<div class="detail-hero">'
      + '<button class="back-btn" id="v2-release-back">' + Icons.chevronLeft() + '</button>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="finder-hero-art"><img src="' + Api.finderCoverUrl(mbid) + '" alt="" onerror="this.style.display=\'none\'"></div>'
      + '<div class="detail-hero-info"><div class="detail-hero-text">'
      + '<div class="detail-hero-title">' + this._esc(title) + '</div>'
      + '<div class="detail-hero-meta">' + this._esc(artist) + '</div>'
      + '</div></div></div>'
      + '<div style="padding:0 var(--page-margin) 8px"><button class="settings-btn settings-btn-primary" id="v2-dl-album">' + Icons.download() + '<span>Download All Tracks</span></button></div>'
      + '<div id="v2-release-tracks"><div class="loading-spinner" style="margin:40px auto"></div></div>';

    this.els.content.innerHTML = html;
    this.els.content.querySelector('#v2-release-back').addEventListener('click', () => this._renderMain());

    Api.finderReleaseTracks(mbid).then(tracks => {
      const tc = $('#v2-release-tracks');
      if (!tracks || tracks.length === 0) {
        tc.innerHTML = '<div class="empty-state-text" style="padding:20px">No track listing available</div>';
        return;
      }
      let html = '<div class="finder-results-count">' + tracks.length + ' tracks</div><div class="finder-tracklist">';
      tracks.forEach((t, i) => {
        const len = t.length > 0 ? Math.floor(t.length / 60) + ':' + String(t.length % 60).padStart(2, '0') : '';
        let status;
        if (t.inLibrary) status = '<span class="finder-status-badge finder-in-own-library">In Library</span>';
        else if (this._isQueued(t.artist || artist, t.title)) status = '<span class="finder-status-badge finder-in-queue">Queued</span>';
        else status = '<button class="finder-download-btn v2-rel-dl" data-artist="' + this._esc(t.artist || artist) + '" data-title="' + this._esc(t.title) + '" data-album="' + this._esc(title) + '" data-album-mbid="' + this._esc(mbid) + '" data-pos="' + (t.position || (i + 1)) + '" data-total="' + tracks.length + '">' + Icons.download() + '<span>Download</span></button>';
        html += '<div class="finder-track-row">'
          + '<div class="finder-track-num">' + (t.position || (i + 1)) + '</div>'
          + '<div class="finder-track-info"><div class="finder-track-title">' + this._esc(t.title) + '</div><div class="finder-track-artist">' + this._esc(t.artist || artist) + '</div></div>'
          + (len ? '<div class="finder-track-length">' + len + '</div>' : '')
          + status
          + '</div>';
      });
      html += '</div>';
      tc.innerHTML = html;

      $('#v2-dl-album').addEventListener('click', () => {
        const dl = tracks.filter(t => !t.inLibrary);
        if (!dl.length) { this._showToast('All in library'); return; }
        Api.queueAddBatch(dl.map((t, i) => ({ artist: t.artist || artist, title: t.title, album: title, albumMbid: mbid, trackNumber: t.position || (i + 1), trackTotal: dl.length }))).then(() => {
          this._showToast(dl.length + ' tracks queued');
          tc.querySelectorAll('.v2-rel-dl').forEach(b => { const badge = document.createElement('span'); badge.className = 'finder-status-badge finder-in-queue'; badge.textContent = 'Queued'; b.replaceWith(badge); });
        });
      });

      tc.querySelectorAll('.v2-rel-dl').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const badge = document.createElement('span'); badge.className = 'finder-status-badge finder-in-queue'; badge.textContent = 'Queued'; btn.replaceWith(badge);
          Api.queueAdd({ artist: btn.dataset.artist, title: btn.dataset.title, album: btn.dataset.album, albumMbid: btn.dataset.albumMbid, trackNumber: parseInt(btn.dataset.pos), trackTotal: parseInt(btn.dataset.total) }).then(() => this._showToast('Queued')).catch(err => this._showToast(err.message));
        });
      });
    }).catch(() => { const tc = $('#v2-release-tracks'); if (tc) tc.innerHTML = '<div class="empty-state-text" style="padding:20px">Failed to load</div>'; });
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
      let elapsed = '';
      if (active || isQ) {
        const d = Math.floor((now - new Date(j.createdAt).getTime()) / 1000);
        elapsed = d < 60 ? 'just now' : d < 3600 ? Math.floor(d / 60) + 'm ago' : Math.floor(d / 3600) + 'h ago';
      }
      let pos = '';
      if (isQ) { qi++; pos = '<span class="queue-pos">#' + qi + '</span>'; }
      html += '<div class="queue-job-card' + (active ? ' queue-active' : isQ ? ' queue-waiting' : '') + '">'
        + '<div class="queue-job-status ' + (active ? 'job-active' : isQ ? 'job-queued' : failed ? 'job-failed' : 'job-done') + '">'
        + (active ? '<div class="queue-spinner"></div>' : isQ ? '<div class="queue-status-dot dot-waiting"></div>' : failed ? '<div class="queue-status-dot dot-failed"></div>' : '<div class="queue-status-dot dot-done"></div>')
        + '</div>'
        + '<div class="queue-job-info">'
        + '<div class="queue-job-title">' + this._esc(j.artist || '') + (j.artist && j.title ? ' - ' : '') + this._esc(j.title || j.query || 'Unknown') + '</div>'
        + '<div class="queue-job-detail">'
        + (active ? '<span>' + elapsed + '</span>' : isQ ? pos + '<span>' + elapsed + '</span>' : '<span>' + j.status + '</span>')
        + (j.progressStage && !isQ ? '<span>' + this._esc(j.progressStage) + '</span>' : '')
        + (j.audioQuality ? '<span class="queue-job-quality">' + this._esc(j.audioQuality) + '</span>' : '')
        + (failed && j.error ? '<span class="queue-job-error">' + this._esc(j.error) + '</span>' : '')
        + '</div></div>'
        + '<div class="queue-job-actions">'
        + (j.status === 'completed' && j.filePath ? '<a class="queue-item-download" href="' + Api.downloadJobUrl(j.id) + '" download>' + Icons.download() + '</a>' : '')
        + (failed ? '<button class="queue-item-retry v2-q-retry" data-id="' + this._esc(j.id) + '">&#x21bb;</button>' : '')
        + '<button class="queue-item-delete v2-q-del" data-id="' + this._esc(j.id) + '">&times;</button>'
        + '</div></div>';
    });
    el.innerHTML = html;
    el.querySelectorAll('.v2-q-retry').forEach(b => b.addEventListener('click', () => Api.retryJob(b.dataset.id).then(() => this._loadQueue())));
    el.querySelectorAll('.v2-q-del').forEach(b => b.addEventListener('click', () => Api.deleteJob(b.dataset.id).then(() => this._loadQueue())));
  }
};

function $(sel) { return document.querySelector(sel); }

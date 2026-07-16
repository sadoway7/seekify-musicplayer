// ============================================
// ui-finder.js — Finder (search/discovery) + Downloads rendering
// Extracted from ui.js. Loaded AFTER ui.js.
// ============================================
Object.assign(UI, {

  renderFinder() {
    this._viewTrackList = [];
    if (!this._finderType) this._finderType = 'artist';
    if (!this._finderQuery) this._finderQuery = '';
    if (!this._finderResults) this._finderResults = null;
    if (!this._finderHistory) this._finderHistory = JSON.parse(localStorage.getItem('finderHistory') || '[]');
    if (!this._finderTab) this._finderTab = 'search';
    if (this._downloadPollTimer) { clearInterval(this._downloadPollTimer); this._downloadPollTimer = null; }

    if (Store.isGuest && (this._finderTab === 'bulk' || this._finderTab === 'downloads')) this._finderTab = 'search';
    let html = '<div class="lib-sticky-header">'
      + '<div class="lib-tabs">'
      + '<button class="lib-tab' + (this._finderTab === 'search' ? ' active' : '') + '" data-finder-tab="search">Rip Search</button>'
      + (Store.isGuest ? '' : '<button class="lib-tab' + (this._finderTab === 'bulk' ? ' active' : '') + '" data-finder-tab="bulk">Bulk Import</button>')
      + (Store.isGuest ? '' : '<button class="lib-tab' + (this._finderTab === 'downloads' ? ' active' : '') + '" data-finder-tab="downloads">Downloads</button>')
      + '</div>'
      + (this._finderTab === 'downloads' ? '' : '');

    if (this._finderTab === 'downloads') {
      html += '</div>'
        + '<div id="downloads-content"><div class="loading-spinner" style="margin:40px auto"></div></div>';
    } else if (this._finderTab === 'bulk') {
      html += '</div>'
        + '<div style="padding:16px">'
        + '<div class="settings-section-desc">Paste a list of tracks to download. One per line: "Artist - Title"</div>'
        + '<textarea id="bulk-import-input" class="settings-textarea" rows="10" style="margin-bottom:12px;font-size:14px" placeholder="Daft Punk - Around the World&#10;The Prodigy - Smack My Bitch Up&#10;Joey Valence and Brae - WATCH YO STEP&#10;Sisqo - Thong Song"></textarea>'
        + '<div class="settings-actions">'
        + '<button class="settings-btn settings-btn-primary" id="btn-bulk-import">' + Icons.download() + '<span>Download All</span></button>'
        + '<span id="bulk-import-count" style="font-size:13px;color:var(--text3);margin-left:8px"></span>'
        + '</div>'
        + '<div id="bulk-import-result"></div>'
        + '</div>';
    } else {
      const subChips = '<div class="finder-type-chips finder-sub-chips">'
        + '<button class="chip finder-sub' + (this._finderType === 'artist' ? ' active' : '') + '" data-finder-type="artist">Artists</button>'
        + '<button class="chip finder-sub' + (this._finderType === 'recording' ? ' active' : '') + '" data-finder-type="recording">Songs</button>'
        + '<button class="chip finder-sub' + (this._finderType === 'release' ? ' active' : '') + '" data-finder-type="release">Albums</button>'
        + '</div>';
      html += '<div class="search-container finder-search-container">'
        + '<span class="search-icon">' + Icons.search() + '</span>'
        + '<input class="search-input finder-search-input" type="search" enterkeyhint="search" placeholder="Search artists, songs, albums..." value="' + this._esc(this._finderQuery) + '">'
        + subChips
        + '</div>'
        + '</div>'
        + '<div class="finder-mobile-chips">' + subChips + '</div>';

      if (!this._finderQuery && this._finderHistory.length > 0) {
        html += '<div class="finder-search-history">';
        this._finderHistory.slice(0, 5).forEach(h => {
          html += '<button class="finder-history-chip" data-history="' + this._esc(h) + '">' + this._esc(h) + '</button>';
        });
        html += '</div>';
      }

      html += '<div id="finder-results"></div>';
    }

    this.els.content.innerHTML = html;

    this.els.content.querySelectorAll('[data-finder-tab]').forEach(chip => {
      chip.addEventListener('click', () => {
        this._finderTab = chip.dataset.finderTab;
        this.renderFinder();
      });
    });

    if (this._finderTab === 'downloads') {
      this._downloadsSig = null;
      this._loadDownloads();
      this._downloadPollTimer = setInterval(() => this._loadDownloads(), 3000);
      return;
    }

    const input = this.els.content.querySelector('.finder-search-input');
    if (input) {
      input.addEventListener('input', (e) => {
        this._finderQuery = e.target.value.trim();
        clearTimeout(this._finderTimer);
        this._finderTimer = setTimeout(() => this._renderFinderResults(), 300);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          clearTimeout(this._finderTimer);
          this._renderFinderResults();
        }
      });
    }

    this.els.content.querySelectorAll('.finder-sub-chips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const newType = chip.dataset.finderType;
        if (newType === this._finderType) return;
        this._finderType = newType;
        if (this._finderQuery) {
          this._renderFinderResults();
        } else {
          this.renderFinder();
        }
      });
    });

    if (this._finderQuery) {
      this._renderFinderResults();
    }

    this._clearPollTimers();
    this._pollFinderStatus();

    this.els.content.querySelectorAll('.finder-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        this._finderQuery = chip.dataset.history;
        this.renderFinder();
        this._renderFinderResults();
      });
    });

    const bulkImportBtn = document.getElementById('btn-bulk-import');
    if (bulkImportBtn) bulkImportBtn.addEventListener('click', () => this._doBulkImport());

    const importBtn = document.getElementById('btn-import-playlist');
    const urlInput = document.getElementById('playlist-url-input');
    if (importBtn && urlInput) {
      importBtn.addEventListener('click', () => this._doPlaylistImport());
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._doPlaylistImport();
      });
    }

    this._loadWatchedPlaylists();
  },

  async _doPlaylistImport() {
    const input = document.getElementById('playlist-url-input');
    const watchToggle = document.getElementById('watch-playlist-toggle');
    if (!input || !input.value.trim()) return;
    const url = input.value.trim();

    const resultEl = document.getElementById('playlist-import-result');
    if (resultEl) resultEl.innerHTML = '<div class="loading-spinner" style="margin:12px auto"></div>';

    try {
      const result = await Api.importPlaylist(url);
      const total = result.total || result.trackCount || 0;
      const queued = result.queued || 0;
      const inLib = result.inLibrary || 0;
      const msg = '<strong>' + this._esc(result.name || 'Playlist') + '</strong>: ' + total + ' tracks found' + (queued > 0 ? ', ' + queued + ' downloading' : '') + (inLib > 0 ? ', ' + inLib + ' already in library' : '');
      if (resultEl) resultEl.innerHTML = '<div class="playlist-import-success">' + msg + '</div>';
      input.value = '';
      this._loadWatchedPlaylists();
      this._pollDownloadBadge();
      this._showToast(queued > 0 ? queued + ' tracks added to queue' : (total > 0 ? total + ' tracks imported' : 'Playlist imported'));
    } catch (e) {
      const detail = e && e.message ? e.message : '';
      if (resultEl) resultEl.innerHTML = '<div class="playlist-import-error">Failed' + (detail ? ': ' + this._esc(detail) : ': invalid URL or yt-dlp not available') + '</div>';
    }
  },

  async _loadWatchedPlaylists() {
    try {
      const playlists = await Api.getWatched();
      const container = document.getElementById('watched-playlists');
      if (!container) return;
      if (!playlists || playlists.length === 0) { container.innerHTML = ''; return; }

      let html = '<div class="watched-list">';
      playlists.forEach(p => {
        html += '<div class="watched-item">'
          + '<div class="watched-info">'
          + '<div class="watched-name">' + this._esc(p.name || 'Unnamed') + '</div>'
          + '<div class="watched-meta">' + (p.trackCount || 0) + ' tracks'
          + (p.lastRefresh ? ' · refreshed ' + new Date(p.lastRefresh).toLocaleDateString() : '')
          + '</div>'
          + '<div class="settings-field settings-field-toggle" style="margin:4px 0 0;padding:0">'
          + '<label style="font-size:11px;color:var(--text3)">Auto-refresh</label>'
          + '<input type="checkbox" class="settings-toggle watched-toggle" data-watch-id="' + this._esc(p.id) + '"' + (p.watching ? ' checked' : '') + '>'
          + '</div>'
          + '</div>'
          + '<div class="watched-actions">'
          + '<button class="watched-btn" data-refresh="' + this._esc(p.id) + '" title="Refresh now">&#x21bb;</button>'
          + '<button class="watched-btn watched-delete" data-delete="' + this._esc(p.id) + '" title="Remove">&times;</button>'
          + '</div>'
          + '</div>';
      });
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.watched-toggle').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
          e.stopPropagation();
          try {
            await Api.toggleWatch(toggle.dataset.watchId, toggle.checked);
          } catch (err) {
            toggle.checked = !toggle.checked;
          }
        });
      });

      container.querySelectorAll('[data-refresh]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await Api.refreshWatch(btn.dataset.refresh);
          this._loadWatchedPlaylists();
          this._pollDownloadBadge();
        });
      });
      container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showConfirm('Delete this watched playlist?', async () => {
            await Api.deleteWatch(btn.dataset.delete);
            this._loadWatchedPlaylists();
          });
        });
      });
    } catch (e) {}
  },

  renderDownloads() {
    this._viewTrackList = [];

    // ponytail: no page-header — the tab already labels this view; reclaiming
    // the 56px title bar was the "wasted space above the filter pills".
    let html = '<div id="downloads-content"><div class="loading-spinner" style="margin:40px auto"></div></div>';

    this.els.content.innerHTML = html;
    this._loadDownloads();
    this._downloadPollTimer = setInterval(() => this._loadDownloads(), 3000);
  },

  async _loadDownloads() {
    const container = document.getElementById('downloads-content');
    if (!container) return;

    // Admin sees every user's jobs (&all=1); resolve userId → username once so
    // job rows can show an owner badge. Cached on first load.
    if (Store.isAdmin && !this._adminUserMap) {
      try { const u = await Api.adminListUsers(); this._adminUserMap = {}; (u.users || []).forEach(x => { this._adminUserMap[x.id] = x.username; }); }
      catch (e) { this._adminUserMap = {}; }
    }

    try {
      let filter = this._downloadFilter || 'all';
      // Map chip → server status so completed/failed aren't hidden behind the
      // 1000-row cap by the queued backlog. 'all' stays unfiltered (actionable
      // items sort first; completed history trimmed at the cap is acceptable).
      const statusFor = (f) => f === 'all' ? '' : f === 'done' ? 'completed' : f === 'needs' ? 'needs_selection' : f;
      let jobs = await Api.getQueue(1000, statusFor(filter));
      const counts = await Api.getQueueCounts();
      this._updateDownloadBadge(counts);
      this._downloadPaused = counts.paused === 1;

      // If the active filter just emptied (Retry All, or its last item resolved),
      // fall back to 'all' so the queue doesn't go blank.
      if (filter !== 'all') {
        let fc = counts[statusFor(filter)] || 0;
        if (filter === 'active') fc = (counts.searching||0)+(counts.downloading||0)+(counts.tagging||0);
        if (!fc) { this._downloadFilter = 'all'; filter = 'all'; jobs = await Api.getQueue(1000, ''); }
      }

      // Refresh library when new downloads complete so album art shows up
      // without requiring a page reload.
      const completedCount = counts.completed || 0;
      if (completedCount > (this._lastCompletedCount || 0)) {
        Store.refreshLibrary().catch(() => {});
      }
      this._lastCompletedCount = completedCount;

      const activeCount = (counts.queued || 0) + (counts.searching || 0) + (counts.downloading || 0);
      const failedCount = counts.failed || 0;
      const needsSel = counts.needs_selection || 0;
      const hasActivity = activeCount > 0 || counts.completed > 0 || counts.failed > 0 || needsSel > 0;

      // Skip the full DOM rebuild when the queue state is unchanged —
      // otherwise the 3s poll rewrites #downloads-content constantly,
      // which blinks the page and steals focus/selection.
      const sig = JSON.stringify(counts) + '|' + (jobs || []).map(j => j.id + ':' + j.status + ':' + (j.progressStage || '')).join(',');
      if (this._downloadsSig === sig) return;
      this._downloadsSig = sig;

      let html = '<div class="queue-stats">';
      // Filter chips: clickable, double as counts. Single scrollable row.
      const activeOnly = (counts.searching || 0) + (counts.downloading || 0) + (counts.tagging || 0);
      const totalCount = activeOnly + (counts.queued || 0) + needsSel + failedCount + (counts.completed || 0);
      const chips = [{ key: 'all', label: 'All', count: totalCount }];
      if (activeOnly > 0) chips.push({ key: 'active', label: 'Active', count: activeOnly });
      if (counts.queued > 0) chips.push({ key: 'queued', label: 'Queued', count: counts.queued });
      if (needsSel > 0) chips.push({ key: 'needs', label: 'Needs Pick', count: needsSel });
      if (failedCount > 0) chips.push({ key: 'failed', label: 'Failed', count: failedCount });
      if (counts.completed > 0) chips.push({ key: 'done', label: 'Done', count: counts.completed });
      html += '<div class="queue-stats-actions">'
        + (Store.isAdmin ? '<button class="settings-btn" id="btn-dl-settings">' + Icons.settings() + '<span style="margin-left:6px">Settings</span></button>' : '')
        + (Store.isAdmin ? '<button class="settings-btn" id="btn-dl-pause">' + (this._downloadPaused ? '&#x25b6; Resume' : '&#x23f8; Pause') + '</button>' : '')
        + (failedCount > 0 ? '<button class="settings-btn settings-btn-primary" id="btn-retry-all-failed">&#x21bb; Retry All</button>' : '')
        + (counts.completed > 0 || counts.failed > 0 ? '<button class="settings-btn" id="btn-clear-history">Clear History</button>' : '')
        + '</div>';
      let chipsHtml = '<div class="dl-chips">';
      chips.forEach(c => {
        const on = filter === c.key;
        chipsHtml += '<button class="dl-chip' + (on ? ' dl-chip-on' : '') + '" data-filter="' + c.key + '"><span>' + this._esc(c.label) + '</span><b>' + c.count + '</b></button>';
      });
      chipsHtml += '</div>';
      html += chipsHtml;
      html += '</div>';

      if (!jobs || jobs.length === 0) {
        html += '<div class="empty-state" style="padding:40px 22px">'
          + '<div class="empty-state-title">No Downloads Yet</div>'
          + '<div class="empty-state-text">Search for music in the Finder tab and tap download to start.</div></div>';
        container.innerHTML = html;
        const sBtn = document.getElementById('btn-dl-settings');
        if (sBtn) sBtn.addEventListener('click', () => this._openDownloadsSettings());
        return;
      }

      html += '<div class="queue-job-list">';
      const shown = jobs.filter(j => {
        if (filter === 'all') return true;
        if (filter === 'active') return j.status === 'searching' || j.status === 'downloading' || j.status === 'tagging';
        if (filter === 'queued') return j.status === 'queued';
        if (filter === 'needs') return j.status === 'needs_selection';
        if (filter === 'failed') return j.status === 'failed';
        if (filter === 'done') return j.status === 'completed';
        return true;
      });
      if (shown.length === 0) {
        html += '<div class="empty-state" style="padding:30px 18px">'
          + '<div class="empty-state-title">No ' + (filter === 'all' ? 'Downloads' : chips.find(c => c.key === filter).label) + '</div></div>';
      }
      const now = Date.now();
      let queuedIndex = 0;
      shown.forEach(j => {
        const active = j.status === 'searching' || j.status === 'downloading' || j.status === 'tagging';
        const isQueued = j.status === 'queued';
        const failed = j.status === 'failed';
        const completed = j.status === 'completed';
        const needsSelection = j.status === 'needs_selection';

        let elapsed = '';
        if (active || isQueued) {
          const created = new Date(j.createdAt).getTime();
          const diffSec = Math.floor((now - created) / 1000);
          if (diffSec < 60) elapsed = 'just now';
          else if (diffSec < 3600) elapsed = Math.floor(diffSec / 60) + 'm ago';
          else elapsed = Math.floor(diffSec / 3600) + 'h ' + Math.floor((diffSec % 3600) / 60) + 'm ago';
        }

        let queuePos = '';
        if (isQueued) {
          queuedIndex++;
          queuePos = '<span class="queue-pos">#' + queuedIndex + ' in line</span>';
        }

        const clickable = completed && j.filePath;
        let leftHtml;
        if (completed && j.artist && j.title) {
          const libTrack = Store.library.tracks.find(t =>
            t.artist && t.title &&
            t.artist.toLowerCase() === (j.artist || '').toLowerCase() &&
            t.title.toLowerCase() === (j.title || '').toLowerCase()
          );
          if (libTrack && libTrack.albumID) {
            leftHtml = '<div class="queue-job-art">'
              + '<img src="' + Api.coverUrl(libTrack.albumID) + '" alt="" onerror="this.style.display=\'none\'">'
              + '</div>';
          }
        }
        if (!leftHtml) {
          leftHtml = '<div class="queue-job-status ' + (active ? 'job-active' : isQueued ? 'job-queued' : failed ? 'job-failed' : 'job-done') + '">'
          + (active ? '<div class="queue-spinner"></div>' : isQueued ? '<div class="queue-status-dot dot-waiting"></div>' : (failed ? '<div class="queue-status-dot dot-failed"></div>' : '<div class="queue-status-dot dot-done"></div>'))
          + '</div>';
        }        const cardClass = active ? ' queue-active' : isQueued ? ' queue-waiting' : needsSelection ? ' queue-needs-selection' : '';
        const isClickable = clickable || needsSelection;
        html += '<div class="queue-job-card' + cardClass + (isClickable ? ' queue-job-clickable' : '') + '"'
          + (clickable ? ' data-artist="' + this._esc(j.artist || '') + '" data-title="' + this._esc(j.title || '') + '"' : '')
          + (needsSelection ? ' data-job-id="' + this._esc(j.id) + '"' : '') + '>'
          + leftHtml
          + '<div class="queue-job-info">'
          + '<div class="queue-job-title">' + this._esc(j.artist || '') + (j.artist && j.title ? ' - ' : '') + this._esc(j.title || j.query || 'Unknown') + '</div>'
      + '<div class="queue-job-detail">'
      + (completed ? (j.audioQuality ? '<span class="queue-job-quality">' + this._esc(j.audioQuality) + '</span>' : '<span>Completed</span>') : (active ? '<span class="queue-elapsed">' + elapsed + '</span>' : (isQueued ? queuePos + '<span class="queue-elapsed">' + elapsed + '</span>' : '<span>' + j.status + '</span>')))
      + (j.source ? '<span class="source-tag source-tag-' + this._esc(j.source) + '">' + (j.source === 'soulseek' ? 'SLSK' : 'YT') + '</span>' : '')
      + (j.progressStage && !isQueued && !completed ? '<span class="queue-stage">' + this._esc(j.progressStage) + '</span>' : '')
      + (!completed && j.audioQuality ? '<span class="queue-job-quality">' + this._esc(j.audioQuality) + '</span>' : '')
      + (failed && j.error ? '<span class="queue-job-error">' + this._esc(j.error) + '</span>' : '')
      + (Store.isAdmin && j.userId ? '<span style="font-size:11px;color:var(--accent);background:rgba(212,240,64,.12);padding:2px 7px;border-radius:6px">@' + this._esc((this._adminUserMap && this._adminUserMap[j.userId]) || String(j.userId).slice(0, 8)) + '</span>' : '')
      + '</div>'
          + '</div>'
      + '<div class="queue-job-actions">'
      + (needsSelection ? '<button class="queue-item-select" data-job-id="' + this._esc(j.id) + '" title="Pick a source">&#x2699;</button>' : '')
      + (completed && j.filePath ? '<a class="queue-item-download" href="' + Api.downloadJobUrl(j.id) + '" title="Download file" download>' + Icons.download() + '</a>' : '')
      + (failed ? '<button class="queue-item-retry" data-job-id="' + this._esc(j.id) + '" title="Retry">&#x21bb;</button>' : '')
      + '<button class="queue-item-delete" data-job-id="' + this._esc(j.id) + '" title="Remove">&times;</button>'
      + '</div>'
          + '</div>';
      });
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.queue-item-retry').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          Api.retryJob(btn.dataset.jobId).then(() => this._loadDownloads());
        });
      });

      container.querySelectorAll('.dl-chip[data-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
          this._downloadFilter = btn.dataset.filter;
          this._downloadsSig = ''; // force re-render despite unchanged counts
          this._loadDownloads();
        });
      });
      container.querySelectorAll('.queue-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.showConfirm('Delete this download job?', () => {
            Api.deleteJob(btn.dataset.jobId).then(() => this._loadDownloads());
          });
        });
      });

      container.querySelectorAll('.queue-item-select').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const job = jobs.find(j => j.id === btn.dataset.jobId);
          if (job && job.candidates) {
            this._showCandidateModal(job);
          }
        });
      });

      container.querySelectorAll('.queue-job-clickable').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.queue-job-actions')) return;
          const jobId = card.dataset.jobId;
          if (jobId) {
            const job = jobs.find(j => j.id === jobId);
            if (job && job.candidates) {
              this._showCandidateModal(job);
              return;
            }
          }
          const artist = card.dataset.artist;
          const title = card.dataset.title;
          if (!artist || !title) return;
          const find = () => Store.library.tracks.find(t =>
            t.artist && t.title &&
            t.artist.toLowerCase() === artist.toLowerCase() &&
            t.title.toLowerCase() === title.toLowerCase()
          );
          const tryPlay = (track) => {
            if (!track) return false;
            Player.play(track, [track], { type: 'album', name: track.album || '', id: track.albumID });
            return true;
          };
          const track = find();
          if (!tryPlay(track)) {
            Store.refreshLibrary().then(() => {
              if (!tryPlay(find())) {
                this._showToast('Track not yet in library — try scanning first');
              }
            });
          }
        });
      });

      const retryAllBtn = document.getElementById('btn-retry-all-failed');
      if (retryAllBtn) {
        retryAllBtn.addEventListener('click', async () => {
          retryAllBtn.disabled = true;
          retryAllBtn.textContent = 'Retrying...';
          const failed = jobs.filter(j => j.status === 'failed');
          for (const j of failed) {
            await Api.retryJob(j.id);
            await new Promise(r => setTimeout(r, 200));
          }
          this._loadDownloads();
        });
      }

      const clearBtn = document.getElementById('btn-clear-history');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          this.showConfirm('Clear all completed download history?', async () => {
            clearBtn.disabled = true;
            clearBtn.textContent = 'Clearing...';
            try {
              await Api.clearCompletedJobs();
              this._pollDownloadBadge();
              this._loadDownloads();
            } catch (e) {
              this.showToast('Failed to clear history');
              clearBtn.disabled = false;
              clearBtn.textContent = 'Clear History';
            }
          });
        });
      }

      const dlSettingsBtn = document.getElementById('btn-dl-settings');
      if (dlSettingsBtn) dlSettingsBtn.addEventListener('click', () => this._openDownloadsSettings());

      const pauseBtn = document.getElementById('btn-dl-pause');
      if (pauseBtn) {
        pauseBtn.addEventListener('click', async () => {
          try {
            const res = await Api.toggleDownloadPause();
            this._downloadPaused = res.paused;
            pauseBtn.innerHTML = res.paused ? '&#x25b6; Resume' : '&#x23f8; Pause';
          } catch (e) {
            this.showToast('Failed to toggle pause');
          }
        });
      }
    } catch (e) {
      container.innerHTML = '<div class="empty-state-text">Failed to load downloads</div>';
    }
  },

  async _pollFinderStatus() {
    if (Store.isGuest) return;
    try {
      const counts = await Api.getQueueCounts();
      this._updateDownloadBadge(counts);
      const active = (counts.queued || 0) + (counts.searching || 0) + (counts.downloading || 0) + (counts.tagging || 0);
      if (active > 0) {
        this._downloadJobs = await Api.getQueue();
        this._updateFinderBadges();
        this._finderStatusPoll = setTimeout(() => this._pollFinderStatus(), 5000);
      } else {
        if (this._downloadJobs && this._downloadJobs.some(j => j.status === 'completed')) {
          this._downloadJobs = await Api.getQueue();
          this._updateFinderBadges();
        }
        this._finderStatusPoll = setTimeout(() => this._pollFinderStatus(), 15000);
      }
    } catch (e) {
      this._finderStatusPoll = setTimeout(() => this._pollFinderStatus(), 15000);
    }
  },

  _updateFinderBadges() {
    this.els.content.querySelectorAll('.finder-download-btn').forEach(btn => {
      const artist = btn.dataset.artist;
      const title = btn.dataset.title;
      const libTrack = Store.library.tracks.find(t =>
        t.artist && t.title &&
        t.artist.toLowerCase() === (artist || '').toLowerCase() &&
        t.title.toLowerCase() === (title || '').toLowerCase()
      );
      if (libTrack) {
        const badge = document.createElement('span');
        badge.className = 'finder-status-badge finder-in-library';
        badge.textContent = 'In Library';
        btn.replaceWith(badge);
      } else if (this._isQueued(artist, title)) {
        const badge = document.createElement('span');
        badge.className = 'finder-status-badge finder-in-queue';
        badge.textContent = 'Queued';
        btn.replaceWith(badge);
      }
    });
  },

  _showCandidateModal(job) {
    let candidates;
    try { candidates = typeof job.candidates === 'string' ? JSON.parse(job.candidates) : job.candidates; } catch { return; }
    if (!candidates || !candidates.length) return;

    const existing = document.querySelector('.candidate-modal-overlay');
    if (existing) existing.remove();

    let listHtml = '';
    candidates.forEach(c => {
      const dur = c.duration > 0 ? Math.floor(c.duration / 60) + ':' + String(c.duration % 60).padStart(2, '0') : '';
      const scoreLabel = c.score >= 60 ? 'Good' : c.score >= 30 ? 'Fair' : 'Weak';
      const scoreClass = c.score >= 60 ? 'score-good' : c.score >= 30 ? 'score-fair' : 'score-weak';
      const isSlsk = !!c.format || !!c.filename;
      let artHtml, subtitleParts = [this._esc(c.channel)];
      if (isSlsk) {
        const fmtBadge = c.format ? '<span class="cand-badge">' + this._esc(c.format.toUpperCase()) + '</span>' : '';
        const sizeBadge = c.sizeMB ? '<span class="cand-badge">' + this._esc(c.sizeMB) + '</span>' : '';
        const brBadge = c.bitrate ? '<span class="cand-badge">' + c.bitrate + 'k</span>' : '';
        artHtml = '<div class="candidate-item-icon">' + fmtBadge + sizeBadge + brBadge + '</div>';
        if (dur) subtitleParts.push(dur);
      } else {
        artHtml = '<div class="candidate-item-art"><img src="https://i.ytimg.com/vi/' + this._esc(c.videoId) + '/default.jpg" alt="" onerror="this.style.display=\'none\'"></div>';
        if (dur) subtitleParts.push(dur);
      }
      listHtml += '<div class="candidate-item" data-video-id="' + this._esc(c.videoId) + '">'
        + artHtml
        + '<div class="candidate-item-info">'
        + '<div class="candidate-item-title">' + this._esc(c.title) + '</div>'
        + '<div class="candidate-item-subtitle">' + subtitleParts.join(' &middot; ') + '</div>'
        + '</div>'
        + '<span class="candidate-score ' + scoreClass + '">' + scoreLabel + '</span>'
        + '</div>';
    });

    const overlay = document.createElement('div');
    overlay.className = 'candidate-modal-overlay';
    overlay.innerHTML = '<div class="candidate-modal">'
      + '<div class="candidate-modal-header">'
      + '<div class="candidate-modal-title">Pick a source for<br><strong>' + this._esc(job.artist || '') + (job.artist && job.title ? ' - ' : '') + this._esc(job.title || '') + '</strong></div>'
      + '<button class="candidate-modal-close">&times;</button>'
      + '</div>'
      + '<div class="candidate-modal-list">' + listHtml + '</div>'
      + '<div class="candidate-modal-actions">'
      + '<button class="settings-btn" id="cand-search-again">Search Again</button>'
      + '<button class="settings-btn settings-btn-danger" id="cand-remove">Remove</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    overlay.querySelector('.candidate-modal-close').addEventListener('click', () => this._fadeOutRemove(overlay, 200));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this._fadeOutRemove(overlay, 200); });

    overlay.querySelector('#cand-remove').addEventListener('click', () => {
      Api.deleteJob(job.id).then(() => {
        this._fadeOutRemove(overlay, 200);
        this._showToast('Removed from queue');
        this._loadDownloads();
      }).catch(() => this._showToast('Failed to remove'));
    });

    overlay.querySelector('#cand-search-again').addEventListener('click', () => {
      Api.retryJob(job.id).then(() => {
        this._fadeOutRemove(overlay, 200);
        this._showToast('Searching again...');
        this._loadDownloads();
      }).catch(() => this._showToast('Failed to retry'));
    });

    overlay.querySelectorAll('.candidate-item').forEach(item => {
      item.addEventListener('click', () => {
        const videoId = item.dataset.videoId;
        item.style.opacity = '0.5';
        item.style.pointerEvents = 'none';
        Api.selectVideo(job.id, videoId).then(() => {
          this._fadeOutRemove(overlay, 200);
          this._showToast('Download resumed with selected source');
          this._loadDownloads();
        }).catch(() => {
          this._showToast('Failed to select');
          item.style.opacity = '';
          item.style.pointerEvents = '';
        });
      });
    });
  },

  _updateDownloadBadge(counts) {
    const active = (counts.queued || 0) + (counts.searching || 0) + (counts.downloading || 0) + (counts.tagging || 0);
    const needsSel = counts.needs_selection || 0;
    const done = counts.completed || 0;
    const total = done + active + needsSel;
    const pending = active + needsSel;
    const tab = document.querySelector('[data-tab="finder"] .tab-badge');
    if (tab) {
      // Show progress as done/total while work remains; hide once drained.
      tab.textContent = (total > 0 && pending > 0) ? (done + '/' + total) : '';
      tab.style.display = (total > 0 && pending > 0) ? '' : 'none';
    }
  },

  _pollDownloadBadge() {
    if (Store.isGuest) return;
    Api.getQueueCounts().then(counts => {
      this._updateDownloadBadge(counts);
      const active = (counts.queued || 0) + (counts.searching || 0) + (counts.downloading || 0) + (counts.tagging || 0);
      if (active > 0 && !this._downloadPollInterval) {
        this._downloadPollInterval = setInterval(() => this._pollDownloadBadge(), 5000);
      } else if (active === 0 && this._downloadPollInterval) {
        clearInterval(this._downloadPollInterval);
        this._downloadPollInterval = null;
      }
    }).catch(() => {});
  },

  async _renderFinderResults() {
    const container = this.els.content.querySelector('#finder-results');
    if (!container) return;

    const requestId = (this._finderSearchRequestId || 0) + 1;
    this._finderSearchRequestId = requestId;
    const query = this._finderQuery;
    const type = this._finderType;
    const isCurrentRequest = () => requestId === this._finderSearchRequestId
      && query === this._finderQuery
      && type === this._finderType
      && this.els.content.querySelector('#finder-results') === container;

    if (!query) {
      container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
        + '<div class="empty-state-text">Search for songs, artists, or albums on MusicBrainz</div></div>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    try {
      if (type === 'recording' || type === 'youtube') {
        let downloadJobs;
        try { downloadJobs = await Api.getQueue(); } catch(e) { downloadJobs = []; }
        if (!isCurrentRequest()) return;
        this._downloadJobs = downloadJobs;
      }
      let results;
      if (type === 'youtube') {
        results = await Api.finderYouTubeSearch(query);
      } else {
        results = await Api.finderSearch(query, type);
      }
      if (!isCurrentRequest()) return;
      this._finderResults = results;
      this._addSearchHistory(query);
      this._renderFinderResultsList(container, results);
    } catch (err) {
      if (!isCurrentRequest()) return;
      container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
        + '<div class="empty-state-text">Search failed. MusicBrainz may be rate-limited — try again in a moment.</div></div>';
    }
  },

  _addSearchHistory(q) {
    if (!q) return;
    if (!this._finderHistory) this._finderHistory = JSON.parse(localStorage.getItem('finderHistory') || '[]');
    this._finderHistory = this._finderHistory.filter(h => h !== q);
    this._finderHistory.unshift(q);
    if (this._finderHistory.length > 20) this._finderHistory = this._finderHistory.slice(0, 20);
    localStorage.setItem('finderHistory', JSON.stringify(this._finderHistory));
  },

  _renderFinderResultsList(container, results) {
    if (!results || results.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
        + '<div class="empty-state-title">No results</div>'
        + '<div class="empty-state-text">Try different keywords</div></div>';
      return;
    }

    let html = '';

    if (this._finderType === 'recording') {
      html += '<div class="finder-results-count">' + results.length + ' song' + (results.length !== 1 ? 's' : '') + '</div>';
      html += '<div class="finder-list">';
      results.forEach(r => {
        const length = r.length > 0 ? Math.floor(r.length / 60) + ':' + String(r.length % 60).padStart(2, '0') : '';
        let statusHtml;
        if (r.inLibrary) {
          statusHtml = '<span class="finder-status-badge finder-in-library">In Library</span>';
        } else if (this._isQueued(r.artist, r.title)) {
          statusHtml = '<span class="finder-status-badge finder-in-queue">Queued</span>';
        } else {
          statusHtml = '<button class="finder-download-btn" data-action="download-song" data-artist="' + this._esc(r.artist) + '" data-title="' + this._esc(r.title) + '" data-album="' + this._esc(r.album || '') + '" data-album-mbid="' + this._esc(r.albumId || '') + '" aria-label="Download ' + this._esc(r.title) + '" title="Download">' + Icons.download() + '<span>Download</span></button>';
        }
        html += '<div class="finder-item">'
          + '<div class="finder-item-art"><img src="' + (r.albumId ? Api.finderCoverUrl(r.albumId) : '') + '" alt="" onerror="this.style.display=\'none\'"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.title) + '</div>'
          + '<div class="finder-item-subtitle">' + this._esc(r.artist) + (r.album ? ' · ' + this._esc(r.album) : '') + (r.year ? ' (' + r.year + ')' : '') + '</div>'
          + '</div>'
          + (length ? '<span class="finder-duration">' + length + '</span>' : '')
          + statusHtml
          + '</div>';
      });
      html += '</div>';
    } else if (this._finderType === 'youtube') {
      html += '<div class="finder-results-count">' + results.length + ' result' + (results.length !== 1 ? 's' : '') + ' on YouTube</div>';
      html += '<div class="finder-list">';
      results.forEach(r => {
        const length = r.duration > 0 ? Math.floor(r.duration / 60) + ':' + String(r.duration % 60).padStart(2, '0') : '';
        let statusHtml;
        if (r.inLibrary) {
          statusHtml = '<span class="finder-status-badge finder-in-library">In Library</span>';
        } else if (this._isQueued(r.channel, r.title)) {
          statusHtml = '<span class="finder-status-badge finder-in-queue">Queued</span>';
        } else {
          statusHtml = '<button class="finder-download-btn" data-action="download-song" data-artist="' + this._esc(r.channel) + '" data-title="' + this._esc(r.title) + '" aria-label="Download ' + this._esc(r.title) + '" title="Download">' + Icons.download() + '<span>Download</span></button>';
        }
        html += '<div class="finder-item">'
          + '<button class="finder-preview-btn" data-preview="' + this._esc(r.videoId) + '" title="Preview">&#9654;</button>'
          + '<div class="finder-item-art"><img src="https://i.ytimg.com/vi/' + this._esc(r.videoId) + '/default.jpg" alt="" onerror="this.style.display=\'none\'"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.title) + '</div>'
          + '<div class="finder-item-subtitle">' + this._esc(r.channel) + '</div>'
          + '</div>'
          + '<div class="finder-item-meta">'
          + (length ? '<span class="finder-duration">' + length + '</span>' : '')
          + '</div>'
          + statusHtml
          + '</div>';
      });
      html += '</div>';
    } else if (this._finderType === 'artist') {
      html += '<div class="finder-results-count">' + results.length + ' artist' + (results.length !== 1 ? 's' : '') + '</div>';
      html += '<div class="finder-list">';
      results.forEach(r => {
        const type = r.type ? '<span class="finder-type-badge">' + this._esc(r.type) + '</span>' : '';
        html += '<div class="finder-item finder-item-artist" data-finder-artist="' + this._esc(r.id) + '" data-finder-artist-name="' + this._esc(r.name) + '">'
          + '<div class="finder-item-art round"><img src="' + Api.artistArtUrl(r.name) + '" alt="" data-artist-art-fetch="' + this._esc(r.name) + '"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.name) + '</div>'
          + '<div class="finder-item-subtitle">' + (r.disambiguation ? this._esc(r.disambiguation) + ' · ' : '') + (r.country || '') + '</div>'
          + '</div>'
          + '<div class="finder-item-meta">' + type
          + (r.inLibrary ? '<span class="finder-status-badge finder-in-library">In Library</span>' : '')
          + '</div>'
          + '</div>';
      });
      html += '</div>';
    } else if (this._finderType === 'release') {
      html += '<div class="finder-results-count">' + results.length + ' album' + (results.length !== 1 ? 's' : '') + '</div>';
      html += '<div class="finder-list">';
      results.forEach(r => {
        const typeBadge = r.type ? '<span class="finder-type-badge">' + this._esc(r.type) + '</span>' : '';
        html += '<div class="finder-item" data-finder-release="' + this._esc(r.id) + '" data-finder-release-title="' + this._esc(r.title) + '" data-finder-release-artist="' + this._esc(r.artist) + '">'
          + '<div class="finder-item-art"><img src="' + Api.finderCoverUrl(r.id) + '" alt="" onerror="this.style.display=\'none\'"></div>'
          + '<div class="finder-item-info">'
          + '<div class="finder-item-title">' + this._esc(r.title) + '</div>'
          + '<div class="finder-item-subtitle">' + this._esc(r.artist) + (r.year ? ' · ' + r.year : '') + (r.trackCount ? ' · ' + r.trackCount + ' tracks' : '') + '</div>'
          + '</div>'
          + '<div class="finder-item-meta">' + typeBadge
          + (r.inLibrary ? '<span class="finder-status-badge finder-in-library">In Library</span>' : '')
          + '</div>'
          + '</div>';
      });
      html += '</div>';
    }

    container.innerHTML = html;
    this._fadeIn(container);
    this._bindFinderResults();
  },

  _bindFinderResults() {
    const container = this.els.content.querySelector('#finder-results');
    if (!container) return;

    container.addEventListener('click', async (e) => {
      const previewBtn = e.target.closest('.finder-preview-btn');
      if (previewBtn) {
        e.stopPropagation();
        this._doPreview(previewBtn);
        return;
      }

      const dlBtn = e.target.closest('[data-action="download-song"]');
      if (dlBtn) {
        if (Store.isGuest) { this._showAccountRequired(); return; }
        e.stopPropagation();
        dlBtn.disabled = true;
        const queued = await this._addToQueue({
          artist: dlBtn.dataset.artist,
          title: dlBtn.dataset.title,
          album: dlBtn.dataset.album || '',
          albumMbid: dlBtn.dataset.albumMbid || ''
        });
        if (queued) {
          const badge = document.createElement('span');
          badge.className = 'finder-status-badge finder-in-queue';
          badge.textContent = 'Queued';
          dlBtn.replaceWith(badge);
        } else {
          dlBtn.disabled = false;
        }
        return;
      }

      const artistItem = e.target.closest('.finder-item-artist');
      if (artistItem) {
        const mbid = artistItem.dataset.finderArtist;
        const name = artistItem.dataset.finderArtistName;
        if (mbid) this.navigateTo('finder-artist', { mbid, name });
        return;
      }

      const releaseItem = e.target.closest('[data-finder-release]');
      if (releaseItem) {
        const mbid = releaseItem.dataset.finderRelease;
        const title = releaseItem.dataset.finderReleaseTitle;
        const artist = releaseItem.dataset.finderReleaseArtist;
        if (mbid) this.navigateTo('finder-release', { mbid, title, artist });
        return;
      }
    });
  },

  async _doPreview(btn) {
    if (this._previewAudio) {
      this._previewAudio.pause();
      this._previewAudio = null;
    }
    const videoId = btn.dataset.preview;
    const original = btn.textContent;
    btn.textContent = '...';
    btn.disabled = true;
    try {
      const result = await Api.previewUrl(videoId);
      const streamUrl = result.url;
      if (!streamUrl) { this._showToast('Preview unavailable'); return; }
      const audio = new Audio(streamUrl);
      audio.volume = 0.3;
      this._previewAudio = audio;
      audio.play().catch(() => this._showToast('Preview failed'));
    } catch (e) {
      this._showToast('Preview failed');
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  },

  async _addToQueue(track) {
    try {
      await Api.queueAdd(track);
      this._showToast('Added to download queue');
      try { this._downloadJobs = await Api.getQueue(); } catch(e) {}
      return true;
    } catch (err) {
      const msg = err.message || 'Failed to add to queue';
      if (msg.includes('already in library') || msg.includes('already')) {
        this._showToast('Already in your library');
      } else {
        this._showToast(msg);
      }
      return false;
    }
  },

  _showToast(msg) {
    this.showToast(msg);
  },

  renderFinderArtist(data) {
    this._viewTrackList = [];
    const name = data.name || 'Artist';

    if (!this._artistView) this._artistView = 'tracklist';

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">' + this._esc(name) + '</span>'
      + '</div>'
      + '<div class="lib-tabs">'
      + '<button class="lib-tab' + (this._artistView === 'tracklist' ? ' active' : '') + '" data-artist-tab="tracklist">Tracklist</button>'
      + '<button class="lib-tab' + (this._artistView === 'albums' ? ' active' : '') + '" data-artist-tab="albums">Albums</button>'
      + '<button class="lib-tab' + (this._artistView === 'downloads' ? ' active' : '') + '" data-artist-tab="downloads">Downloads</button>'
      + '</div>'
      + '<div id="finder-artist-content">'
      + '<div id="artist-tracklist-panel"><div class="loading-spinner" style="margin:40px auto"></div></div>'
      + '<div id="artist-albums-panel" style="display:none"></div>'
      + '</div>';

    this.els.content.innerHTML = html;

    this.els.content.querySelectorAll('[data-artist-tab]').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.dataset.artistTab === 'downloads') {
          this._finderTab = 'downloads';
          this.navigateTo('finder');
          return;
        }
        this._artistView = chip.dataset.artistTab;
        const tlPanel = document.getElementById('artist-tracklist-panel');
        const alPanel = document.getElementById('artist-albums-panel');
        if (tlPanel) tlPanel.style.display = this._artistView === 'tracklist' ? '' : 'none';
        if (alPanel) alPanel.style.display = this._artistView === 'albums' ? '' : 'none';
        this.els.content.querySelectorAll('[data-artist-tab]').forEach(c => c.classList.toggle('active', c.dataset.artistTab === this._artistView));
        if (this._artistView === 'albums' && alPanel && !alPanel.hasChildNodes()) {
          this._renderArtistAlbums(alPanel, this._artistReleases);
        }
      });
    });

    this._artistReleases = null;
    this._artistTrackCache = null;
    this._artistTrackFetching = false;
    Api.finderArtistReleases(data.mbid).then(releases => {
      const tlPanel = document.getElementById('artist-tracklist-panel');
      if (!tlPanel) return;

      if (!releases || releases.length === 0) {
        tlPanel.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
          + '<div class="empty-state-text">No releases found for this artist</div></div>';
        return;
      }

      this._artistReleases = releases;
      this._renderArtistTracklist(tlPanel, releases, name);
    }).catch(() => {
      const tlPanel = document.getElementById('artist-tracklist-panel');
      if (tlPanel) tlPanel.innerHTML = '<div class="empty-state-text">Failed to load releases</div>';
    });
  },

  _renderArtistAlbums(container, releases) {
    let rhtml = '<div class="finder-results-count">' + releases.length + ' release' + (releases.length !== 1 ? 's' : '') + '</div>';
    rhtml += '<div class="scroll-row" style="flex-wrap:wrap">';
    releases.forEach(r => {
      const typeLabel = r.type || '';
      rhtml += '<div class="card" data-finder-release="' + this._esc(r.id) + '" data-finder-release-title="' + this._esc(r.title) + '" data-finder-release-artist="' + this._esc(r.artist) + '">'
        + '<div class="card-art"><img src="' + Api.finderCoverUrl(r.id) + '" alt="" onerror="this.style.display=\'none\'"></div>'
        + '<div class="card-title">' + this._esc(r.title) + '</div>'
        + '<div class="card-subtitle">' + (r.year || '') + (typeLabel && r.year ? ' · ' : '') + (typeLabel ? typeLabel : '') + '</div>'
        + '</div>';
    });
    rhtml += '</div>';

    container.innerHTML = rhtml;

    container.querySelectorAll('[data-finder-release]').forEach(el => {
      el.addEventListener('click', () => {
        this.navigateTo('finder-release', {
          mbid: el.dataset.finderRelease,
          title: el.dataset.finderReleaseTitle,
          artist: el.dataset.finderReleaseArtist
        });
      });
    });
  },

  async _renderArtistTracklist(container, releases, artistName) {
    if (this._artistTrackCache) {
      this._renderArtistTracklistDOM(container, this._artistTrackCache, this._artistTrackTotal, releases, artistName);
      return;
    }
    if (this._artistTrackFetching) return;
    this._artistTrackFetching = true;
    this._artistTrackOffset = 0;
    this._artistTrackCache = [];
    this._artistTrackTotal = 0;

    container.innerHTML = '<div style="padding:32px 22px;text-align:center">'
      + '<div style="max-width:280px;margin:0 auto">'
      + '<div class="progress-bar-track"><div class="progress-bar-fill" style="animation:progress-pulse 1.8s ease-in-out infinite"></div></div>'
      + '<div style="color:var(--text2);font-size:14px;margin-top:16px;font-weight:500">Finding popular tracks&hellip;</div>'
      + '<div style="color:var(--text3);font-size:13px;margin-top:4px">This can take a moment for artists with large catalogs.</div>'
      + '</div></div>';

    const page = await Api.finderArtistTracks(releases[0].artistId || '', artistName, 0).catch(() => null);
    this._artistTrackFetching = false;

    if (!page || !page.tracks || page.tracks.length === 0) {
      if (this._artistView === 'tracklist' && this._artistTrackCache.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
          + '<div class="empty-state-text">' + (page === null ? 'Failed to load tracks' : 'No tracks found') + '</div></div>';
      }
      return;
    }

    this._artistTrackCache = page.tracks;
    this._artistTrackTotal = page.total;
    this._artistTrackOffset = 100;
    if (this._artistView === 'tracklist') {
      this._renderArtistTracklistDOM(container, this._artistTrackCache, this._artistTrackTotal, releases, artistName);
    }
  },

  _renderArtistTracklistDOM(container, allTracks, totalCount, releases, artistName) {
    const hasMore = allTracks.length < totalCount;
    let html = '<div class="tracklist-toolbar">'
      + '<div class="search-container finder-search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input artist-tracklist-search" type="search" enterkeyhint="search" placeholder="Filter tracks...">'
      + '</div>'
      + (hasMore ? '<button class="finder-load-more-btn" id="btn-load-more-tracks"><span>Load More</span></button>' : '')
      + '<button class="settings-btn settings-btn-primary" id="btn-download-all-artist" style="display:none">' + Icons.download() + '<span>Download All</span></button>'
      + '</div>';
    html += '<div class="finder-results-count" style="font-size:15px;text-align:right;padding:12px var(--page-margin) var(--sp-2);color:var(--text1)">' + allTracks.length + ' unique track' + (allTracks.length !== 1 ? 's' : '') + '</div>';
    html += '<div class="finder-tracklist">';
    allTracks.forEach((t, i) => {
      const length = t.length > 0 ? Math.floor(t.length / 60) + ':' + String(t.length % 60).padStart(2, '0') : '';
      let statusHtml;
      if (t.inLibrary) {
        statusHtml = '<span class="finder-status-badge finder-in-own-library">In Library</span>';
      } else if (this._isQueued(t.artist, t.title)) {
        statusHtml = '<span class="finder-status-badge finder-in-queue">Queued</span>';
      } else {
        statusHtml = '<button class="finder-download-btn finder-track-dl" data-action="download-song" data-artist="' + this._esc(t.artist) + '" data-title="' + this._esc(t.title) + '" data-album="' + this._esc(t.album) + '" data-album-mbid="' + this._esc(t.albumId) + '" data-track-number="' + (t.position || (i+1)) + '" data-track-total="0" title="Download">' + Icons.download() + '<span>Download</span></button>';
      }
      html += '<div class="finder-track-row" data-track-search="' + this._esc((t.title + ' ' + t.album + ' ' + t.artist).toLowerCase()) + '">'
        + '<div class="finder-track-num">' + (i + 1) + '</div>'
        + '<div class="finder-track-info">'
        + '<div class="finder-track-title">' + this._esc(t.title) + '</div>'
        + '<div class="finder-track-artist">' + this._esc(t.album || '') + '</div>'
        + '</div>'
        + (length ? '<div class="finder-track-length">' + length + '</div>' : '')
        + statusHtml
        + '</div>';
    });
    html += '</div>';

    container.innerHTML = html;

    const loadMoreBtn = container.querySelector('#btn-load-more-tracks');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', async () => {
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = '<div class="progress-bar-track" style="width:80px"><div class="progress-bar-fill" style="animation:progress-pulse 1.8s ease-in-out infinite"></div></div>';
        const page = await Api.finderArtistTracks(releases[0].artistId || '', artistName, this._artistTrackOffset).catch(() => null);
        if (page && page.tracks && page.tracks.length > 0) {
          page.tracks.forEach(t => {
            const key = t.title.toLowerCase();
            if (!this._artistTrackCache.find(c => c.title.toLowerCase() === key)) {
              this._artistTrackCache.push(t);
            }
          });
          this._artistTrackOffset += 100;
        }
        this._renderArtistTracklistDOM(container, this._artistTrackCache, this._artistTrackTotal, releases, artistName);
      });
    }

    const dlAllBtn = container.querySelector('#btn-download-all-artist');
    if (dlAllBtn) {
      dlAllBtn.addEventListener('click', () => {
        if (Store.isGuest) { this._showAccountRequired(); return; }
        const toDownload = allTracks.filter(t => !t.inLibrary);
        if (toDownload.length === 0) {
          this._showToast('All tracks are already in your library');
          return;
        }
        const trackList = toDownload.map((t, i) => ({
          artist: t.artist,
          title: t.title,
          album: t.album || '',
          albumMbid: t.albumId || '',
          trackNumber: i + 1,
          trackTotal: toDownload.length
        }));
        Api.queueAddBatch(trackList).then(() => {
          this._showToast(toDownload.length + ' tracks added to queue');
          container.querySelectorAll('.finder-track-dl').forEach(btn => {
            const badge = document.createElement('span');
            badge.className = 'finder-status-badge finder-in-queue';
            badge.textContent = 'Queued';
            btn.replaceWith(badge);
          });
          dlAllBtn.disabled = true;
          dlAllBtn.innerHTML = Icons.download() + '<span>Queued</span>';
          dlAllBtn.style.opacity = '0.6';
        }).catch(() => {
          this._showToast('Failed to add tracks to queue');
        });
      });
    }

    const searchInput = container.querySelector('.artist-tracklist-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        const countEl = container.querySelector('.finder-results-count');
        let visible = 0;
        container.querySelectorAll('.finder-track-row').forEach(row => {
          const match = !q || (row.dataset.trackSearch || '').includes(q);
          row.style.display = match ? '' : 'none';
          if (match) visible++;
        });
        if (countEl) countEl.textContent = q ? visible + ' of ' + allTracks.length + ' tracks' : allTracks.length + ' unique track' + (allTracks.length !== 1 ? 's' : '');
      });
    }

    container.querySelectorAll('.finder-track-dl').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true;
        const queued = await this._addToQueue({
          artist: btn.dataset.artist,
          title: btn.dataset.title,
          album: btn.dataset.album || '',
          albumMbid: btn.dataset.albumMbid || '',
          trackNumber: parseInt(btn.dataset.trackNumber) || 0,
          trackTotal: parseInt(btn.dataset.trackTotal) || 0
        });
        if (queued) {
          const badge = document.createElement('span');
          badge.className = 'finder-status-badge finder-in-queue';
          badge.textContent = 'Queued';
          btn.replaceWith(badge);
        } else {
          btn.disabled = false;
        }
      });
    });
  },

  renderFinderRelease(data) {
    this._viewTrackList = [];
    const title = data.title || 'Album';
    const artist = data.artist || '';

    let html = '<div class="detail-hero">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="finder-hero-art"><img src="' + Api.finderCoverUrl(data.mbid) + '" alt="" onerror="this.style.display=\'none\'"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-text">'
      + '<div class="detail-hero-title">' + this._esc(title) + '</div>'
      + '<div class="detail-hero-meta">' + this._esc(artist) + '</div>'
      + '</div></div></div>'
      + '<div id="finder-release-actions" style="display:none;padding:0 22px 8px"></div>'
      + '<div id="finder-release-content"><div class="loading-spinner" style="margin:40px auto"></div><div style="text-align:center;color:var(--text3);font-size:13px;margin-top:12px">Loading track listing&hellip; this can take a moment.</div></div>';

    this.els.content.innerHTML = html;

    Api.finderReleaseTracks(data.mbid).then(tracks => {
      const container = document.getElementById('finder-release-content');
      if (!container) return;

      if (!tracks || tracks.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
          + '<div class="empty-state-text">No track listing available</div></div>';
        return;
      }

      const actionsEl = document.getElementById('finder-release-actions');
      if (actionsEl) {
        actionsEl.style.display = '';
        actionsEl.innerHTML = '<button class="settings-btn settings-btn-primary" id="btn-download-album" style="margin-bottom:8px">' + Icons.download() + '<span>Download All Tracks</span></button>';
        document.getElementById('btn-download-album').addEventListener('click', () => {
          if (Store.isGuest) { this._showAccountRequired(); return; }
          const trackList = tracks.map((t, i) => ({
            artist: t.artist || artist,
            title: t.title,
            album: title,
            albumMbid: data.mbid,
            trackNumber: t.position || (i + 1),
            trackTotal: tracks.length
          }));
          Api.queueAddBatch(trackList).then(() => {
            this._showToast(tracks.length + ' tracks added to queue');
          }).catch(() => {
            this._showToast('Failed to add tracks to queue');
          });
        });
      }

      let thtml = '<div class="finder-tracklist">';
      tracks.forEach((t, i) => {
        const length = t.length > 0 ? Math.floor(t.length / 60) + ':' + String(t.length % 60).padStart(2, '0') : '';
        const trackArtist = t.artist || artist;
        let statusHtml;
        if (t.inLibrary) {
          statusHtml = '<span class="finder-status-badge finder-in-own-library">In Library</span>';
        } else if (this._isQueued(trackArtist, t.title)) {
          statusHtml = '<span class="finder-status-badge finder-in-queue">Queued</span>';
        } else {
          statusHtml = '<button class="finder-download-btn finder-track-dl" data-action="download-song" data-artist="' + this._esc(trackArtist) + '" data-title="' + this._esc(t.title) + '" data-album="' + this._esc(title) + '" data-album-mbid="' + this._esc(data.mbid) + '" data-track-number="' + (t.position || (i+1)) + '" data-track-total="' + tracks.length + '" title="Download">' + Icons.download() + '<span>Download</span></button>';
        }
        thtml += '<div class="finder-track-row">'
          + '<div class="finder-track-num">' + t.position + '</div>'
          + '<div class="finder-track-info">'
          + '<div class="finder-track-title">' + this._esc(t.title) + '</div>'
          + (t.artist && t.artist !== artist ? '<div class="finder-track-artist">' + this._esc(t.artist) + '</div>' : '')
          + '</div>'
          + (length ? '<div class="finder-track-length">' + length + '</div>' : '')
          + statusHtml
          + '</div>';
      });
      thtml += '</div>';

      container.innerHTML = thtml;

      container.querySelectorAll('.finder-track-dl').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          btn.disabled = true;
          const queued = await this._addToQueue({
            artist: btn.dataset.artist,
            title: btn.dataset.title,
            album: btn.dataset.album || '',
            albumMbid: btn.dataset.albumMbid || '',
            trackNumber: parseInt(btn.dataset.trackNumber) || 0,
            trackTotal: parseInt(btn.dataset.trackTotal) || 0
          });
          if (queued) {
            const badge = document.createElement('span');
            badge.className = 'finder-status-badge finder-in-queue';
            badge.textContent = 'Queued';
            btn.replaceWith(badge);
          } else {
            btn.disabled = false;
          }
        });
      });
    }).catch(() => {
      const container = document.getElementById('finder-release-content');
      if (container) container.innerHTML = '<div class="empty-state-text">Failed to load tracks</div>';
    });
  },

});

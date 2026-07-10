// ============================================
// ui-settings.js — Settings page rendering + all settings handlers
// Extracted from ui.js. Loaded AFTER ui.js.
// ============================================
Object.assign(UI, {

  async renderSettings(forceAccount) {
    this._viewTrackList = [];

    if (!Store.user) {
      this._renderSettingsLocked();
      return;
    }
    if (forceAccount || Store.user.role !== 'admin') {
      this._renderUserSettings();
      return;
    }

    const st = (id, label, hint) => {
      return '<div class="settings-toggle-row">'
        + '<div><div class="settings-toggle-label">' + label + '</div>'
        + (hint ? '<div class="settings-toggle-hint">' + hint + '</div>' : '')
        + '</div>'
        + '<div class="stoggle" id="' + id + '"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div>'
        + '</div>';
    };

    // Tab bar
    let html = '<div class="page-header">'
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Settings</span></div>';

    html += '<div class="lib-tabs" id="settings-tabs">'
      + '<button class="lib-tab active" data-settings-tab="playback">Playback</button>'
      + '<button class="lib-tab" data-settings-tab="downloads">Downloads</button>'
      + '<button class="lib-tab" data-settings-tab="library">Library</button>'
      + '<button class="lib-tab" data-settings-tab="tasks">Tasks</button>'
      + '<button class="lib-tab" data-settings-tab="users">Users</button>'
      + '<button class="lib-tab" data-settings-tab="about">About</button>'
      + '</div>';

    html += '<div class="settings-tab-content" id="settings-tab-content">';

    // --- Tab: Playback ---
    html += '<div class="settings-tab-panel active" data-panel="playback">'
      + '<div class="settings-section-desc">Customize the waveform style shown during playback.</div>'
      + '<div class="settings-field"><label>Waveform Style</label>'
      + '<select id="setting-waveform-style" class="settings-select">'
      + '<option value="rounded">Rounded Bars</option>'
      + '<option value="mirror">Mirrored</option>'
      + '<option value="layered">Layered</option>'
      + '<option value="layered-mirror">Layered Mirror</option>'
      + '<option value="squiggle">Squiggle</option>'
      + '</select></div>'
      + '<div class="settings-waveform-preview"><canvas id="waveform-preview-canvas"></canvas></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-waveform-style">' + Icons.check() + '<span>Save</span></button>'
      + '</div>'
      + '<div class="settings-section-desc" style="margin-top:20px">Choose what shows by default on the Now Playing screen. Users can still toggle between the two at any time — this sets the initial view for first-time visitors.</div>'
      + '<div class="settings-field"><label>Default Now Playing View</label>'
      + '<select id="setting-default-np-view" class="settings-select">'
      + '<option value="visualizer">Visualizer</option>'
      + '<option value="album_art">Album Art</option>'
      + '</select></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-default-np-view">' + Icons.check() + '<span>Save</span></button>'
      + '</div>'
      + '</div>';

    // --- Tab: Downloads (logical flow: sources → auth → quality → org → permissions → import) ---
    html += '<div class="settings-tab-panel" data-panel="downloads">'
      // ── Source Selection ──
      + '<div class="settings-subsection-label">Download Source</div>'
      + '<div class="settings-field"><label>Where to download from</label>'
      + '<select id="setting-download-source" class="settings-select">'
      + '<option value="auto">Auto — YouTube, then Soulseek</option>'
      + '<option value="youtube">YouTube only</option>'
      + '<option value="soulseek">Soulseek only</option>'
      + '</select></div>'
      + '<div id="finder-settings" class="settings-status"></div>'
      + '<div class="settings-field" style="max-width:120px"><label>Concurrent Downloads</label>'
      + '<input type="text" id="setting-download-concurrency" class="settings-input" placeholder="3" value="3"></div>'
      // ── YouTube ──
      + '<div class="settings-subsection-label" style="margin-top:20px">YouTube</div>'
      + '<div class="settings-section-desc">Extract cookies from your browser so YouTube doesn\'t block downloads. One-time setup.</div>'
      + '<div class="settings-field"><label>Extract Cookies From Browser</label>'
      + '<select id="setting-yt-cookies-from-browser" class="settings-select">'
      + '<option value="">— Disabled —</option>'
      + '<option value="chrome">Chrome</option><option value="chromium">Chromium</option><option value="firefox">Firefox</option><option value="edge">Edge</option><option value="brave">Brave</option><option value="opera">Opera</option><option value="safari">Safari</option><option value="vivaldi">Vivaldi</option><option value="whale">Whale</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Player Client</label>'
      + '<select id="setting-yt-player-client" class="settings-select">'
      + '<option value="default">Default — recommended</option><option value="web">Web</option><option value="mweb">Mobile Web</option><option value="tv">TV</option><option value="web_embedded">Web Embedded</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Or Upload Cookies File</label>'
      + '<div id="yt-cookies-status" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px">Checking\u2026</div>'
      + '<div class="settings-actions">'
      + '<input type="file" id="yt-cookies-file-input" accept=".txt,text/plain" hidden>'
      + '<button class="settings-btn settings-btn-primary" id="btn-upload-cookies" type="button">' + Icons.upload() + '<span>Upload cookies.txt</span></button>'
      + '<button class="settings-btn settings-btn-danger" id="btn-clear-cookies" type="button">' + Icons.trash() + '<span>Remove</span></button>'
      + '</div></div>'
      // ── Soulseek ──
      + '<div class="settings-subsection-label" style="margin-top:20px">Soulseek</div>'
      + '<div class="settings-section-desc">P2P file sharing. Used as fallback when YouTube fails, or as the only source. Requires a free account.</div>'
      + st('setting-slsk-enabled', 'Enable Soulseek', 'Use Soulseek as a download source')
      + '<div class="settings-form-grid">'
      + '<div class="settings-field"><label>Username</label>'
      + '<input type="text" id="setting-slsk-username" class="settings-input" placeholder="username"></div>'
      + '<div class="settings-field"><label>Password</label>'
      + '<input type="password" id="setting-slsk-password" class="settings-input" placeholder="password" autocomplete="new-password"></div>'
      + '</div>'
      + '<div class="settings-form-grid">'
      + '<div class="settings-field"><label>Preferred Format</label>'
      + '<select id="setting-slsk-preferred-format" class="settings-select">'
      + '<option value="any">Any</option><option value="flac">FLAC (lossless)</option><option value="mp3">MP3</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Min Bitrate (kbps)</label>'
      + '<input type="text" id="setting-slsk-min-bitrate" class="settings-input" placeholder="192"></div>'
      + '</div>'
      + '<div class="settings-actions" style="margin-top:6px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-slsk-connect" type="button"><span>Connect Soulseek</span></button>'
      + '</div>'
      + '<div id="slsk-connect-msg" class="settings-section-desc" style="margin-top:6px;font-size:12px">Creates the account if new, verifies it works, and seeds your share folder.</div>'
      // ── Quality & Format ──
      + '<div class="settings-subsection-label" style="margin-top:20px">Quality & Format</div>'
      + '<div class="settings-form-grid">'
      + '<div class="settings-field"><label>Audio Format</label>'
      + '<select id="setting-download-format" class="settings-select">'
      + '<option value="flac">FLAC (lossless)</option>'
      + '<option value="mp3">MP3</option>'
      + '<option value="opus">Opus</option>'
      + '<option value="m4a">M4A/AAC</option>'
      + '<option value="best">Original (no conversion)</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Minimum Bitrate (kbps)</label>'
      + '<input type="text" id="setting-download-min-bitrate" class="settings-input" placeholder="0 (no minimum)"></div>'
      + '</div>'
      + '<div id="mp3-quality-group" class="settings-field"><label>MP3 Quality</label>'
      + '<select id="setting-mp3-bitrate" class="settings-select">'
      + '<option value="v2">V2 ~192kbps (recommended)</option>'
      + '<option value="v0">V0 ~245kbps</option>'
      + '<option value="320k">320kbps CBR</option>'
      + '<option value="256k">256kbps CBR</option>'
      + '<option value="192k">192kbps CBR</option>'
      + '<option value="128k">128kbps CBR</option>'
      + '</select></div>'
      + '<div id="opus-quality-group" class="settings-field" style="display:none"><label>Opus Bitrate</label>'
      + '<select id="setting-opus-bitrate" class="settings-select">'
      + '<option value="320k">320kbps</option>'
      + '<option value="256k">256kbps</option>'
      + '<option value="192k">192kbps</option>'
      + '<option value="128k">128kbps</option>'
      + '<option value="96k">96kbps</option>'
      + '</select></div>'
      + st('setting-download-convert-to-flac', 'Convert to FLAC', 'Re-encode imported files as FLAC')
      // ── File Organization ──
      + '<div class="settings-subsection-label" style="margin-top:20px">File Organization</div>'
      + st('setting-download-organise-by-artist', 'Organise by Artist', 'Move imported files into Artist/Album/ folders')
      // ── User Permissions ──
      + '<div class="settings-subsection-label" style="margin-top:20px">User Permissions</div>'
      + st('setting-downloads-enabled', 'Enable Downloads', 'Allow users to download tracks from the player')
      + '<div class="settings-actions" style="margin-top:8px">'
      + '<button class="settings-btn" id="btn-toggle-download-list">' + Icons.library() + '<span>Manage Per-Track</span></button>'
      + '</div>'
      + '<div id="download-list"></div>'
      // ── Bulk Import ──
      + '<div class="settings-subsection-label" style="margin-top:20px">Bulk Import</div>'
      + '<div class="settings-section-desc">Paste tracks to download (one per line, "Artist - Title").</div>'
      + '<textarea id="bulk-import-input" class="settings-textarea" rows="4" placeholder="Radiohead - Creep&#10;Arcade Fire - Rebellion"></textarea>'
      + '<div class="settings-actions" style="margin-top:8px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-bulk-import">' + Icons.download() + '<span>Import & Download All</span></button>'
      + '</div>'
      // ── Save ──
      + '<div class="settings-actions" style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.08)">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-user-downloads">' + Icons.check() + '<span>Save Downloads</span></button>'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-finder-settings">' + Icons.check() + '<span>Save Engine</span></button>'
      + '</div>'
      + '</div>';

    // --- Tab: Library Health ---
    const rc = Store.reviewCounts || {};
    const totalReview = (rc.unchecked || 0) + (rc.needs_review || 0) + (rc.reviewed_ok || 0);
    const reviewedPct = totalReview > 0 ? Math.round(((rc.reviewed_ok || 0) / totalReview) * 100) : 0;
    html += '<div class="settings-tab-panel" data-panel="library">'
      + '<div class="settings-actions" style="margin-bottom:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-meta-scan">' + Icons.refresh() + '<span>Scan Metadata</span></button>'
      + '<button class="settings-btn" id="btn-meta-review" style="display:none">' + Icons.check() + '<span>Review Pending</span></button>'
      + '<button class="settings-btn" id="btn-meta-history">' + Icons.search() + '<span>Match History</span></button>'
      + '</div>'
      + '<div id="metadata-status" class="settings-status"></div>'
      + '<div class="settings-subsection-label">Track Review</div>'
      + '<div class="review-settings-status">'
      + '<span style="color:rgba(255,255,255,.4)">Unchecked: <strong style="color:#fff">' + (rc.unchecked || 0) + '</strong></span>'
      + '<span style="color:#ff6b6b">Needs Review: <strong>' + (rc.needs_review || 0) + '</strong></span>'
      + '<span style="color:rgba(255,255,255,.4)">Reviewed: <strong style="color:#fff">' + (rc.reviewed_ok || 0) + '</strong></span>'
      + '</div>'
      + '<div class="review-progress-bar-container">'
      + '<div class="review-progress-bar" id="review-progress-bar" style="width:' + reviewedPct + '%"></div>'
      + '</div>'
      + '<div id="review-progress-text" class="review-progress-text"></div>'
      + '<div id="review-live-log" class="review-live-log"></div>'
      + '<div class="settings-subsection-label">Metadata Checks</div>'
      + '<div class="settings-checks-grid">'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Missing Title</div></div><div class="stoggle" id="setting-review-flag-missing-title"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Missing Artist</div></div><div class="stoggle" id="setting-review-flag-missing-artist"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Missing Album</div></div><div class="stoggle" id="setting-review-flag-missing-album"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Missing Genre</div></div><div class="stoggle" id="setting-review-flag-missing-genre"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Missing Cover Art</div></div><div class="stoggle" id="setting-review-flag-no-cover"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Filename as Title</div></div><div class="stoggle" id="setting-review-flag-filename-derived"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '</div>'
      + '<div class="settings-subsection-label">Quality Checks</div>'
      + '<div class="settings-checks-grid">'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Suspicious Naming</div></div><div class="stoggle" id="setting-review-flag-suspicious"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Duration Anomalies</div></div><div class="stoggle" id="setting-review-flag-duration"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '<div class="settings-toggle-row"><div><div class="settings-toggle-label">Potential Duplicates</div></div><div class="stoggle" id="setting-review-flag-duplicates"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>'
      + '</div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-review-recheck">' + Icons.refresh() + '<span>Recheck All Tracks</span></button>'
      + '<button class="settings-btn" id="btn-review-copy-log">' + Icons.share() + '<span>Copy Log</span></button>'
      + '</div>'
      + '</div>';

    // --- Tab: Background Tasks ---
    html += '<div class="settings-tab-panel" data-panel="tasks">'
      + '<div class="settings-section-desc">Background workers keep the library in sync. Toggle, set interval, or click Run Now.</div>'
      + '<div id="workers-list"></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-worker-settings">' + Icons.check() + '<span>Save Settings</span></button>'
      + '</div>'
      + '</div>';

    // --- Tab: Users (admin) ---
    html += '<div class="settings-tab-panel" data-panel="users">'
      + '<div class="settings-subsection-label">Registration</div>'
      + '<div class="settings-section-desc">Control whether new people can create their own accounts.</div>'
      + '<div class="settings-field"><label>Sign-up mode</label>'
      + '<select id="reg-mode" class="settings-select">'
        + '<option value="off">Off — no public sign-ups</option>'
        + '<option value="self_service">Self-service — accounts activate instantly</option>'
        + '<option value="approval">Approval required — admin approves each sign-up</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Default role for new accounts</label>'
      + '<select id="reg-role" class="settings-select">'
        + '<option value="user">user</option>'
        + '<option value="admin">admin</option>'
      + '</select></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-registration">' + Icons.check() + '<span>Save</span></button>'
      + '<span id="reg-msg" class="settings-status"></span>'
      + '</div>'

      + '<div class="settings-subsection-label" style="margin-top:28px">Download limits</div>'
      + '<div class="settings-section-desc">Cap how many downloads can run at once. 0 = unlimited.</div>'
      + '<div class="settings-field" style="max-width:160px"><label>Global limit</label>'
      + '<input id="dl-limit-global" class="settings-input" type="number" min="0" placeholder="0"></div>'
      + '<div class="settings-field" style="max-width:160px"><label>Per-user limit</label>'
      + '<input id="dl-limit-peruser" class="settings-input" type="number" min="0" placeholder="0"></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-dl-limits">' + Icons.check() + '<span>Save</span></button>'
      + '<span id="dl-limits-msg" class="settings-status"></span>'
      + '</div>'

      + '<div class="settings-subsection-label" style="margin-top:28px">Create user</div>'
      + '<form id="adm-create-form">'
      + '<div class="settings-field"><label>Username</label>'
      + '<input id="adm-username" class="settings-input" placeholder="username" autocomplete="off"></div>'
      + '<div class="settings-field"><label>Password</label>'
      + '<input id="adm-password" class="settings-input" type="password" placeholder="password" autocomplete="new-password"></div>'
      + '<div class="settings-field"><label>Email (optional)</label>'
      + '<input id="adm-email" class="settings-input" placeholder="email"></div>'
      + '<div class="settings-field"><label>Role</label>'
      + '<select id="adm-role" class="settings-select">'
        + '<option value="user">user</option>'
        + '<option value="admin">admin</option>'
      + '</select></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button type="submit" class="settings-btn settings-btn-primary" id="btn-admin-create-user">' + Icons.plus() + '<span>Create user</span></button>'
      + '</div>'
      + '</form>'

      + '<div class="settings-subsection-label" style="margin-top:28px">All users</div>'
      + '<div id="admin-users-list" class="settings-status">Loading users...</div>'
      + '</div>';

    // --- Tab: About ---
    html += '<div class="settings-tab-panel" data-panel="about">'
      + '<div class="settings-about">'
      + '<img class="settings-about-logo" src="/icon.png" alt="">'
      + '<div class="settings-about-name">Seekify</div>'
      + '<div class="settings-about-tag" style="color:var(--text3);font-size:13px">Personal music library with MusicBrainz integration</div>'
      + '</div>'
      + '</div>';

    html += '</div>'; // close settings-tab-content

    this.els.content.innerHTML = html;

    // --- Tab switching ---
    this.els.content.querySelectorAll('[data-settings-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.settingsTab;
        this.els.content.querySelectorAll('[data-settings-tab]').forEach(t => t.classList.remove('active'));
        this.els.content.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = this.els.content.querySelector('[data-panel="' + target + '"]');
        if (panel) panel.classList.add('active');
        // Paint waveform preview when switching to playback tab
        if (target === 'playback') this._paintWaveformPreview();
      });
    });

    this._loadMetadataStatus();
    this._loadWorkers();

    this.els.content.querySelectorAll('.stoggle').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('active'));
    });

    document.getElementById('btn-meta-scan').addEventListener('click', () => this._startMetadataScan());
    document.getElementById('btn-meta-history').addEventListener('click', () => this.navigateTo('metadata-history'));

    const reviewBtn = document.getElementById('btn-meta-review');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', () => {
        this.navigateTo('metadata-review');
      });
    }

    this._loadFinderSettings();

    const saveUserDlBtn = document.getElementById('btn-save-user-downloads');
    if (saveUserDlBtn) {
      saveUserDlBtn.addEventListener('click', () => this._saveUserDownloads());
    }

    const saveSettingsBtn = document.getElementById('btn-save-finder-settings');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => this._saveFinderSettings());
    }

    const slskConnectBtn = document.getElementById('btn-slsk-connect');
    if (slskConnectBtn) {
      slskConnectBtn.addEventListener('click', () => this._connectSlsk(slskConnectBtn));
    }

    const saveWorkerBtn = document.getElementById('btn-save-worker-settings');
    if (saveWorkerBtn) {
      saveWorkerBtn.addEventListener('click', () => this._saveWorkerSettings());
    }

    const bulkImportBtn = document.getElementById('btn-bulk-import');
    if (bulkImportBtn) {
      bulkImportBtn.addEventListener('click', () => this._doBulkImport());
    }

    const downloadListBtn = document.getElementById('btn-toggle-download-list');
    if (downloadListBtn) {
      downloadListBtn.addEventListener('click', () => this._toggleDownloadPanel());
    }

    const wfStyleSelect = document.getElementById('setting-waveform-style');
    if (wfStyleSelect) {
      wfStyleSelect.value = Store.waveformStyle;
      wfStyleSelect.addEventListener('change', () => this._paintWaveformPreview());
    }

    const wfSaveBtn = document.getElementById('btn-save-waveform-style');
    if (wfSaveBtn) {
      wfSaveBtn.addEventListener('click', () => this._saveWaveformStyle());
    }

    const npViewSelect = document.getElementById('setting-default-np-view');
    if (npViewSelect) {
      npViewSelect.value = Store.defaultNowPlayingView;
    }
    const npViewSaveBtn = document.getElementById('btn-save-default-np-view');
    if (npViewSaveBtn) {
      npViewSaveBtn.addEventListener('click', () => this._saveDefaultNowPlayingView());
    }

    // Users tab (admin only): load registration settings + user list, bind actions.
    if (Store.isAdmin) {
      this._initUsersTab();
    }

    this._paintWaveformPreview();

  },

  // ── Users tab (admin) ──

  _initUsersTab() {
    Api.adminGetRegistration().then(s => {
      const m = document.getElementById('reg-mode');
      if (m) m.value = (s && s.mode) || 'off';
      const r = document.getElementById('reg-role');
      if (r) r.value = (s && s.default_role) || 'user';
    }).catch(() => {});
    const saveReg = document.getElementById('btn-save-registration');
    if (saveReg) saveReg.addEventListener('click', () => this._saveRegistration());
    const createForm = document.getElementById('adm-create-form');
    if (createForm) createForm.addEventListener('submit', (e) => { e.preventDefault(); this._adminCreateUser(); });
    Api.adminGetDownloadLimits().then(l => {
      const g = document.getElementById('dl-limit-global');
      if (g) g.value = (l && l.global) || 0;
      const p = document.getElementById('dl-limit-peruser');
      if (p) p.value = (l && l.perUser) || 0;
    }).catch(() => {});
    const saveLimits = document.getElementById('btn-save-dl-limits');
    if (saveLimits) saveLimits.addEventListener('click', () => this._saveDownloadLimits());
    this._loadAdminUsers();
  },

  _saveRegistration() {
    const mode = (document.getElementById('reg-mode') || {}).value || 'off';
    const role = (document.getElementById('reg-role') || {}).value || 'user';
    Api.adminPutRegistration(mode, role)
      .then(() => this._setRegMsg('reg-msg', 'Saved', false))
      .catch(err => this._setRegMsg('reg-msg', (err && err.message) || 'Failed to save', true));
  },

  _saveDownloadLimits() {
    const g = parseInt((document.getElementById('dl-limit-global') || {}).value || '0', 10) || 0;
    const p = parseInt((document.getElementById('dl-limit-peruser') || {}).value || '0', 10) || 0;
    Api.adminPutDownloadLimits(g, p)
      .then(() => this._setRegMsg('dl-limits-msg', 'Saved', false))
      .catch(err => this._setRegMsg('dl-limits-msg', (err && err.message) || 'Failed to save', true));
  },

  _loadAdminUsers() {
    const list = document.getElementById('admin-users-list');
    if (!list) return;
    list.textContent = 'Loading users...';
    Api.adminListUsers()
      .then(data => this._renderAdminUsers((data && data.users) || []))
      .catch(() => { list.textContent = 'Failed to load users'; });
  },

  _renderAdminUsers(users) {
    const list = document.getElementById('admin-users-list');
    if (!list) return;
    if (!users.length) { list.innerHTML = '<div>No users</div>'; return; }
    list.innerHTML = users.map(u => {
      const pending = u.status === 'pending';
      const badge = pending ? 'pending' : (u.disabled ? 'disabled' : 'active');
      const badgeStyle = 'font-size:11px;padding:2px 8px;border-radius:6px;white-space:nowrap;'
        + (pending ? 'background:rgba(212,240,64,.15);color:var(--accent)'
          : u.disabled ? 'background:rgba(201,64,64,.15);color:var(--danger)'
          : 'background:rgba(255,255,255,.06);color:var(--text3)');
      let actions = '';
      if (pending) {
        actions += '<button class="settings-btn" data-adm-action="approve" data-id="' + u.id + '">Approve</button>'
          + '<button class="settings-btn" data-adm-action="reject" data-id="' + u.id + '">Reject</button>';
      } else {
        actions += '<button class="settings-btn" data-adm-action="toggle" data-id="' + u.id + '" data-disabled="' + (u.disabled ? 1 : 0) + '">' + (u.disabled ? 'Enable' : 'Disable') + '</button>';
      }
      actions += '<button class="settings-btn" data-adm-action="reset" data-id="' + u.id + '">Reset PW</button>'
        + '<button class="settings-btn" data-adm-action="delete" data-id="' + u.id + '">Delete</button>';
      const roleSel = pending
        ? '<span class="settings-select" style="display:inline-block;min-width:60px">' + this._esc(u.role || 'user') + '</span>'
        : '<select class="settings-select" data-adm-action="role" data-id="' + u.id + '" style="max-width:90px">'
          + '<option value="user"' + (u.role === 'user' ? ' selected' : '') + '>user</option>'
          + '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>admin</option>'
          + '</select>';
      return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border)">'
        + roleSel
        + '<span style="font-weight:600">' + this._esc(u.username) + '</span>'
        + (u.email ? '<span style="color:var(--text3);font-size:13px">' + this._esc(u.email) + '</span>' : '')
        + '<span style="' + badgeStyle + '">' + badge + '</span>'
        + '<div style="display:flex;gap:6px;margin-left:auto;flex-wrap:wrap">' + actions + '</div>'
        + '</div>';
    }).join('');

    list.querySelectorAll('[data-adm-action]').forEach(el => {
      const action = el.dataset.admAction;
      const id = el.dataset.id;
      if (action === 'role') {
        el.addEventListener('change', () => this._adminUpdateUser(id, { role: el.value }));
      } else {
        el.addEventListener('click', () => this._handleUserAction(action, id, el));
      }
    });
  },

  _handleUserAction(action, id, el) {
    if (action === 'approve') return this._adminApprove(id);
    if (action === 'reject') return this._adminReject(id);
    if (action === 'delete') return this._adminDelete(id);
    if (action === 'reset') return this._adminReset(id);
    if (action === 'toggle') {
      const disabled = el.dataset.disabled === '1';
      return this._adminUpdateUser(id, { disabled: !disabled });
    }
  },

  _adminCreateUser() {
    const username = ((document.getElementById('adm-username') || {}).value || '').trim();
    const password = (document.getElementById('adm-password') || {}).value || '';
    const email = ((document.getElementById('adm-email') || {}).value || '').trim();
    const role = (document.getElementById('adm-role') || {}).value || 'user';
    if (!username || !password) { this._setRegMsg('reg-msg', 'Username and password are required', true); return; }
    Api.adminCreateUser({ username, password, role, email })
      .then(() => {
        const u = document.getElementById('adm-username'); if (u) u.value = '';
        const p = document.getElementById('adm-password'); if (p) p.value = '';
        const e = document.getElementById('adm-email'); if (e) e.value = '';
        this._setRegMsg('reg-msg', 'User created', false);
        this._loadAdminUsers();
      })
      .catch(err => this._setRegMsg('reg-msg', (err && err.message) || 'Create failed', true));
  },

  _adminUpdateUser(id, patch) {
    Api.adminUpdateUser(id, patch)
      .then(() => this._loadAdminUsers())
      .catch(err => UI.showToast((err && err.message) || 'Update failed'));
  },

  _adminDelete(id) {
    if (!confirm('Delete this user? This cannot be undone.')) return;
    Api.adminDeleteUser(id)
      .then(() => this._loadAdminUsers())
      .catch(err => UI.showToast((err && err.message) || 'Delete failed'));
  },

  _adminReset(id) {
    const pw = prompt('New password (min 8 chars):');
    if (!pw) return;
    Api.adminResetPassword(id, pw)
      .then(() => UI.showToast('Password reset'))
      .catch(err => UI.showToast((err && err.message) || 'Reset failed'));
  },

  _adminApprove(id) {
    Api.adminApproveUser(id)
      .then(() => this._loadAdminUsers())
      .catch(err => UI.showToast((err && err.message) || 'Approve failed'));
  },

  _adminReject(id) {
    if (!confirm('Reject and delete this pending registration?')) return;
    Api.adminRejectUser(id)
      .then(() => this._loadAdminUsers())
      .catch(err => UI.showToast((err && err.message) || 'Reject failed'));
  },

  _setRegMsg(id, text, isError) {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.style.color = isError ? 'var(--danger)' : 'var(--accent)'; }
  },

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  _stoggleOn(id, on) {
    const el = document.getElementById(id);
    if (!el) return;
    if (on) el.classList.add('active');
    else el.classList.remove('active');
  },

  _stoggleVal(id) {
    const el = document.getElementById(id);
    return el ? el.classList.contains('active') : true;
  },

  async _loadFinderSettings() {
    try {
      const settings = await Api.getSettings();
      const fmt = document.getElementById('setting-download-format');
      const mp3 = document.getElementById('setting-mp3-bitrate');
      const opus = document.getElementById('setting-opus-bitrate');
      const minBr = document.getElementById('setting-download-min-bitrate');
      if (fmt && settings.download_format) fmt.value = settings.download_format;
      this._stoggleOn('setting-download-convert-to-flac', settings.download_convert_to_flac !== 'false');
      this._stoggleOn('setting-download-organise-by-artist', settings.download_organise_by_artist !== 'false');
      if (mp3 && settings.mp3_bitrate) mp3.value = settings.mp3_bitrate;
      if (opus && settings.opus_bitrate) opus.value = settings.opus_bitrate;
      if (minBr && settings.download_min_bitrate) minBr.value = settings.download_min_bitrate;
      const ytCookiesBrowser = document.getElementById('setting-yt-cookies-from-browser');
      const ytPlayerClient = document.getElementById('setting-yt-player-client');
      if (ytCookiesBrowser) ytCookiesBrowser.value = settings.yt_cookies_from_browser || '';
      if (ytPlayerClient) ytPlayerClient.value = settings.yt_player_client || 'default';
      const dlSrc = document.getElementById('setting-download-source');
      if (dlSrc) dlSrc.value = settings.download_source || 'auto';
      this._stoggleOn('setting-slsk-enabled', settings.slsk_enabled === 'true');
      const slskUser = document.getElementById('setting-slsk-username');
      if (slskUser) slskUser.value = settings.slsk_username || '';
      const slskPass = document.getElementById('setting-slsk-password');
      if (slskPass) slskPass.value = settings.slsk_password || '';
      const slskFmt = document.getElementById('setting-slsk-preferred-format');
      if (slskFmt) slskFmt.value = settings.slsk_preferred_format || 'any';
      const slskMinBr = document.getElementById('setting-slsk-min-bitrate');
      if (slskMinBr) slskMinBr.value = settings.slsk_min_bitrate || '192';
      this._refreshCookiesStatus();
      const ytCookiesFileInput = document.getElementById('yt-cookies-file-input');
      if (ytCookiesFileInput && !ytCookiesFileInput._bound) {
        ytCookiesFileInput._bound = true;
        ytCookiesFileInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) this._uploadCookies(file);
        });
      }
      const uploadCookiesBtn = document.getElementById('btn-upload-cookies');
      if (uploadCookiesBtn && !uploadCookiesBtn._bound) {
        uploadCookiesBtn._bound = true;
        uploadCookiesBtn.addEventListener('click', () => ytCookiesFileInput && ytCookiesFileInput.click());
      }
      const clearCookiesBtn = document.getElementById('btn-clear-cookies');
      if (clearCookiesBtn && !clearCookiesBtn._bound) {
        clearCookiesBtn._bound = true;
        clearCookiesBtn.addEventListener('click', () => this._clearCookies());
      }
      if (ytCookiesBrowser && !ytCookiesBrowser._bound) {
        ytCookiesBrowser._bound = true;
        ytCookiesBrowser.addEventListener('change', () => {
          const browser = ytCookiesBrowser.value;
          if (browser) {
            this._extractCookies(browser);
          } else {
            this._clearCookies();
          }
        });
      }
      if (ytPlayerClient && !ytPlayerClient._bound) {
        ytPlayerClient._bound = true;
        ytPlayerClient.addEventListener('change', () => {
          const client = ytPlayerClient.value || 'default';
          Api.saveSettings({ yt_player_client: client }).then(() => this._showToast('Saved')).catch(() => {});
        });
      }
      this._stoggleOn('setting-downloads-enabled', settings.downloads_enabled !== 'false');
      Store.downloadsEnabled = settings.downloads_enabled !== 'false';
      this._updateQualityVisibility();
      if (fmt) fmt.addEventListener('change', () => this._updateQualityVisibility());

      const concurrency = document.getElementById('setting-download-concurrency');
      if (concurrency && settings.download_concurrency) concurrency.value = settings.download_concurrency;

      // Store worker settings for _loadWorkers to use when rendering rows.
      // The actual toggle/input elements live inside the workers-list, not here.
      this._savedWorkerSettings = {
        watcher_enabled: settings.watcher_enabled !== 'false',
        watcher_interval: settings.watcher_interval || '30',
        cover_fetch_enabled: settings.cover_fetch_enabled !== 'false',
        artist_art_fetch_enabled: settings.artist_art_fetch_enabled !== 'false',
        review_enabled: settings.review_enabled !== 'false',
        review_recheck_hours: settings.review_recheck_hours || '24',
      };

      const flagKeys = ['missing-title','missing-artist','missing-album','missing-genre','no-cover','filename-derived','suspicious','duration','duplicates'];
      flagKeys.forEach(key => {
        const el = document.getElementById('setting-review-flag-' + key);
        if (el) {
          this._stoggleOn('setting-review-flag-' + key, settings['review_flag_' + key.replace(/-/g, '_')] !== 'false');
          el.addEventListener('click', () => this._saveReviewSettings());
        }
      });

      const recheckBtn = document.getElementById('btn-review-recheck');
      if (recheckBtn) recheckBtn.addEventListener('click', async () => {
        recheckBtn.disabled = true;
        recheckBtn.querySelector('span').textContent = 'Rechecking...';
        try {
          await Api.reviewRecheckAll();
          this._showToast('Recheck started');
        } catch (e) {
          this._showToast('Failed to recheck');
          recheckBtn.disabled = false;
          recheckBtn.querySelector('span').textContent = 'Recheck All Tracks';
        }
      });

      const copyLogBtn = document.getElementById('btn-review-copy-log');
      if (copyLogBtn) copyLogBtn.addEventListener('click', async () => {
        try {
          const log = await Api.getReviewLog();
          if (!log) { this._showToast('No log yet'); return; }
          await navigator.clipboard.writeText(log);
          this._showToast('Log copied');
        } catch (e) {
          this._showToast('Failed to copy log');
        }
      });

      this._startReviewProgressPoll();
    } catch (e) {}
  },

  _startReviewProgressPoll() {
    if (this._reviewPollTimer) { clearInterval(this._reviewPollTimer); this._reviewPollTimer = null; }
    this._loadInitialReviewLog();
    this._reviewPollTimer = setInterval(() => this._pollReviewProgress(), 2000);
    this._pollReviewProgress();
  },

  async _loadInitialReviewLog() {
    const logEl = document.getElementById('review-live-log');
    if (!logEl) return;
    try {
      const logText = await Api.getReviewLog();
      if (!logText) return;
      const lines = logText.trim().split('\n').filter(Boolean);
      const recent = lines.slice(-30);
      let logHtml = '';
      recent.forEach(line => {
        const isFlagged = line.includes('⚠');
        const isOk = line.includes('✓');
        const isDivider = line.startsWith('---');
        const cls = isFlagged ? ' log-flagged' : isOk ? ' log-ok' : isDivider ? ' log-divider' : '';
        logHtml += '<div class="review-log-line' + cls + '">' + this._esc(line) + '</div>';
      });
      logEl.innerHTML = logHtml;
      logEl.scrollTop = logEl.scrollHeight;
    } catch (e) {}
  },

  async _pollReviewProgress() {
    const textEl = document.getElementById('review-progress-text');
    const barEl = document.getElementById('review-progress-bar');
    const logEl = document.getElementById('review-live-log');
    if (!textEl) {
      if (this._reviewPollTimer) { clearInterval(this._reviewPollTimer); this._reviewPollTimer = null; }
      return;
    }

    try {
      const [p, logText] = await Promise.all([Api.getReviewProgress(), Api.getReviewLog()]);

      if (logEl && logText) {
        const lines = logText.trim().split('\n').filter(Boolean);
        const recent = lines.slice(-30);
        const active = p && p.active;
        let logHtml = '';
        if (active) {
          logHtml += '<div class="review-log-spinner-row"><div class="queue-spinner" style="width:14px;height:14px;border-width:2px"></div><span class="review-log-active">Worker active</span></div>';
        }
        recent.forEach(line => {
          const isFlagged = line.includes('⚠');
          const isOk = line.includes('✓');
          const isDivider = line.startsWith('---');
          const cls = isFlagged ? ' log-flagged' : isOk ? ' log-ok' : isDivider ? ' log-divider' : '';
          logHtml += '<div class="review-log-line' + cls + '">' + this._esc(line) + '</div>';
        });
        logEl.innerHTML = logHtml;
        logEl.scrollTop = logEl.scrollHeight;
      }

      if (!p) return;

      if (p.active && p.total > 0) {
        const pct = Math.round((p.checked / p.total) * 100);
        textEl.textContent = 'Checking: ' + (p.currentTrack || '...') + ' (' + p.checked + '/' + p.total + ')';
        if (barEl) {
          barEl.style.width = pct + '%';
          barEl.style.background = '#ff6b6b';
        }
      } else if (p.active) {
        textEl.textContent = 'Checking tracks...';
        if (barEl) {
          barEl.style.width = '100%';
          barEl.style.background = '#ff6b6b';
          barEl.style.animation = 'review-pulse 1s ease-in-out infinite';
        }
      } else {
        textEl.textContent = '';
        if (barEl) {
          barEl.style.animation = '';
          barEl.style.background = '';
        }
        if (this._reviewPollTimer) {
          clearInterval(this._reviewPollTimer);
          this._reviewPollTimer = null;
        }
        const counts = await Api.getReviewCounts();
        Store.reviewCounts = counts;
        const total = (counts.unchecked || 0) + (counts.needs_review || 0) + (counts.reviewed_ok || 0);
        const pct = total > 0 ? Math.round(((counts.reviewed_ok || 0) / total) * 100) : 0;
        if (barEl) barEl.style.width = pct + '%';
        const recheckBtn = document.getElementById('btn-review-recheck');
        if (recheckBtn) { recheckBtn.disabled = false; recheckBtn.querySelector('span').textContent = 'Recheck All Tracks'; }
        const statusEl = document.querySelector('.review-settings-status');
        if (statusEl) {
          statusEl.innerHTML = '<span style="color:rgba(255,255,255,.4)">Unchecked: <strong style="color:#fff">' + (counts.unchecked || 0) + '</strong></span>'
            + '<span style="color:#ff6b6b">Needs Review: <strong>' + (counts.needs_review || 0) + '</strong></span>'
            + '<span style="color:rgba(255,255,255,.4)">Reviewed: <strong style="color:#fff">' + (counts.reviewed_ok || 0) + '</strong></span>';
        }
        if (logEl) {
          const logTextFinal = await Api.getReviewLog();
          if (logTextFinal) {
            const lines = logTextFinal.trim().split('\n').filter(Boolean);
            const recent = lines.slice(-30);
            let logHtml = '';
            recent.forEach(line => {
              const isFlagged = line.includes('⚠');
              const isOk = line.includes('✓');
              const isDivider = line.startsWith('---');
              const cls = isFlagged ? ' log-flagged' : isOk ? ' log-ok' : isDivider ? ' log-divider' : '';
              logHtml += '<div class="review-log-line' + cls + '">' + this._esc(line) + '</div>';
            });
            logEl.innerHTML = logHtml;
          }
        }
      }
    } catch (e) {}
  },

  _updateQualityVisibility() {
    const fmt = document.getElementById('setting-download-format');
    const mp3Group = document.getElementById('mp3-quality-group');
    const opusGroup = document.getElementById('opus-quality-group');
    if (!fmt || !mp3Group || !opusGroup) return;
    mp3Group.style.display = fmt.value === 'mp3' ? '' : 'none';
    opusGroup.style.display = fmt.value === 'opus' ? '' : 'none';
  },

  async _saveUserDownloads() {
    const on = this._stoggleVal('setting-downloads-enabled');
    try {
      await Api.saveSettings({ downloads_enabled: String(on) });
      Store.downloadsEnabled = on;
      this._showToast('Saved');
    } catch (e) {
      this._showToast('Failed to save');
    }
  },

  async _saveFinderSettings() {
    const fmt = document.getElementById('setting-download-format');
    const mp3 = document.getElementById('setting-mp3-bitrate');
    const opus = document.getElementById('setting-opus-bitrate');
    const minBr = document.getElementById('setting-download-min-bitrate');
    try {
      const payload = {
        download_format: fmt ? fmt.value : 'flac',
        download_convert_to_flac: String(this._stoggleVal('setting-download-convert-to-flac')),
        download_organise_by_artist: String(this._stoggleVal('setting-download-organise-by-artist')),
        mp3_bitrate: mp3 ? mp3.value : 'v2',
        opus_bitrate: opus ? opus.value : '320k',
        download_min_bitrate: minBr ? minBr.value : '0',
        yt_player_client: (document.getElementById('setting-yt-player-client') || {}).value || 'default'
      };
      // Soulseek keys are only present in the downloads settings panel; include them
      // only when their elements exist so saving from the legacy panel can't clobber them.
      const dlSrc = document.getElementById('setting-download-source');
      if (dlSrc) {
        payload.download_source = dlSrc.value || 'auto';
        payload.slsk_enabled = String(this._stoggleVal('setting-slsk-enabled'));
        payload.slsk_username = (document.getElementById('setting-slsk-username') || {}).value || '';
        payload.slsk_password = (document.getElementById('setting-slsk-password') || {}).value || '';
        payload.slsk_preferred_format = (document.getElementById('setting-slsk-preferred-format') || {}).value || 'any';
        payload.slsk_min_bitrate = (document.getElementById('setting-slsk-min-bitrate') || {}).value || '192';
      }
      const concurrency = document.getElementById('setting-download-concurrency');
      if (concurrency) {
        payload.download_concurrency = concurrency.value || '3';
      }
      await Api.saveSettings(payload);
      this._showToast('Import settings saved');
    } catch (e) {
      this._showToast('Failed to save settings');
    }
  },

  async _connectSlsk(btn) {
    const msgEl = document.getElementById('slsk-connect-msg');
    const showMsg = (text, color) => {
      if (!msgEl) { this._showToast(text); return; }
      msgEl.textContent = text;
      msgEl.style.color = color || '';
    };
    const username = (document.getElementById('setting-slsk-username') || {}).value || '';
    const password = (document.getElementById('setting-slsk-password') || {}).value || '';
    if (!username || !password) {
      showMsg('Enter username and password first');
      return;
    }
    const origLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>Connecting…</span>';
    try {
      const res = await Api.testSlskConnect({ username, password });
      if (res.ok) {
        this._stoggleOn('setting-slsk-enabled', true);
        showMsg(res.seeded ? 'Connected — seeded ' + res.seeded + ' file(s)' : 'Connected', '#22c55e');
      } else {
        showMsg('Connection failed: ' + (res.message || res.error || 'unknown error'), '#ef4444');
      }
    } catch (e) {
      showMsg('Connection failed: ' + (e.message || 'network error'), '#ef4444');
    } finally {
      btn.disabled = false;
      btn.innerHTML = origLabel;
    }
  },

  _openDownloadsSettings() {
    const existing = document.querySelector('.dl-settings-overlay');
    if (existing) existing.remove();
    const st = (id, label, hint) => '<div class="settings-toggle-row">'
      + '<div><div class="settings-toggle-label">' + label + '</div>'
      + (hint ? '<div class="settings-toggle-hint">' + hint + '</div>' : '') + '</div>'
      + '<div class="stoggle" id="' + id + '"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div></div>';

    const sec = (label, body) => '<section class="dl-settings-section">'
      + '<div class="dl-settings-section-label">' + label + '</div>'
      + body + '</section>';

    const fmtFields = '<div class="settings-field"><label>Audio Format</label>'
      + '<select id="setting-download-format" class="settings-select">'
      + '<option value="flac">FLAC (lossless)</option><option value="mp3">MP3</option><option value="opus">Opus</option><option value="m4a">M4A/AAC</option><option value="best">Original (no conversion)</option>'
      + '</select></div>'
      + '<div id="mp3-quality-group" class="settings-field"><label>MP3 Quality</label>'
      + '<select id="setting-mp3-bitrate" class="settings-select">'
      + '<option value="v2">V2 ~192kbps (recommended)</option><option value="v0">V0 ~245kbps</option><option value="320k">320kbps CBR</option><option value="256k">256kbps CBR</option><option value="192k">192kbps CBR</option><option value="128k">128kbps CBR</option>'
      + '</select></div>'
      + '<div id="opus-quality-group" class="settings-field" style="display:none"><label>Opus Bitrate</label>'
      + '<select id="setting-opus-bitrate" class="settings-select">'
      + '<option value="320k">320kbps</option><option value="256k">256kbps</option><option value="192k">192kbps</option><option value="128k">128kbps</option><option value="96k">96kbps</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Minimum Bitrate (kbps)</label>'
      + '<input type="text" id="setting-download-min-bitrate" class="settings-input" placeholder="0 (no minimum)"></div>'
      + st('setting-download-convert-to-flac', 'Convert to FLAC', 'Re-encode imported files as FLAC')
      + st('setting-download-organise-by-artist', 'Organise by Artist', 'Move imported files into Artist/Album/ folders');

    const ytFields = '<div class="settings-section-desc">Pick a browser to extract cookies once, upload a cookies.txt file, or use the Chrome extension below.</div>'
      + '<div class="settings-field">'
      + '<label>Extract cookies from browser</label>'
      + '<select id="setting-yt-cookies-from-browser" class="settings-select">'
      + '<option value="">— Disabled —</option><option value="chrome">Chrome</option><option value="chromium">Chromium</option><option value="firefox">Firefox</option><option value="edge">Edge</option><option value="brave">Brave</option><option value="opera">Opera</option><option value="safari">Safari</option><option value="vivaldi">Vivaldi</option><option value="whale">Whale</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Player Client</label>'
      + '<select id="setting-yt-player-client" class="settings-select">'
      + '<option value="default">Default — recommended</option><option value="web">Web</option><option value="mweb">Mobile Web</option><option value="tv">TV</option><option value="web_embedded">Web Embedded</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Cookies File</label>'
      + '<div id="yt-cookies-status" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px">Checking…</div>'
      + '<div class="settings-actions">'
      + '<input type="file" id="yt-cookies-file-input" accept=".txt,text/plain" hidden>'
      + '<button class="settings-btn settings-btn-primary" id="btn-upload-cookies" type="button">' + Icons.upload() + '<span>Upload cookies.txt</span></button>'
      + '<button class="settings-btn settings-btn-danger" id="btn-clear-cookies" type="button">' + Icons.trash() + '<span>Remove</span></button>'
      + '</div></div>';

    const extFields = '<div class="settings-section-desc">Install the Chrome extension to send your YouTube cookies here with one click.</div>'
      + '<div class="settings-actions" style="flex-wrap:wrap">'
      + '<a class="settings-btn settings-btn-primary" id="dl-extension-store-link" style="display:none;text-decoration:none" target="_blank" rel="noopener">Add to Chrome</a>'
      + '<button class="settings-btn" id="btn-dl-extension">' + Icons.download() + '<span>Download (.zip)</span></button>'
      + '</div>'
      + '<div class="settings-field"><label>Chrome Web Store URL (optional)</label>'
      + '<input type="url" id="setting-cookies-store-url" class="settings-input" placeholder="https://chromewebstore.google.com/..." style="width:100%"></div>'
      + '<div class="settings-section-desc" style="font-size:12px">Using the .zip: unzip it, open chrome://extensions, enable Developer mode, click Load unpacked, and select the folder. Then open the extension, enter this server address, and click Send.</div>';

    const srcFields = '<div class="settings-field"><label>Download Source</label>'
      + '<select id="setting-download-source" class="settings-select">'
      + '<option value="auto">Auto — YouTube, then Soulseek</option><option value="youtube">YouTube only</option><option value="soulseek">Soulseek only</option>'
      + '</select></div>'
      + '<div class="settings-field" style="max-width:120px"><label>Concurrent Downloads (1-10)</label>'
      + '<input type="text" id="setting-download-concurrency" class="settings-input" placeholder="3" value="3"></div>';

    const slskFields = '<div class="settings-section-desc">Soulseek is used as a fallback when YouTube fails, or as the only source. Requires a free Soulseek account and a shared folder (give-to-get). Falls back gracefully if disabled or unconfigured.</div>'
      + st('setting-slsk-enabled', 'Enable Soulseek', 'Use Soulseek as a fallback or primary download source')
      + '<div class="settings-field"><label>Soulseek Username</label>'
      + '<input type="text" id="setting-slsk-username" class="settings-input" placeholder="your soulseek username"></div>'
      + '<div class="settings-field"><label>Soulseek Password</label>'
      + '<input type="password" id="setting-slsk-password" class="settings-input" placeholder="your soulseek password" autocomplete="new-password"></div>'
      + '<div class="settings-field">'
      + '<button class="settings-btn settings-btn-primary" id="btn-slsk-connect" type="button"><span>Connect Soulseek</span></button>'
      + '<div id="slsk-connect-msg" class="settings-section-desc" style="margin-top:6px;font-size:12px">Creates the account if it\'s new, verifies it works, and seeds your share folder (up to 30 files) so you aren\'t throttled. Just enter username + password and click.</div>'
      + '</div>'
      + '<div class="settings-field"><label>Preferred Format</label>'
      + '<select id="setting-slsk-preferred-format" class="settings-select">'
      + '<option value="any">Any</option><option value="flac">FLAC (lossless)</option><option value="mp3">MP3</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Minimum Bitrate (kbps)</label>'
      + '<input type="text" id="setting-slsk-min-bitrate" class="settings-input" placeholder="192"></div>';

    const fields = sec('Download Source', srcFields)
      + sec('Download Format', fmtFields)
      + sec('YouTube Authentication', ytFields)
      + sec('Browser Extension', extFields)
      + sec('Soulseek', slskFields);

    const overlay = document.createElement('div');
    overlay.className = 'candidate-modal-overlay dl-settings-overlay';
    overlay.innerHTML = '<div class="candidate-modal dl-settings-modal">'
      + '<div class="candidate-modal-header"><div class="candidate-modal-title">Download Settings</div><button class="candidate-modal-close">&times;</button></div>'
      + '<div class="candidate-modal-list dl-settings-body">' + fields + '</div>'
      + '<div class="dl-settings-footer">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-finder-settings">' + Icons.check() + '<span>Save Settings</span></button>'
      + '</div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
    overlay.querySelector('.candidate-modal-close').addEventListener('click', () => this._fadeOutRemove(overlay, 200));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this._fadeOutRemove(overlay, 200); });
    overlay.querySelectorAll('.stoggle').forEach(el => el.addEventListener('click', () => el.classList.toggle('active')));
    this._loadFinderSettings();
    const saveBtn = overlay.querySelector('#btn-save-finder-settings');
    if (saveBtn) saveBtn.addEventListener('click', () => this._saveFinderSettings());
    const slskConnectBtn = overlay.querySelector('#btn-slsk-connect');
    if (slskConnectBtn) slskConnectBtn.addEventListener('click', () => this._connectSlsk(slskConnectBtn));
    this._bindExtensionSection();
  },

  _bindExtensionSection() {
    const dlBtn = document.getElementById('btn-dl-extension');
    if (dlBtn) dlBtn.addEventListener('click', () => { window.location.href = '/api/cookies/extension.zip'; });
    const storeInput = document.getElementById('setting-cookies-store-url');
    Api.getSettings().then(s => {
      const url = (s && s.cookies_store_url) || '';
      if (storeInput) storeInput.value = url;
      const link = document.getElementById('dl-extension-store-link');
      if (link && url) { link.href = url; link.style.display = ''; }
      if (storeInput && !storeInput._bound) {
        storeInput._bound = true;
        storeInput.addEventListener('change', () => {
          const v = storeInput.value.trim();
          Api.saveSettings({ cookies_store_url: v }).then(() => {
            const l = document.getElementById('dl-extension-store-link');
            if (l) { if (v) { l.href = v; l.style.display = ''; } else { l.style.display = 'none'; } }
            this._showToast('Saved');
          }).catch(() => {});
        });
      }
    }).catch(() => {});
  },

  async _refreshCookiesStatus() {
    const el = document.getElementById('yt-cookies-status');
    if (!el) return;
    const clearBtn = document.getElementById('btn-clear-cookies');
    try {
      const s = await Api.getCookiesStatus();
      if (s.active && s.size) {
        const kb = Math.max(1, Math.round(s.size / 1024));
        let detail = kb + ' KB';
        if (s.browser) detail += ' from ' + s.browser;
        if (s.mtime) detail += ' · ' + s.mtime;
        el.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:rgba(34,197,94,0.12);color:#22c55e;font-weight:600;font-size:13px">' + Icons.checkCircle() + '<span>Active</span></span>'
          + '<span style="color:var(--text-secondary);font-size:12px">' + detail + '</span>';
        el.style.color = '';
        if (clearBtn) clearBtn.disabled = false;
      } else {
        el.innerHTML = '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:rgba(248,113,113,0.1);color:#f87171;font-weight:600;font-size:13px">' + Icons.warning() + '<span>No cookies</span></span>'
          + '<span style="color:var(--text-secondary);font-size:12px">Pick a browser above to extract once</span>';
        if (clearBtn) clearBtn.disabled = true;
      }
    } catch {
      el.textContent = 'Could not check cookies status.';
      if (clearBtn) clearBtn.disabled = true;
    }
  },

  async _uploadCookies(file) {
    const btn = document.getElementById('btn-upload-cookies');
    if (btn) btn.disabled = true;
    try {
      await Api.uploadCookies(file);
      this._showToast('Cookies uploaded — downloads should work now');
      this._refreshCookiesStatus();
    } catch (e) {
      this._showToast(e.message || 'Upload failed');
    } finally {
      if (btn) btn.disabled = false;
      const input = document.getElementById('yt-cookies-file-input');
      if (input) input.value = '';
    }
  },

  async _clearCookies() {
    try {
      await Api.clearCookies();
      this._showToast('Cookies removed');
      this._refreshCookiesStatus();
    } catch (e) {
      this._showToast('Failed to remove cookies');
    }
  },

  async _extractCookies(browser) {
    const el = document.getElementById('yt-cookies-status');
    if (el) el.textContent = 'Extracting cookies from ' + browser + '… (one Keychain prompt)';
    try {
      const result = await Api.extractCookies(browser);
      this._showToast('Cookies saved from ' + browser + ' — no more prompts');
      this._refreshCookiesStatus();
    } catch (e) {
      this._showToast(e.message || 'Extraction failed');
      this._refreshCookiesStatus();
    }
  },

  async _saveWorkerSettings() {
    // Read toggle states and interval values from the worker rows
    const wl = document.getElementById('workers-list');
    const getToggle = (workerName) => {
      const row = wl?.querySelector('.worker-row[data-worker="' + workerName + '"]');
      return row ? row.querySelector('.worker-toggle').classList.contains('active') : true;
    };
    const getInterval = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : '30';
    };
    try {
      await Api.saveSettings({
        watcher_enabled: String(getToggle('scanner')),
        watcher_interval: getInterval('setting-watcher-interval'),
        cover_fetch_enabled: String(getToggle('cover-fetch')),
        artist_art_fetch_enabled: String(getToggle('artist-art-fetch')),
        review_enabled: String(getToggle('review')),
        review_recheck_hours: getInterval('setting-review-recheck-hours')
      });
      this._showToast('Worker settings saved');
    } catch (e) {
      this._showToast('Failed to save worker settings');
    }
  },

  async _saveReviewSettings() {
    const revRecheckHours = document.getElementById('setting-review-recheck-hours');
    const data = {
      review_enabled: String(this._stoggleVal('setting-review-enabled')),
      review_recheck_hours: revRecheckHours ? revRecheckHours.value : '24'
    };
    const flagKeys = ['missing-title','missing-artist','missing-album','missing-genre','no-cover','filename-derived','suspicious','duration','duplicates'];
    flagKeys.forEach(key => {
      data['review_flag_' + key.replace(/-/g, '_')] = String(this._stoggleVal('setting-review-flag-' + key));
    });
    try {
      await Api.saveSettings(data);
      this._showToast('Review settings saved');
    } catch (e) {
      this._showToast('Failed to save review settings');
    }
  },

  async _saveWaveformStyle() {
    const sel = document.getElementById('setting-waveform-style');
    if (!sel) return;
    try {
      await Api.saveSettings({ waveform_style: sel.value });
      Store.waveformStyle = sel.value;
      const track = Player.getCurrentTrack();
      if (track) this._loadWaveform(track);
      this._showToast('Waveform style saved');
    } catch (e) {
      this._showToast('Failed to save waveform style');
    }
  },

  async _saveDefaultNowPlayingView() {
    const sel = document.getElementById('setting-default-np-view');
    if (!sel) return;
    try {
      await Api.saveSettings({ default_now_playing_view: sel.value });
      Store.defaultNowPlayingView = sel.value;
      this._showToast('Default Now Playing view saved');
    } catch (e) {
      this._showToast('Failed to save setting');
    }
  },

  async _doBulkImport() {
    const input = document.getElementById('bulk-import-input');
    const btn = document.getElementById('btn-bulk-import') || document.getElementById('bulk-import-btn');
    if (!input || !input.value.trim()) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
    try {
      const result = await Api.bulkImport(input.value);
      this._showToast(result.queued + ' tracks queued');
      input.value = '';
    } catch (e) {
      this._showToast('Bulk import failed');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
    }
  },

  _renderSettingsLocked() {
    this.els.content.innerHTML = '<div class="settings-lock">'
      + '<div class="settings-lock-icon">' + Icons.settings() + '</div>'
      + '<div class="settings-lock-title">Settings</div>'
      + '<div class="settings-lock-desc">Admin access required. '
      + (Store.isGuest
          ? '<a href="#" id="settings-login-link">Log in</a> with an admin account.'
          : 'Your account does not have permission to view this page.')
      + '</div></div>';
    const link = document.getElementById('settings-login-link');
    if (link) link.addEventListener('click', (e) => { e.preventDefault(); this.showLoginScreen(); });
  },

  _renderUserSettings() {
    let html = '<div class="page-header">'
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Settings</span></div>';
    html += '<div class="lib-tabs" id="settings-tabs">'
      + '<button class="lib-tab active" data-settings-tab="account">Account</button>'
      + '<button class="lib-tab" data-settings-tab="about">About</button>'
      + '</div>';
    html += '<div class="settings-tab-content" id="settings-tab-content">';
    html += '<div class="settings-tab-panel active" data-panel="account">'
      + '<div class="settings-section-desc">Signed in as <strong>' + this._esc(Store.user.username || '') + '</strong></div>'
      + '<div class="settings-subsection-label" style="margin-top:16px">Change Password</div>'
      + '<div class="settings-field"><label>Current Password</label>'
      + '<input type="password" id="user-pw-current" class="settings-input" autocomplete="current-password" placeholder="current password"></div>'
      + '<div class="settings-field"><label>New Password</label>'
      + '<input type="password" id="user-pw-new" class="settings-input" autocomplete="new-password" placeholder="new password"></div>'
      + '<div class="settings-actions" style="margin-top:8px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-user-change-pw">' + Icons.check() + '<span>Update Password</span></button>'
      + '</div>'
      + '<div id="user-pw-msg" class="settings-section-desc" style="margin-top:8px;font-size:12px;min-height:16px"></div>'
      + '</div>';
    html += '<div class="settings-tab-panel" data-panel="about">'
      + '<div class="settings-about">'
      + '<img class="settings-about-logo" src="/icon.png" alt="">'
      + '<div class="settings-about-name">Seekify</div>'
      + '<div class="settings-about-tag" style="color:var(--text3);font-size:13px">Personal music library</div>'
      + '</div></div>';
    html += '</div>';
    this.els.content.innerHTML = html;

    this.els.content.querySelectorAll('[data-settings-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.settingsTab;
        this.els.content.querySelectorAll('[data-settings-tab]').forEach(t => t.classList.remove('active'));
        this.els.content.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = this.els.content.querySelector('[data-panel="' + target + '"]');
        if (panel) panel.classList.add('active');
      });
    });

    const pwBtn = document.getElementById('btn-user-change-pw');
    if (pwBtn) pwBtn.addEventListener('click', () => this._changeOwnPassword());
  },

  async _changeOwnPassword() {
    const cur = (document.getElementById('user-pw-current') || {}).value || '';
    const nw = (document.getElementById('user-pw-new') || {}).value || '';
    const msg = document.getElementById('user-pw-msg');
    if (!cur || !nw) { if (msg) { msg.textContent = 'Fill in both fields'; msg.style.color = '#ff6b6b'; } return; }
    try {
      const res = await Api.changePassword(cur, nw);
      if (res && res.ok) {
        if (msg) { msg.textContent = 'Password updated'; msg.style.color = '#22c55e'; }
        document.getElementById('user-pw-current').value = '';
        document.getElementById('user-pw-new').value = '';
      } else {
        const d = res && res.data;
        if (msg) { msg.textContent = (d && (d.error || d.message)) || 'Failed to update'; msg.style.color = '#ff6b6b'; }
      }
    } catch (e) {
      if (msg) { msg.textContent = 'Failed to update'; msg.style.color = '#ff6b6b'; }
    }
  },

  async _loadMetadataStatus() {
    const statusEl = document.getElementById('metadata-status');
    if (!statusEl) return;
    try {
      const counts = await Api.metadataCounts();
      const total = counts.pending + counts.approved + counts.rejected;
      if (total === 0) {
        statusEl.innerHTML = '<div class="settings-stat">No metadata matches yet. Click "Scan Metadata" to start.</div>';
      } else {
        let s = '<div class="settings-stats-row">';
        if (counts.pending > 0) s += '<div class="settings-stat"><span class="settings-stat-num">' + counts.pending + '</span> pending review</div>';
        if (counts.approved > 0) s += '<div class="settings-stat"><span class="settings-stat-num">' + counts.approved + '</span> approved</div>';
        if (counts.rejected > 0) s += '<div class="settings-stat"><span class="settings-stat-num">' + counts.rejected + '</span> rejected</div>';
        s += '</div>';
        statusEl.innerHTML = s;

        const reviewBtn = document.getElementById('btn-meta-review');
        if (reviewBtn && counts.pending > 0) {
          reviewBtn.style.display = '';
        }
      }
    } catch (err) {
      statusEl.innerHTML = '<div class="settings-stat">Could not load status</div>';
    }
  },

  async _startMetadataScan() {
    const btn = document.getElementById('btn-meta-scan');
    const statusEl = document.getElementById('metadata-status');
    if (!btn) return;

    const check = await Api.metadataScanProgress();
    if (check && check.running) {
      this._pollScanProgress(btn, statusEl);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner" style="padding:0"></div><span>Starting...</span>';

    try {
      await Api.metadataScan();
      this._pollScanProgress(btn, statusEl);
    } catch (err) {
      this.showToast('Failed to start metadata scan');
      btn.disabled = false;
      btn.innerHTML = Icons.refresh() + '<span>Scan Metadata</span>';
    }
  },

  _pollScanProgress(btn, statusEl) {
    if (!btn) return;
    btn.disabled = true;

    const poll = async () => {
      const p = await Api.metadataScanProgress();
      if (!p) {
        btn.innerHTML = '<div class="loading-spinner" style="padding:0"></div><span>Scanning...</span>';
        setTimeout(poll, 2000);
        return;
      }

      if (p.running) {
        const pct = p.total > 0 ? Math.round((p.scanned / p.total) * 100) : 0;
        btn.innerHTML = '<div class="loading-spinner" style="padding:0"></div><span>Scanning ' + p.scanned + '/' + p.total + ' (' + pct + '%)</span>';
        if (statusEl) {
          statusEl.innerHTML = '<div class="settings-stat">Scanning: <strong>' + this._esc(p.current) + '</strong><br>' + p.scanned + ' of ' + p.total + ' tracks (' + p.matched + ' matches, ' + p.failed + ' failed)</div>';
        }
        setTimeout(poll, 1500);
      } else {
        btn.disabled = false;
        btn.innerHTML = Icons.refresh() + '<span>Scan Metadata</span>';

        if (p.result) {
          const r = p.result;
          let msg = '';
          if (r.autoApproved > 0) {
            msg = 'Auto-approved ' + r.autoApproved + ' tracks';
            if (r.pending > 0) msg += ', ' + r.pending + ' need review';
          } else if (r.pending > 0) {
            msg = 'Found ' + r.pending + ' matches to review';
          } else {
            msg = 'Scan complete';
          }
          if (r.failed > 0) msg += ' (' + r.failed + ' failed)';
          this.showToast(msg);
        } else {
          this.showToast('Scan complete');
        }
        this._loadMetadataStatus();
        Store.refreshLibrary();
      }
    };

    setTimeout(poll, 500);
  },

  async _clearMetadata() {
    try {
      await Api.metadataClear();
      this.showToast('Matches cleared');
      await this._loadMetadataStatus();
    } catch (err) {
      this.showToast('Failed to clear');
    }
  },

  _openHomepageLayoutModal() {
    const modal = document.getElementById('home-layout-modal');
    const body = document.getElementById('home-layout-body');
    if (!modal || !body) return;

    modal.classList.remove('hidden');

    const layout = Store.getHomeLayout();

    let html = '<div class="hl-hint">Drag to reorder</div>';
    html += '<div class="hl-sections" id="hl-sections">';
    layout.filter(s => Store.isAdmin || s.id !== 'needs-review').forEach((s, i) => {
      html += '<div class="hl-section' + (s.enabled ? ' hl-enabled' : '') + '" data-section-id="' + s.id + '" data-index="' + i + '">'
        + '<div class="hl-row">'
        + '<div class="hl-drag" aria-label="Drag to reorder">' + Icons.grip() + '</div>'
        + '<div class="hl-label">' + this._esc(s.title) + '</div>'
        + '<div class="hl-toggle' + (s.enabled ? ' active' : '') + '" data-section-id="' + s.id + '">'
        + '<div class="hl-toggle-track"><div class="hl-toggle-knob"></div></div>'
        + '</div>'
        + '</div>'
        + '<div class="hl-options' + (s.enabled ? '' : ' hl-options-collapsed') + '" data-section-id="' + s.id + '">'
        + '<div class="hl-options-inner"></div>'
        + '</div>'
        + '</div>';
    });
    html += '</div>';
    body.innerHTML = html;

    const close = () => {
      const sheet = modal.querySelector('.home-layout-sheet');
      if (sheet) sheet.style.animation = 'sheetSlideOutUp 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
      modal.style.animation = 'modalFadeOut 0.25s ease forwards';
      setTimeout(() => {
        modal.classList.add('hidden');
        modal.style.animation = '';
        if (sheet) sheet.style.animation = '';
      }, 250);
    };
    modal.addEventListener('click', function handler(e) {
      if (e.target === modal) { close(); modal.removeEventListener('click', handler); }
    });

    body.querySelectorAll('.hl-toggle').forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = toggle.dataset.sectionId;
        const isActive = toggle.classList.toggle('active');
        const section = toggle.closest('.hl-section');
        if (section) section.classList.toggle('hl-enabled', isActive);
        const options = body.querySelector('.hl-options[data-section-id="' + id + '"]');
        if (options) options.classList.toggle('hl-options-collapsed');
      });
    });

    const saveBtn = document.getElementById('home-layout-save');
    const cancelBtn = document.getElementById('home-layout-cancel');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        this._saveHomeLayoutFromModal(body);
        close();
        if (Store.currentView === 'home') this._renderHomeContent();
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        close();
      });
    }

    this._bindHomeLayoutDrag(body);
  },

  _saveHomeLayoutFromModal(body) {
    const items = body.querySelectorAll('.hl-section');
    const layout = [];
    items.forEach(item => {
      const id = item.dataset.sectionId;
      const toggle = item.querySelector('.hl-toggle');
      const def = Store.defaultHomeLayout.find(d => d.id === id);
      layout.push({
        id,
        title: def ? def.title : id,
        enabled: toggle ? toggle.classList.contains('active') : true
      });
    });
    Store.saveHomeLayout(layout);
  },

  _bindHomeLayoutDrag(body) {
    const list = document.getElementById('hl-sections');
    if (!list) return;
    const d = this._homeLayoutDrag;
    const self = this;

    const startDrag = (item, clientX, clientY) => {
      const rect = item.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      d.offsetY = clientY - rect.top;
      const itemH = item.offsetHeight;
      const itemW = list.offsetWidth;
      d.spacer = document.createElement('div');
      d.spacer.className = 'hl-drag-spacer';
      d.spacer.style.height = itemH + 'px';
      list.insertBefore(d.spacer, item);
      item.classList.add('hl-dragging');
      item.style.position = 'absolute';
      item.style.left = '0';
      item.style.width = itemW + 'px';
      item.style.top = (clientY - d.offsetY - listRect.top) + 'px';
      item.style.zIndex = '200';
    };

    const moveDrag = (clientY) => {
      const listRect = list.getBoundingClientRect();
      d.item.style.top = (clientY - d.offsetY - listRect.top) + 'px';
      const items = list.querySelectorAll('.hl-section:not(.hl-dragging)');
      let inserted = false;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) {
          list.insertBefore(d.spacer, item);
          inserted = true;
          break;
        }
      }
      if (!inserted) list.appendChild(d.spacer);
    };

    const endDrag = () => {
      if (!d.item || !d.dragging || !d.spacer) {
        d.item = null;
        d.dragging = false;
        return;
      }
      list.insertBefore(d.item, d.spacer);
      d.spacer.remove();
      d.spacer = null;
      d.item.classList.remove('hl-dragging');
      d.item.style.position = '';
      d.item.style.left = '';
      d.item.style.top = '';
      d.item.style.width = '';
      d.item.style.zIndex = '';
      const sections = list.querySelectorAll('.hl-section');
      sections.forEach((s, i) => s.dataset.index = i);
      d.item = null;
      d.dragging = false;
    };

    list.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.hl-drag');
      if (!handle) return;
      const item = handle.closest('.hl-section');
      if (!item) return;
      d.item = item;
      d.startX = e.touches[0].clientX;
      d.startY = e.touches[0].clientY;
      d.dragging = false;
    }, { passive: true });

    list.addEventListener('touchmove', (e) => {
      if (!d.item) return;
      const dy = e.touches[0].clientY - d.startY;
      if (!d.dragging) {
        if (Math.abs(dy) < 8) return;
        d.dragging = true;
        startDrag(d.item, e.touches[0].clientX, e.touches[0].clientY);
      }
      if (d.dragging) {
        e.preventDefault();
        moveDrag(e.touches[0].clientY);
      }
    }, { passive: false });

    list.addEventListener('touchend', () => {
      if (!d.item) return;
      endDrag();
    }, { passive: true });

    list.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.hl-drag');
      if (!handle) return;
      e.preventDefault();
      const item = handle.closest('.hl-section');
      if (!item) return;
      d.item = item;
      d.startX = e.clientX;
      d.startY = e.clientY;
      d.dragging = false;

      const onMouseMove = (e) => {
        const dy = e.clientY - d.startY;
        if (!d.dragging) {
          if (Math.abs(dy) < 5) return;
          d.dragging = true;
          startDrag(d.item, e.clientX, e.clientY);
        }
        if (d.dragging) moveDrag(e.clientY);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        endDrag();
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  },

  async _toggleDownloadPanel() {
    const container = document.getElementById('download-list');
    if (!container) return;

    if (container.innerHTML !== '') {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '<div class="loading-spinner" style="margin:12px auto"></div>';

    try {
      const downloadable = await Api.getDownloadable();
      const allTracks = Store.library.tracks.slice().sort((a, b) => a.title.localeCompare(b.title));

      let html = '<div style="margin-top:12px">'
        + '<input type="search" enterkeyhint="search" id="download-search" placeholder="Search songs..." style="width:100%;padding:10px 14px;background:var(--l2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;margin-bottom:8px">';

      const renderList = (filter) => {
        const filtered = filter ? allTracks.filter(t =>
          t.title.toLowerCase().includes(filter) || (t.artist && t.artist.toLowerCase().includes(filter))
        ) : allTracks;

        let listHtml = '<div style="max-height:400px;overflow-y:auto;border-radius:var(--radius-sm)">';
        filtered.forEach(t => {
          const enabled = t.downloadEnabled;
          listHtml += '<div class="download-track-row" data-track-id="' + t.id + '" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer">'
            + '<button class="download-toggle" data-track-id="' + t.id + '" style="width:36px;height:36px;border-radius:50%;border:2px solid ' + (enabled ? 'var(--accent)' : 'var(--l4)') + ';background:' + (enabled ? 'var(--accent)' : 'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;color:' + (enabled ? 'var(--bg)' : 'var(--text-muted)') + '">' + (enabled ? Icons.check() : '') + '</button>'
            + '<div style="flex:1;min-width:0">'
            + '<div style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + this._esc(t.title) + '</div>'
            + '<div style="font-size:12px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + this._esc(t.artist || 'Unknown') + '</div>'
            + '</div></div>';
        });
        listHtml += '</div>';
        return listHtml;
      };

      html += renderList('');
      html += '</div>';
      container.innerHTML = html;

      // Search filter
      const searchInput = document.getElementById('download-search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          const filter = searchInput.value.toLowerCase().trim();
          const listContainer = container.querySelector('[style*="max-height"]');
          if (listContainer) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = renderList(filter);
            const newList = tempDiv.querySelector('[style*="max-height"]');
            listContainer.replaceWith(newList);
            bindToggles(newList);
          }
        });
      }

      const bindToggles = (root) => {
        root.querySelectorAll('.download-toggle').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const trackId = btn.dataset.trackId;
            btn.disabled = true;
            const result = await Api.toggleDownload(trackId);
            if (result !== null) {
              const track = Store.getTrack(trackId);
              if (track) track.downloadEnabled = result.enabled;
              const enabled = result.enabled;
              btn.style.borderColor = enabled ? 'var(--accent)' : 'var(--l4)';
              btn.style.background = enabled ? 'var(--accent)' : 'transparent';
              btn.style.color = enabled ? 'var(--bg)' : 'var(--text-muted)';
              btn.innerHTML = enabled ? Icons.check() : '';
              this.showToast(enabled ? 'Download enabled' : 'Download disabled');
            }
            btn.disabled = false;
          });
        });
      };

      bindToggles(container);

    } catch (err) {
      container.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:13px">Failed to load tracks</div>';
    }
  },

});

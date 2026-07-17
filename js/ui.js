const UI = {
  els: {},
  seeking: false,
  contextTrackId: null,
  playlistModalTrackId: null,
  libFilter: 'playlists',
  viewMode: 'list',
  searchQuery: '',
  searchGenre: '',
  _searchTimer: null,
  _viewTrackList: [],
  _toastTimer: null,
  _contextMenuActions: null,
  _contextMenuTrigger: null,
  _navHistory: [],
  _realWaveform: false,
  _waveformRawPeaks: null,
  _queueDrag: { item: null, spacer: null, dragging: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 },

  init() {
    this._cacheDom();
    this._bindTabBar();
    this._bindMiniPlayer();
    this._bindNowPlaying();
    this._bindNowPlayingSwipe();
    this._bindSeekBar();
    this._bindVolumeBar();
    this._bindQueuePanel();
    this._bindModals();
    this._bindContentEvents();
    this._colorCanvas = document.getElementById('color-sample-canvas');
    this._colorCtx = this._colorCanvas.getContext('2d', { willReadFrequently: true });
    this._lastColorAlbumId = null;
    this._renderQueue();
    this._setupMiniVolume();
    this._updateVolumeBar();
    this._bindResize();
    this._bindQueueSwipe();
    this._bindQueueDrag();
    this._pollDownloadBadge();
  },

  // --- Auth / user state ---

  showLoginScreen() {
    this._showAuthOverlay('login');
  },

  showSetupScreen() {
    this._showAuthOverlay('setup');
  },

  hideAuthOverlay() {
    const ov = document.getElementById('auth-overlay');
    if (ov) ov.classList.add('hidden');
  },

  _showAuthOverlay(mode) {
    const ov = document.getElementById('auth-overlay');
    if (!ov) return;
    const title = document.getElementById('auth-title');
    const sub = document.getElementById('auth-sub');
    const emailWrap = document.getElementById('auth-email-wrap');
    const submit = document.getElementById('auth-submit');
    const err = document.getElementById('auth-error');
    const userInp = document.getElementById('auth-username');
    const pwInp = document.getElementById('auth-password');
    const isSetup = mode === 'setup';
    const isRegister = mode === 'register';
    if (title) title.textContent = isSetup ? 'Create admin account' : (isRegister ? 'Create account' : 'Log in');
    if (sub) sub.textContent = isSetup ? 'Set up your music server'
      : (isRegister ? (Store.registrationMode === 'approval' ? 'An admin must approve your account' : 'Pick a username and password') : '');
    if (emailWrap) emailWrap.classList.toggle('hidden', !isSetup);
    if (submit) submit.textContent = isSetup ? 'Create admin' : (isRegister ? 'Register' : 'Log in');
    if (err) { err.textContent = ''; err.classList.add('hidden'); err.classList.remove('success'); }
    if (userInp) userInp.value = '';
    if (pwInp) pwInp.value = '';

    const cancelBtn = document.getElementById('auth-cancel');
    if (cancelBtn) {
      cancelBtn.classList.toggle('hidden', isSetup);
      cancelBtn.onclick = () => this.hideAuthOverlay();
    }

    const switchLink = document.getElementById('auth-mode-switch');
    if (switchLink) {
      if (mode === 'login' && Store.registrationMode !== 'off') {
        switchLink.classList.remove('hidden');
        switchLink.textContent = "Don't have an account? Register";
        switchLink.onclick = (e) => { e.preventDefault(); this._showAuthOverlay('register'); };
      } else if (isRegister) {
        switchLink.classList.remove('hidden');
        switchLink.textContent = 'Already have an account? Log in';
        switchLink.onclick = (e) => { e.preventDefault(); this._showAuthOverlay('login'); };
      } else {
        switchLink.classList.add('hidden');
        switchLink.onclick = null;
      }
    }

    const submitHandler = () => this._submitAuth(mode);
    const form = document.getElementById('auth-form');
    if (form) form.onsubmit = (e) => { e.preventDefault(); submitHandler(); };
    ov.classList.remove('hidden');
    if (userInp) setTimeout(() => userInp.focus(), 50);
  },

  async _submitAuth(mode) {
    const username = (document.getElementById('auth-username').value || '').trim();
    const password = document.getElementById('auth-password').value || '';
    const email = (document.getElementById('auth-email').value || '').trim();
    const err = document.getElementById('auth-error');
    const submit = document.getElementById('auth-submit');
    if (!username || !password) {
      if (err) { err.textContent = 'Enter a username and password'; err.classList.remove('hidden'); err.classList.remove('success'); }
      return;
    }
    if (submit) submit.disabled = true;
    let res;
    if (mode === 'setup') {
      res = await Api.setup(username, password, email);
    } else if (mode === 'register') {
      res = await Api.register(username, password);
    } else {
      res = await Api.login(username, password);
    }
    if (submit) submit.disabled = false;
    if (mode === 'register' && res && res.status === 202) {
      // Approval mode: account created but awaiting admin approval.
      if (err) { err.textContent = 'Account created! An admin must approve it before you can log in.'; err.classList.remove('hidden'); err.classList.add('success'); }
    } else if (res && res.ok) {
      this.hideAuthOverlay();
      window.location.reload();
    } else {
      const data = res && res.data;
      const fallback = mode === 'setup' ? 'Setup failed' : (mode === 'register' ? 'Registration failed' : 'Invalid credentials');
      const msg = (data && (data.error || data.message)) || fallback;
      if (err) { err.textContent = msg; err.classList.remove('hidden'); err.classList.remove('success'); }
    }
  },

  async _logout() {
    if (!confirm('Log out?')) return;
    try { await Api.logout(); } catch (e) {}
    window.location.reload();
  },

  // Guest tried a login-only action (download). Show a prominent prompt
  // instead of a silent 401. Built lazily; reused across finder + ripper.
  _showAccountRequired() {
    let modal = document.getElementById('account-required-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'account-required-modal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:10001;display:flex;align-items:center;justify-content:center;padding:24px';
      modal.innerHTML =
        '<div style="background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:32px 28px;max-width:360px;width:100%;text-align:center;box-shadow:var(--shadow-deep)">'
        + '<div style="width:56px;height:56px;border-radius:50%;background:rgba(212,240,64,.12);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;color:var(--accent)">' + Icons.person() + '</div>'
        + '<div style="font-size:20px;font-weight:700;color:var(--text1);margin-bottom:8px;letter-spacing:-0.01em">Account required</div>'
        + '<div style="font-size:14px;color:var(--text3);margin-bottom:24px;line-height:1.5">Log in to download music to your library.</div>'
        + '<button id="ar-login" style="width:100%;padding:13px;border:none;border-radius:var(--radius-sm);background:var(--accent);color:var(--bg);font-family:var(--ff);font-size:15px;font-weight:700;cursor:pointer;margin-bottom:10px">Log in</button>'
        + '<button id="ar-dismiss" style="width:100%;padding:13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:transparent;color:var(--text2);font-family:var(--ff);font-size:15px;cursor:pointer">Maybe later</button>'
        + '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => {
        if (e.target === modal || e.target.id === 'ar-dismiss') {
          modal.style.display = 'none';
        } else if (e.target.closest('#ar-login')) {
          modal.style.display = 'none';
          this.showLoginScreen();
        }
      });
    }
    modal.style.display = 'flex';
  },

  // Navbar is static (home/finder/library). Personal surfaces (favorites,
  // settings) are reached via the Library view and the home Options menu.
  renderUserState() {
    this._renderUserChip();
  },

  // Login/logout live in the home Options menu now; remove any stale floating chip.
  _renderUserChip() {
    const chip = document.getElementById('user-chip');
    if (chip) chip.remove();
  },

  _cacheDom() {
    this.els = {
      header: document.getElementById('app-header'),
      content: document.getElementById('app-content'),
      miniPlayer: document.getElementById('mini-player'),
      miniArt: document.querySelector('.mini-art'),
      miniTitle: document.querySelector('.mini-title'),
      miniArtist: document.querySelector('.mini-artist'),
      miniPlayBtn: document.querySelector('.mini-play-btn'),
      miniProgress: document.querySelector('.mini-progress'),
      nowPlaying: document.getElementById('now-playing'),
      npArt: document.getElementById('np-art'),
      npArtBg: document.getElementById('np-art-bg'),
      npTitle: document.getElementById('np-title'),
      npArtist: document.getElementById('np-artist'),
      npLikeBtn: document.getElementById('np-like-btn'),
      npDownloadBtn: document.getElementById('np-download-btn'),
      npPlay: document.getElementById('np-play'),
      npPrev: document.getElementById('np-prev'),
      npNext: document.getElementById('np-next'),
      npShuffle: document.getElementById('np-shuffle'),
      npRepeat: document.getElementById('np-repeat'),
      npTimeCurrent: document.getElementById('np-time-current'),
      npTimeTotal: document.getElementById('np-time-total'),
      waveformCanvas: document.getElementById('np-waveform'),
      volumeBar: document.querySelector('.np-volume-bar'),
      volumeFill: document.querySelector('.np-volume-fill'),
      volumeBtn: document.querySelector('.np-volume button'),
      queueVolumeBar: document.querySelector('.queue-volume-bar'),
      queueVolumeFill: document.querySelector('.queue-volume-fill'),
      queueVolumeBtn: document.querySelector('.queue-volume-btn'),
      miniVolumeBtn: null,
      miniVolumeBar: null,
      miniVolumeFill: null,
      queuePanel: document.getElementById('queue-panel'),
      queueList: document.getElementById('queue-list'),
      playlistModal: document.getElementById('playlist-modal'),
      playlistModalList: document.getElementById('playlist-modal-list'),
      createPlaylistBtn: document.getElementById('create-playlist-btn'),
      contextMenu: document.getElementById('context-menu'),
      contextMenuItems: document.getElementById('context-menu-items'),
      npHeaderText: document.querySelector('.np-header-text'),
    };
  },

  _bindTabBar() {
    const tabs = document.querySelectorAll('.tab-item');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (!this.els.nowPlaying.classList.contains('hidden')) {
          this.hideNowPlaying();
        }
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._updateTabIcons();
        const tabName = tab.dataset.tab;
        Store.currentTab = tabName;
        // Favorites tab navigates to favorites view
        if (tabName === 'favorites') {
          Store.currentView = 'favorites';
          Store.viewData = {};
        } else {
          Store.currentView = tabName;
          Store.viewData = {};
        }
        this.searchGenre = '';
        this._newSongsLimit = 6;
        this.renderPage();
        this.els.content.scrollTop = 0;
      });
    });
  },

  _tabIcons: {
    home: { inactive: () => Icons.home(), active: () => Icons.homeFilled() },
    finder: { inactive: () => Icons.magnet(), active: () => Icons.magnetFilled() },
    library: { inactive: () => Icons.library(), active: () => Icons.libraryFilled() },
  },

  _updateTabIcons() {
    document.querySelectorAll('.tab-item').forEach(t => {
      const map = this._tabIcons[t.dataset.tab];
      if (!map) return;
      const svg = t.querySelector('svg');
      if (!svg) return;
      const newSvg = t.classList.contains('active') ? map.active() : map.inactive();
      svg.outerHTML = newSvg;
    });
  },

  _bindMiniPlayer() {
    this.els.miniPlayer.addEventListener('click', (e) => {
      if (e.target.closest('.mini-play-btn')) {
        Player.togglePlay();
      } else if (e.target.closest('.mini-prev-btn')) {
        Player.prev();
      } else if (e.target.closest('.mini-next-btn')) {
        Player.next();
      } else if (!e.target.closest('.mini-btn') && !e.target.closest('.mini-volume-wrap')) {
        this.showNowPlaying();
      }
    });
  },

  _bindNowPlaying() {
    document.querySelector('.np-chevron-down').addEventListener('click', () => {
      this.hideNowPlaying();
    });

    document.querySelector('.np-more').addEventListener('click', (e) => {
      const track = Player.getCurrentTrack();
      if (track) this._showTrackContextMenu(track.id, e.currentTarget);
    });

    this.els.npPlay.addEventListener('click', () => {
      Player.togglePlay();
    });

    this.els.npPrev.addEventListener('click', () => {
      Player.prev();
    });

    this.els.npNext.addEventListener('click', () => {
      Player.next();
    });

    this.els.npShuffle.addEventListener('click', () => {
      Player.toggleShuffle();
      this.updateNowPlaying();
    });

    this.els.npRepeat.addEventListener('click', () => {
      Player.cycleRepeat();
      this.updateNowPlaying();
    });

    this.els.npLikeBtn.addEventListener('click', async () => {
      const track = Player.getCurrentTrack();
      if (!track) return;
      try {
        await Api.toggleFavorite(track.id);
        await Store.refreshFavorites();
        this.updateNowPlaying();
        this.showToast(Store.isFavorite(track.id) ? 'Added to favorites' : 'Removed from favorites');
      } catch (err) {
        this.showToast('Failed to update favorites');
      }
    });

    document.querySelector('.np-queue-btn').addEventListener('click', () => {
      if (this.els.queuePanel.classList.contains('hidden')) {
        this.showQueue();
      } else {
        this.hideQueue();
      }
    });

    document.getElementById('np-share-btn').addEventListener('click', async () => {
      const track = Player.getCurrentTrack();
      if (!track) return;
      const shareUrl = window.location.origin + '/?play=' + track.id;
      if (navigator.share) {
        try {
          await navigator.share({ url: shareUrl });
        } catch (err) {
          if (err.name !== 'AbortError') {
            this.showToast('Share failed');
          }
        }
      } else {
        try {
          await navigator.clipboard.writeText(shareUrl);
          this.showToast('Link copied');
        } catch (err) {
          this.showToast('Share not supported');
        }
      }
    });

    document.getElementById('np-rip-btn').addEventListener('click', () => {
      const track = Player.getCurrentTrack();
      if (!track) return;
      const artistName = track.artist;
      Api.finderSearch(artistName, 'artist').then(data => {
        if (Array.isArray(data) && data.length > 0) {
          const mbid = data[0].id;
          if (mbid) {
            this.navigateTo('finder-artist', { mbid, name: artistName });
            return;
          }
        }
        this.showToast('Artist not found on MusicBrainz');
      }).catch(() => {
        this.showToast('Search failed');
      });
    });

    document.getElementById('np-download-btn').addEventListener('click', () => {
      const track = Player.getCurrentTrack();
      if (!track) return;
      const ext = track.filePath ? '.' + track.filePath.split('.').pop() : '';
      const a = document.createElement('a');
      a.href = Api.downloadUrl(track.id);
      a.download = (track.artist ? track.artist + ' - ' : '') + (track.title || 'track') + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    this.els.volumeBtn.addEventListener('click', () => {
      Player.toggleMute();
    });

    if (this.els.queueVolumeBtn) {
      this.els.queueVolumeBtn.addEventListener('click', () => {
        Player.toggleMute();
      });
    }
  },

  _barFraction(bar, e, fallback) {
    const rect = bar.getBoundingClientRect();
    if (rect.width === 0) return fallback !== undefined ? fallback : 0;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  },

  _bindSeekBar() {
    const canvas = this.els.waveformCanvas;
    if (!canvas) return;

    this._waveformData = [];
    this._waveformHoverX = -1;

    const getFraction = (e) => this._barFraction(canvas, e);

    const onStart = (e) => {
      this._waveformHoverX = -1;
      this.seeking = true;
      const f = getFraction(e);
      this._waveformProgress = f;
      this._paintWaveform(f);
    };

    const onMove = (e) => {
      if (!this.seeking) return;
      if (e.cancelable) e.preventDefault();
      const f = getFraction(e);
      this._waveformProgress = f;
      this._paintWaveform(f);
    };

    const onEnd = (e) => {
      if (!this.seeking) return;
      this.seeking = false;
      this._waveformHoverX = -1;
      const rect = canvas.getBoundingClientRect();
      let clientX;
      if (e.changedTouches) {
        clientX = e.changedTouches[0].clientX;
      } else {
        clientX = e.clientX;
      }
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      this._waveformProgress = f;
      this._paintWaveform(f);
      Player.seek(f);
    };

    const onCancel = () => {
      if (!this.seeking) return;
      this.seeking = false;
      this._waveformHoverX = -1;
      const duration = Player.audio.duration;
      const f = duration && isFinite(duration) ? Player.audio.currentTime / duration : 0;
      this._waveformProgress = f;
      this._paintWaveform(f);
    };

    canvas.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onCancel);

    canvas.addEventListener('mousemove', (e) => {
      if (this.seeking) return;
      const rect = canvas.getBoundingClientRect();
      this._waveformHoverX = e.clientX - rect.left;
      this._paintWaveform(this._waveformProgress || 0);
    });

    canvas.addEventListener('mouseleave', () => {
      this._waveformHoverX = -1;
      this._paintWaveform(this._waveformProgress || 0);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (this._realWaveform && this._waveformRawPeaks) {
        this._scaleWaveformData();
      } else {
        this._generateWaveform();
      }
      this._paintWaveform(this._waveformProgress || 0);
    });
    resizeObserver.observe(canvas.parentElement);
  },

  _bindTopProgress() {
    const bar = document.querySelector('.np-top-progress');
    if (!bar) return;
    this.topSeeking = false;

    const getFraction = (e) => this._barFraction(bar, e);

    const onStart = (e) => {
      this.topSeeking = true;
      const f = getFraction(e);
      if (this.els.topProgressFill) this.els.topProgressFill.style.width = (f * 100) + '%';
    };

    const onMove = (e) => {
      if (!this.topSeeking) return;
      const f = getFraction(e);
      if (this.els.topProgressFill) this.els.topProgressFill.style.width = (f * 100) + '%';
    };

    const onEnd = (e) => {
      if (!this.topSeeking) return;
      this.topSeeking = false;
      const rect = bar.getBoundingClientRect();
      let clientX;
      if (e.changedTouches) {
        clientX = e.changedTouches[0].clientX;
      } else {
        clientX = e.clientX;
      }
      const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      Player.seek(f);
    };

    bar.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    bar.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
  },

  _bindVolumeBar() {
    const self = this;

    const bindBar = (bar, opts) => {
      if (!bar) return;
      const state = { dragging: false };

      const getFraction = (e) => this._barFraction(bar, e, Player.volume);

      const onStart = (e) => {
        state.dragging = true;
        e.preventDefault();
        Player.setVolume(getFraction(e));
        self._updateVolumeBar();
      };

      const onMove = (e) => {
        if (!state.dragging) return;
        Player.setVolume(getFraction(e));
        self._updateVolumeBar();
      };

      const onEnd = () => {
        if (!state.dragging) return;
        state.dragging = false;
        if (opts && opts.onEnd) opts.onEnd();
      };

      bar.addEventListener('mousedown', onStart);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      bar.addEventListener('touchstart', onStart, { passive: false });
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    };

    bindBar(this.els.volumeBar);
    bindBar(this.els.queueVolumeBar);
  },

  _setupMiniVolume() {
    const miniRight = document.querySelector('.mini-right');
    if (!miniRight) return;

    miniRight.innerHTML =
      '<div class="mini-volume-wrap">'
      + '<button class="mini-volume-btn" aria-label="Volume">' + Icons.volume() + '</button>'
      + '<div class="mini-volume-bar"><div class="mini-volume-fill"></div></div>'
      + '</div>';

    const wrap = miniRight.querySelector('.mini-volume-wrap');
    this.els.miniVolumeBtn = wrap.querySelector('.mini-volume-btn');
    this.els.miniVolumeBar = wrap.querySelector('.mini-volume-bar');
    this.els.miniVolumeFill = wrap.querySelector('.mini-volume-fill');

    // Toggle mute
    this.els.miniVolumeBtn.addEventListener('click', () => {
      Player.toggleMute();
    });

    // Drag bar — independent state, keeps wrap active during drag
    const bar = this.els.miniVolumeBar;
    const self = this;
    if (bar) {
      let dragging = false;

      const getFrac = (e) => this._barFraction(bar, e, Player.volume);

      bar.addEventListener('mousedown', (e) => {
        dragging = true;
        wrap.classList.add('active');
        e.preventDefault();
        Player.setVolume(getFrac(e));
        self._updateVolumeBar();
      });
      document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        Player.setVolume(getFrac(e));
        self._updateVolumeBar();
      });
      document.addEventListener('mouseup', () => {
        if (dragging) {
          dragging = false;
          wrap.classList.remove('active');
        }
      });
    }
  },

  _bindQueuePanel() {
    document.querySelector('.queue-close').addEventListener('click', () => {
      this.hideQueue();
    });

    document.querySelector('.queue-share-btn').addEventListener('click', async () => {
      if (Player.queue.length === 0) return;
      const ids = Player.queue.map(t => t.id);
      try {
        const result = await Api.shareQueue(ids);
        const shareUrl = window.location.origin + '/?q=' + result.id;
        if (navigator.share) {
          await navigator.share({ title: 'Music Queue', url: shareUrl }).catch(() => {});
        } else {
          await navigator.clipboard.writeText(shareUrl);
          this.showToast('Link copied');
        }
      } catch (err) {
        this.showToast('Share failed');
      }
    });

    this._queueClickActive = false;

    document.addEventListener('click', (e) => {
      if (window.innerWidth >= 768) return;
      if (this._queueClickActive) {
        this._queueClickActive = false;
        return;
      }
      const panel = this.els.queuePanel;
      if (panel.classList.contains('hidden')) return;
      if (panel.contains(e.target)) return;
      if (e.target.closest('.np-queue-btn')) return;
      if (e.target.closest('#context-menu')) return;
      if (e.target.closest('#playlist-modal')) return;
      this.hideQueue();
    });

    this.els.queueList.addEventListener('click', (e) => {
      if (e.target.closest('.queue-item-more')) {
        const item = e.target.closest('.queue-item');
        if (!item) return;
        const index = parseInt(item.dataset.queueIndex);
        if (isNaN(index)) return;
        this._showQueueItemContextMenu(index, e.target.closest('.queue-item-more'));
        return;
      }
      const item = e.target.closest('.queue-item');
      if (!item) return;
      const index = parseInt(item.dataset.queueIndex);
      if (isNaN(index)) return;
      this._queueClickActive = true;
      Player.playInQueue(index);
    });
  },

  _bindResize() {
    window.addEventListener('resize', () => {
      // Re-render queue if visible
      if (!this.els.queuePanel.classList.contains('hidden')) {
        this._renderQueue();
      }
    });
  },

  _bindQueueSwipe() {
    const panel = this.els.queuePanel;
    let startY = 0;
    let currentY = 0;
    let swiping = false;

    panel.addEventListener('touchstart', (e) => {
      // Only track swipes starting from the header area (top 60px)
      const rect = panel.getBoundingClientRect();
      const touchY = e.touches[0].clientY - rect.top;
      if (touchY > 60) return;
      startY = e.touches[0].clientY;
      swiping = true;
    }, { passive: true });

    panel.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      if (diff > 0) {
        // Dragging down
        panel.style.transform = 'translateY(' + diff + 'px)';
      }
    }, { passive: true });

    panel.addEventListener('touchend', () => {
      if (!swiping) return;
      swiping = false;
      const diff = currentY - startY;
      if (diff > 80) {
        // Swiped down enough — close
        this.hideQueue();
      }
      panel.style.transform = '';
      startY = 0;
      currentY = 0;
    });
  },

  // Swipe-down on the now-playing header or artwork dismisses it (touch only).
  // Binds to .np-header + .np-artwork (excludes waveform seek + control taps).
  _bindNowPlayingSwipe() {
    const np = this.els.nowPlaying;
    if (!np) return;
    let startY = 0, lastY = 0, swiping = false;
    const onStart = (e) => {
      if (np.classList.contains('hidden') || e.touches.length !== 1) return;
      startY = e.touches[0].clientY;
      lastY = startY;
      swiping = true;
      np.style.transition = 'none';
    };
    np.querySelectorAll('.np-header, .np-artwork').forEach(z =>
      z.addEventListener('touchstart', onStart, { passive: true }));

    np.addEventListener('touchmove', (e) => {
      if (!swiping) return;
      lastY = e.touches[0].clientY;
      const diff = lastY - startY;
      if (diff > 0) np.style.transform = 'translateY(' + diff + 'px)';
    }, { passive: true });

    const onEnd = () => {
      if (!swiping) return;
      swiping = false;
      const diff = lastY - startY;
      if (diff > 120) {
        // continue off-screen then finalize (no jump-back into the slide animation)
        np.style.transition = 'transform 0.22s ease-in, opacity 0.22s ease-in';
        np.style.transform = 'translateY(' + Math.round(window.innerHeight * 1.05) + 'px)';
        np.style.opacity = '0';
        const done = (ev) => {
          if (ev.target !== np) return;
          np.removeEventListener('transitionend', done);
          this._applyNowPlayingHiddenState();
        };
        np.addEventListener('transitionend', done);
        this._afterHideNowPlaying();
      } else {
        np.style.transition = 'transform 0.22s ease-out';
        np.style.transform = '';
        setTimeout(() => { np.style.transition = ''; }, 240);
      }
    };
    np.addEventListener('touchend', onEnd);
    np.addEventListener('touchcancel', onEnd);
  },

  _bindQueueDrag() {
    const list = this.els.queueList;
    const d = this._queueDrag;
    const self = this;

    const startDrag = (item, clientX, clientY) => {
      const rect = item.getBoundingClientRect();
      d.offsetX = clientX - rect.left;
      d.offsetY = clientY - rect.top;
      const itemH = item.offsetHeight;
      const itemW = item.offsetWidth;

      d.spacer = document.createElement('div');
      d.spacer.className = 'queue-drag-spacer';
      d.spacer.style.height = itemH + 'px';
      list.insertBefore(d.spacer, item);

      item.classList.add('queue-item-dragging');
      item.style.position = 'fixed';
      item.style.left = rect.left + 'px';
      item.style.top = (clientY - d.offsetY) + 'px';
      item.style.width = itemW + 'px';
      item.style.zIndex = '200';
    };

    const moveDrag = (clientY) => {
      d.item.style.top = (clientY - d.offsetY) + 'px';
      const items = list.querySelectorAll('.queue-item-upnext:not(.queue-item-dragging), .queue-item.active:not(.queue-item-dragging)');
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
      if (!inserted) {
        list.appendChild(d.spacer);
      }
    };

    const endDrag = () => {
      if (!d.item || !d.dragging || !d.spacer) {
        d.item = null;
        d.dragging = false;
        return;
      }
      const fromIndex = parseInt(d.item.dataset.queueIndex);
      const reorderable = list.querySelectorAll('.queue-item-upnext:not(.queue-item-dragging), .queue-item.active:not(.queue-item-dragging)');
      let positionAmongReorderable = 0;
      reorderable.forEach(el => {
        if (el.compareDocumentPosition(d.spacer) & Node.DOCUMENT_POSITION_FOLLOWING) positionAmongReorderable++;
      });
      const toIndex = Player.currentIndex + positionAmongReorderable;

      d.spacer.remove();
      d.spacer = null;

      d.item.classList.remove('queue-item-dragging');
      d.item.style.position = '';
      d.item.style.left = '';
      d.item.style.top = '';
      d.item.style.width = '';
      d.item.style.zIndex = '';

      if (fromIndex !== toIndex && !isNaN(fromIndex) && !isNaN(toIndex)) {
        Player.moveInQueue(fromIndex, toIndex);
      } else {
        self._renderQueue();
      }

      d.item = null;
      d.dragging = false;
    };

    list.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.queue-item-drag');
      if (!handle) return;
      const item = handle.closest('.queue-item');
      if (!item || item.classList.contains('queue-item-history')) return;
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
      const handle = e.target.closest('.queue-item-drag');
      if (!handle) return;
      e.preventDefault();
      const item = handle.closest('.queue-item');
      if (!item || item.classList.contains('queue-item-history')) return;
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
        if (d.dragging) {
          moveDrag(e.clientY);
        }
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

  _bindModals() {
    this.els.contextMenu.addEventListener('click', (e) => {
      if (e.target === this.els.contextMenu || !e.target.closest('.modal-option')) {
        this.hideContextMenu();
      }
    });

    this.els.contextMenuItems.addEventListener('click', (e) => {
      const item = e.target.closest('.modal-option');
      if (!item) return;
      const index = parseInt(item.dataset.menuIndex);
      if (this._contextMenuActions && this._contextMenuActions[index]) {
        this._contextMenuActions[index]();
      }
    });

    document.getElementById('rescan-modal').addEventListener('click', (e) => {
      if (e.target.id === 'rescan-modal') {
        this._closeSheetModal(e.target);
      }
    });

    this.els.playlistModal.addEventListener('click', (e) => {
      if (e.target === this.els.playlistModal) {
        this.hidePlaylistModal();
      }
    });

    this.els.playlistModalList.addEventListener('click', (e) => {
      const item = e.target.closest('.modal-list-item');
      if (!item) return;
      const playlistId = item.dataset.playlistId;
      const playlist = Store.getPlaylist(playlistId);
      if (!playlist || !this.playlistModalTrackId) return;
      if (playlist.trackIds.includes(this.playlistModalTrackId)) {
        this.showToast('Track already in playlist');
        return;
      }
      const newTrackIds = [...playlist.trackIds, this.playlistModalTrackId];
      Api.updatePlaylist(playlistId, { trackIds: newTrackIds }).then(() => {
        Store.refreshPlaylists();
        this.hidePlaylistModal();
        this.showToast('Added to ' + playlist.name);
      }).catch(() => {
        this.showToast('Failed to add to playlist');
      });
    });

    this.els.createPlaylistBtn.addEventListener('click', () => {
      this.els.createPlaylistBtn.style.display = 'none';
      const form = document.createElement('div');
      form.className = 'modal-create-form';
      form.style.cssText = 'display:flex;padding:0 16px 16px;gap:8px;align-items:center;';
      form.innerHTML = '<input type="text" placeholder="Playlist name" style="flex:1;background:var(--bg-highlight);border:none;border-radius:8px;padding:10px 12px;color:var(--text-primary);font-size:14px;"><button style="background:var(--accent);color:#0A0A0A;border-radius:8px;padding:10px 16px;font-size:14px;font-weight:600;">Create</button>';
      this.els.createPlaylistBtn.parentElement.insertBefore(form, this.els.createPlaylistBtn);
      const input = form.querySelector('input');
      const btn = form.querySelector('button');
      input.focus();
      const create = async () => {
        const name = input.value.trim();
        if (!name) return;
        try {
          const playlist = await Api.createPlaylist(name);
          if (this.playlistModalTrackId) {
            await Api.updatePlaylist(playlist.id, { trackIds: [this.playlistModalTrackId] });
          }
          await Store.refreshPlaylists();
          this.hidePlaylistModal();
          this.showToast('Playlist created');
          if (Store.currentView === 'library') this.renderPage();
        } catch (err) {
          this.showToast('Failed to create playlist');
        }
      };
      btn.addEventListener('click', create);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') create();
      });
    });
  },

  _bindContentEvents() {
    const handlers = [
      { sel: '.genre-back', fn: () => { this.searchGenre = ''; this._renderSearchResults(); } },
      { sel: '.back-btn', fn: () => this.navigateBack() },
      { sel: '.lib-tab[data-filter]', fn: (el) => { this.libFilter = el.dataset.filter; this.renderLibrary(); } },
      { sel: '.track-more', fn: (el) => { const row = el.closest('.track-row'); if (row) this._showTrackContextMenu(row.dataset.trackId, el); } },
      { sel: '.track-review-more', fn: (el) => { if (el.dataset.reviewTrackId) this._showReviewTrackMenu(el.dataset.reviewTrackId, el); } },
      { sel: '.track-row, .new-song-card', fn: (el) => this._playTrackRow(el) },
      { sel: '[data-type="artist"]', fn: (el) => { if (el.dataset.type === 'artist') this.navigateTo('artist', { artistName: el.dataset.id }); } },
      { sel: '.card[data-album-id]', fn: (el) => this.navigateTo('album', { albumId: el.dataset.albumId }) },
      { sel: '.quick-play-card, .quick-play-card-inline', fn: (el, e) => this._handleQuickPlayCard(el) },
      { sel: '.category-card', fn: (el) => { this.searchGenre = el.dataset.genre; this.searchQuery = ''; this._renderSearchResults(); } },
      { sel: '.play-all-btn', fn: () => { if (this._viewTrackList.length > 0) { const s = this._getViewSource(); Player.play(this._viewTrackList[0], this._viewTrackList, s); } } },
      { sel: '.detail-play-btn', fn: () => { if (this._viewTrackList.length > 0) { const s = this._getViewSource(); Player.play(this._viewTrackList[0], this._viewTrackList, s); this.showNowPlaying(); } } },
      { sel: '[data-action="rip-more"]', fn: (el) => this._handleRipMore(el) },
      { sel: '.detail-action-btn, .home-review-card', fn: (el) => this._handleAction(el.dataset.action) },
      { sel: '.hero-action-btn', fn: (el) => this._handleHeroAction(el) },
      { sel: '.section-header-link', fn: (el) => {
        if (el.dataset.libraryFilter) {
          this.libFilter = el.dataset.libraryFilter;
          this.navigateTo('library');
        } else if (el.dataset.navigate) {
          this.navigateTo(el.dataset.navigate);
        }
      } },
      { sel: '.list-item-more', fn: (el) => this._showPlaylistMoreMenu(el) },
      { sel: '.list-item', fn: (el) => this._handleListItemClick(el) },
      { sel: '.show-more-btn', fn: (el) => { if (el.dataset.action === 'show-more-new') { this._newSongsLimit = (this._newSongsLimit || 6) + 12; this.renderHome(); } } },
    ];
    this.els.content.addEventListener('click', (e) => {
      for (const h of handlers) {
        const el = e.target.closest(h.sel);
        if (el) { h.fn(el, e); return; }
      }
    });
  },

  _playTrackRow(el) {
    const trackId = el.dataset.trackId;
    const track = Store.getTrack(trackId);
    if (!track) return;
    const favSection = el.closest('[data-home-section="favorites"]');
    if (favSection && Store.currentView === 'home') {
      const favTracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
      const idx = favTracks.findIndex(t => t.id === trackId);
      if (idx !== -1 && favTracks.length > 1) {
        Player.play(track, favTracks, { type: 'favorites', name: 'Favorites' });
      } else {
        Player.play(track, null, null);
      }
    } else {
      this._smartPlay(track);
    }
    this.showNowPlaying();
  },

  _handleQuickPlayCard(el) {
    if (el.dataset.navigate) { this.navigateTo(el.dataset.navigate); return; }
    if (el.dataset.action) { this._handleAction(el.dataset.action); return; }
    if (el.dataset.trackId) {
      const track = Store.getTrack(el.dataset.trackId);
      if (track) {
        if (el.classList.contains('quick-play-card-recent')) {
          const idx = Store.recent.indexOf(track.id);
          if (idx !== -1 && idx > 0) {
            const nextIds = Store.recent.slice(0, idx);
            const seen = new Set();
            const queue = [];
            for (const id of nextIds) {
              if (seen.has(id)) continue;
              seen.add(id);
              const t = Store.getTrack(id);
              if (t) queue.push(t);
              if (queue.length >= 30) break;
            }
            Player.play(track, [track, ...queue], { type: 'recent', name: 'Recently Played' });
          } else {
            Player.play(track, null, null);
          }
        } else {
          this._smartPlay(track);
        }
        this.showNowPlaying();
      }
      return;
    }
    if (el.dataset.albumId) { this.navigateTo('album', { albumId: el.dataset.albumId }); }
  },

  _handleRipMore(el) {
    const artistName = el.dataset.artist;
    Api.finderSearch(artistName, 'artist').then(data => {
      if (Array.isArray(data) && data.length > 0 && data[0].id) {
        this.navigateTo('finder-artist', { mbid: data[0].id, name: artistName });
      } else {
        this.showToast('Artist not found on MusicBrainz');
      }
    }).catch(() => this.showToast('Failed to search MusicBrainz'));
  },

  _handleHeroAction(el) {
    const action = el.dataset.heroAction;
    if (action === 'more-artist') this._showArtistContextMenu(el.dataset.artist, el);
    else if (action === 'more-album') this._showAlbumContextMenu(el.dataset.albumId, el);
    else if (action === 'more-playlist') this._showPlaylistContextMenu(el.dataset.playlistId, el);
  },

  _showPlaylistMoreMenu(el) {
    const plrow = el.closest('.list-item');
    if (!plrow || plrow.dataset.type !== 'playlist') return;
    const id = plrow.dataset.id;
    const playlist = Store.getPlaylist(id);
    if (!playlist) return;
    this.showContextMenu([
      { label: 'Play', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        const tracks = playlist.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
        if (tracks.length > 0) Player.play(tracks[0], tracks, { type: 'playlist', name: playlist.name, id: id });
      }},
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const firstTrack = playlist.trackIds.map(tid => Store.getTrack(tid)).find(Boolean);
        const shareUrl = window.location.origin + '/?play=' + (firstTrack ? firstTrack.id : '');
        if (navigator.share) {
          try { await navigator.share({ url: shareUrl }); }
          catch (err) { if (err.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); }
          catch (err) { this.showToast('Share not supported'); }
        }
      }},
      { label: 'Delete', icon: Icons.trash(), action: async () => {
        this.hideContextMenu();
        if (!confirm('Delete this playlist?')) return;
        try {
          await Api.deletePlaylist(id);
          await Store.refreshPlaylists();
          if (Store.currentView === 'library') this.renderLibrary();
          else this.navigateBack();
          this.showToast('Playlist deleted');
        } catch (err) {
          console.error('Delete playlist failed:', err);
          this.showToast('Failed to delete playlist');
        }
      }}
    ], el);
  },

  _handleListItemClick(el) {
    if (el.dataset.action === 'create-playlist') { this._showCreatePlaylistInline(el); return; }
    if (el.dataset.action === 'favorites') { this.navigateTo('favorites'); return; }
    if (el.dataset.action === 'all-music') { this.navigateTo('all-music'); return; }
    if (el.dataset.action === 'needs-review') { this.navigateTo('needs-review'); return; }
    const type = el.dataset.type;
    const id = el.dataset.id;
    if (type === 'album') this.navigateTo('album', { albumId: id });
    else if (type === 'artist') this.navigateTo('artist', { artistName: id });
    else if (type === 'playlist') this.navigateTo('playlist', { playlistId: id });
  },

  navigateTo(view, data) {
    if (!this.els.nowPlaying.classList.contains('hidden')) {
      this.hideNowPlaying();
    }
    // Push current state to history before navigating
    if (Store.currentView && Store.currentView !== view) {
      this._navHistory.push({ view: Store.currentView, data: Object.assign({}, Store.viewData), tab: Store.currentTab });
    }
    Store.currentView = view;
    Store.viewData = data || {};
    this.renderPage();
    this.els.content.scrollTop = 0;
  },

  navigateBack() {
    const npVisible = !this.els.nowPlaying.classList.contains('hidden');
    if (npVisible) this.hideNowPlaying();
    if (this._navHistory.length > 0) {
      const prev = this._navHistory.pop();
      Store.currentView = prev.view;
      Store.viewData = prev.data;
      if (prev.tab) {
        Store.currentTab = prev.tab;
        document.querySelectorAll('.tab-item').forEach(t => {
          t.classList.toggle('active', t.dataset.tab === prev.tab);
        });
        this._updateTabIcons();
      }
      this._clearPollTimers();
      this.renderPage();
      this.els.content.scrollTop = 0;
      return;
    }
    if (npVisible) return;
    Store.currentView = 'home';
    Store.viewData = {};
    this._navHistory = [];
    this._clearPollTimers();
    this.renderPage();
    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === 'home');
    });
    Store.currentTab = 'home';
  },

  _clearPollTimers() {
    if (this._downloadPollTimer) { clearInterval(this._downloadPollTimer); this._downloadPollTimer = null; }
    if (this._reviewPollTimer) { clearInterval(this._reviewPollTimer); this._reviewPollTimer = null; }
    if (this._downloadPollInterval) { clearInterval(this._downloadPollInterval); this._downloadPollInterval = null; }
    if (this._reviewScrollObserver) { this._reviewScrollObserver.disconnect(); this._reviewScrollObserver = null; }
    if (this._finderStatusPoll) { clearTimeout(this._finderStatusPoll); this._finderStatusPoll = null; }
    if (this._workerPoll) { clearInterval(this._workerPoll); this._workerPoll = null; }
    if (typeof RipperV2 !== 'undefined' && RipperV2._pollTimer) { clearInterval(RipperV2._pollTimer); RipperV2._pollTimer = null; }
  },

  renderPage() {
    this._clearPollTimers();
    this.els.header.innerHTML = '';
    var self = this;
    var doRender = function() {
      try {
        switch (Store.currentView) {
          case 'home': self.renderHome(); break;
          case 'search': self.renderSearch(); break;
          case 'library': self.renderLibrary(); break;
          case 'album': self.renderAlbum(Store.viewData.albumId); break;
          case 'artist': self.renderArtist(Store.viewData.artistName); break;
          case 'playlist': self.renderPlaylist(Store.viewData.playlistId); break;
          case 'favorites': self.renderFavorites(); break;
          case 'all-music': self.renderAllMusic(); break;
          case 'needs-review': self.renderNeedsReview(); break;
          case 'finder': self.renderFinder(); break;
          case 'finder-artist': self.renderFinderArtist(Store.viewData); break;
          case 'finder-release': self.renderFinderRelease(Store.viewData); break;
          case 'ripper2': RipperV2.render(self.els.content); break;
          case 'downloads': self.renderSettings(); break;
          case 'settings': self.renderSettings(); break;
          case 'metadata-review': self.renderMetadataReview(); break;
          case 'metadata-history': self.renderMetadataHistory(); break;
          default: self.renderHome();
        }
      } catch (e) {
        console.error('renderPage error for view', Store.currentView, e);
        self.els.content.innerHTML = '<div style="padding:40px;text-align:center;color:#ff6b6b"><div style="font-size:16px;font-weight:600">Error loading page</div><div style="font-size:12px;margin-top:8px;color:#aaa">' + (e.message || e) + '</div></div>';
      }
    };
    if (document.startViewTransition) {
      self._useViewTransitions = true;
      var vt = document.startViewTransition(doRender);
      if (vt && vt.finished) {
        vt.finished.finally(function() { self._useViewTransitions = false; });
      }
    } else {
      self._useViewTransitions = false;
      doRender();
      self._fadeIn(self.els.content);
    }
  },

  async renderSearch() {
    this._viewTrackList = [];
    let html = '<div class="library-search-bar">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input" type="search" enterkeyhint="search" placeholder="Songs, artists, or albums" value="' + this._esc(this.searchQuery) + '">'
      + '</div>'
      + '<div id="search-results" style="margin-top:12px">'
      + (this.searchQuery || this.searchGenre ? '' : '<div class="loading-spinner" style="margin-top:24px"></div>')
      + '</div>';

    this.els.content.innerHTML = html;

    const input = this.els.content.querySelector('.search-input');
    if (input) {
      input.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim();
        this.searchGenre = '';
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this._renderSearchResults(), 200);
      });
    }

    if (this.searchQuery || this.searchGenre) {
      this._renderSearchResults();
      return;
    }

    // Load fresh library before rendering the genre grid so enrichment results
    // appear immediately and view-transition snapshots don't capture stale data.
    await Store.refreshLibrary();
    if (Store.currentView === 'search' && !this.searchQuery && !this.searchGenre) {
      const container = this.els.content.querySelector('#search-results');
      if (container) container.innerHTML = this._renderBrowseGrid();
    }
  },

  _renderSearchResults() {
    const container = this.els.content.querySelector('#search-results');
    if (!container) return;

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      const words = q.split(/\s+/).filter(w => w.length > 0);

      let html = '';

      const artistMatches = Store.library.artists.filter(a => {
        return a.name.toLowerCase().includes(q);
      });
      if (artistMatches.length > 0) {
        html += '<div class="search-results-header">Artists</div>';
        artistMatches.forEach(a => {
          html += '<div class="list-item lib-item" data-type="artist" data-id="' + this._esc(a.name) + '" style="cursor:pointer">'
            + '<div class="list-item-art round"><img src="' + Api.artistArtUrl(a.name) + '" alt=""></div>'
            + '<div class="list-item-info">'
            + '<div class="list-item-title">' + this._esc(a.name) + '</div>'
            + '<div class="list-item-subtitle">' + a.trackCount + ' track' + (a.trackCount !== 1 ? 's' : '') + ' · ' + a.albumCount + ' album' + (a.albumCount !== 1 ? 's' : '') + '</div>'
            + '</div></div>';
        });
        html += '<div style="height:16px"></div>';
      }

      const albumMatches = Store.library.albums.filter(a => {
        return ((a.name || '') + ' ' + (a.artist || '')).toLowerCase().includes(q);
      });
      if (albumMatches.length > 0) {
        html += '<div class="search-results-header">Albums</div>';
        albumMatches.forEach(a => {
          html += '<div class="list-item lib-item" data-type="album" data-id="' + a.id + '" style="cursor:pointer">'
            + '<div class="list-item-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
            + '<div class="list-item-info">'
            + '<div class="list-item-title">' + this._esc(a.name) + '</div>'
            + '<div class="list-item-subtitle">' + this._esc(a.artist) + '</div>'
            + '</div></div>';
        });
        html += '<div style="height:16px"></div>';
      }

      const results = Store.library.tracks.filter(t => {
        const haystack = (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.genre || '') + ' ' + (t.genreCanonical || '')).toLowerCase().replace(/[,;/]/g, ' ');
        return words.every(w => haystack.includes(w));
      }).sort((a, b) => {
        const aTitle = a.title.toLowerCase().includes(q) ? 3 : a.title.toLowerCase().split(/\s+/).some(w => words.includes(w)) ? 2 : 0;
        const bTitle = b.title.toLowerCase().includes(q) ? 3 : b.title.toLowerCase().split(/\s+/).some(w => words.includes(w)) ? 2 : 0;
        return bTitle - aTitle;
      });
      this._viewTrackList = results;

      if (artistMatches.length === 0 && albumMatches.length === 0 && results.length === 0) {
        container.innerHTML = this._emptyState('No results', 'Try different keywords', Icons.search());
      } else {
        if (results.length > 0) {
          html += '<div class="detail-actions">'
            + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
            + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
            + '</div>';
          html += '<div class="search-results-header">' + results.length + ' track' + (results.length !== 1 ? 's' : '') + '</div>';
          html += this.renderTrackList(results, { showArt: true });
        }
        container.innerHTML = html;
      }
    } else if (this.searchGenre) {
      const target = this.searchGenre.toLowerCase();
      const results = Store.library.tracks.filter(t => {
        const genre = (t.genreCanonical !== undefined ? t.genreCanonical : t.genre || '').trim();
        if (!genre) return false;
        return genre.split(/[,;/]/).some(p => p.trim().toLowerCase() === target);
      });
      this._viewTrackList = results;
      if (results.length === 0) {
        container.innerHTML = this._emptyState('No tracks in this genre', 'Try a different category', Icons.music());
      } else {
        container.innerHTML = '<div class="page-header">'
          + '<button class="back-btn genre-back">' + Icons.chevronLeft() + '</button>'
          + '<span class="page-header-title">' + this._esc(this.searchGenre) + '</span>'
          + '</div>'
          + this.renderTrackList(results, { showArt: true });
      }
    } else {
      container.innerHTML = this._renderBrowseGrid();
    }
  },

  _renderBrowseGrid() {
    const found = {};
    Store.library.tracks.forEach(t => {
      const raw = (t.genreCanonical !== undefined ? t.genreCanonical : t.genre || '').trim();
      if (!raw) return;
      raw.split(/[,;/]/).forEach(part => {
        const g = part.trim();
        if (!g) return;
        const key = g.toLowerCase();
        if (!found[key]) found[key] = g;
      });
    });
    const genres = Object.values(found).sort(() => Math.random() - 0.5);
    if (genres.length === 0) {
      return '<div class="empty-state" style="padding:24px 22px"><div class="empty-state-text">No genres found in your library</div></div>';
    }

    // Build a map of genre → list of album IDs (prefer ones with covers)
    const genreAlbums = {};
    const albumCoverMap = {};
    Store.library.albums.forEach(a => { albumCoverMap[a.id] = a.hasCover; });
    Store.library.tracks.forEach(t => {
      const raw = (t.genreCanonical !== undefined ? t.genreCanonical : t.genre || '').trim();
      if (!raw || !t.albumID) return;
      raw.split(/[,;/]/).forEach(part => {
        const g = part.trim();
        if (!g) return;
        const key = g.toLowerCase();
        if (!genreAlbums[key]) genreAlbums[key] = [];
        if (!genreAlbums[key].includes(t.albumID)) {
          genreAlbums[key].push(t.albumID);
        }
      });
    });

    // Assign one cover per genre card. Process most-constrained genres first
    // (fewest candidate albums) so single-album genres claim their only option,
    // then multi-album genres prefer covers not already shown elsewhere on the
    // grid. Falls back to any candidate when everything is taken — that's the
    // "only one song in this genre" case and repetition is unavoidable.
    const used = new Set();
    const picks = {};
    const byConstraint = genres
      .map(g => g.toLowerCase())
      .sort((a, b) => (genreAlbums[a] || []).length - (genreAlbums[b] || []).length);
    for (const key of byConstraint) {
      const albumIds = genreAlbums[key] || [];
      const withCovers = albumIds.filter(id => albumCoverMap[id]);
      const pool = (withCovers.length > 0 ? withCovers : albumIds).slice();
      // shuffle so repeated renders vary
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      // prefer an album not yet claimed by another card
      let chosen = pool.find(id => !used.has(id));
      if (chosen === undefined && pool.length > 0) {
        chosen = pool[0]; // all taken — single-album collision, reuse
      }
      if (chosen) { used.add(chosen); picks[key] = chosen; }
    }

    return '<div class="browse-grid">' + genres.map(g => {
      const key = g.toLowerCase();
      const pick = picks[key];
      let coverHtml = '';
      if (pick) {
        coverHtml = '<img src="' + Api.coverUrl(pick) + '" alt="" class="category-card-bg" onerror="this.style.display=\'none\'">';
      }
      return '<div class="category-card" data-genre="' + this._esc(g) + '">'
        + coverHtml
        + '<div class="category-card-label">' + this._esc(g) + '</div></div>';
    }).join('') + '</div>';
  },

  _timeAgo(rfc3339) {
    if (!rfc3339) return 'Never';
    const diff = Date.now() - new Date(rfc3339).getTime();
    if (diff < 0) return 'Just now';
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Just now';
    if (min < 60) return min + ' min ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' hr ago';
    return Math.floor(hr / 24) + ' days ago';
  },

  async _loadWorkers() {
    if (this._workerPoll) { clearInterval(this._workerPoll); this._workerPoll = null; }
    const container = document.getElementById('workers-list');
    if (!container) return;

    const render = async () => {
      let workers = [];
      try { workers = await Api.getWorkers(); } catch (e) { return; }
      if (!document.getElementById('workers-list')) {
        if (this._workerPoll) { clearInterval(this._workerPoll); this._workerPoll = null; }
        return;
      }

      // If the row count changed or container is empty, do a full rebuild.
      // Otherwise update existing rows in place to avoid layout shift.
      const existingRows = container.querySelectorAll('.worker-row');
      const needsFullRebuild = existingRows.length !== workers.length;

      if (needsFullRebuild) {
        // Map worker names to their setting toggle IDs and interval IDs
        const workerSettings = {
          'scanner':           { toggle: 'setting-watcher-enabled', interval: 'setting-watcher-interval', intervalLabel: 'sec' },
          'cover-fetch':       { toggle: 'setting-cover-fetch-enabled' },
          'artist-art-fetch':  { toggle: 'setting-artist-art-fetch-enabled' },
          'review':            { toggle: 'setting-review-enabled', interval: 'setting-review-recheck-hours', intervalLabel: 'hrs' },
        };

        const s = this._savedWorkerSettings || {};
        const workerEnabled = {
          'scanner': s.watcher_enabled !== false,
          'cover-fetch': s.cover_fetch_enabled !== false,
          'artist-art-fetch': s.artist_art_fetch_enabled !== false,
          'review': s.review_enabled !== false,
        };

        container.innerHTML = workers.map(w => {
          const ws = workerSettings[w.name];
          const hasToggle = !!ws;
          const toggleActive = hasToggle ? workerEnabled[w.name] : false;
          let controls = '';

          if (ws && ws.interval) {
            const intervalVal = ws.interval === 'setting-watcher-interval' ? (s.watcher_interval || '30') : (s.review_recheck_hours || '24');
            controls += '<div class="worker-controls">'
              + '<input type="text" class="settings-input worker-interval-input" id="' + ws.interval + '" value="' + this._esc(intervalVal) + '" style="width:50px;padding:4px 8px;font-size:13px;text-align:center">'
              + '<span class="worker-interval-label">' + ws.intervalLabel + '</span>'
              + '</div>';
          }

          return '<div class="worker-row" data-worker="' + this._esc(w.name) + '">'
            + '<div class="worker-status-dot"></div>'
            + (hasToggle ? '<div class="stoggle worker-toggle' + (toggleActive ? ' active' : '') + '"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div>' : '<div class="worker-toggle-spacer"></div>')
            + '<div class="worker-info">'
            + '<div class="worker-name">' + this._esc(w.name) + '</div>'
            + '<div class="worker-desc">' + this._esc(w.description) + '</div>'
            + '</div>'
            + '<div class="worker-freq">' + this._esc(w.frequency) + '</div>'
            + controls
            + '<div class="worker-last"></div>'
            + (w.canTrigger ? '<button class="settings-btn worker-run-btn"><span></span></button>' : '')
            + '</div>';
        }).join('');

        // Bind toggle clicks
        container.querySelectorAll('.worker-toggle').forEach(t => {
          t.addEventListener('click', () => t.classList.toggle('active'));
        });
      }

      // Update each row in place
      workers.forEach(w => {
        const row = container.querySelector('.worker-row[data-worker="' + this._esc(w.name) + '"]');
        if (!row) return;

        const dot = row.querySelector('.worker-status-dot');
        if (w.running) {
          dot.classList.add('running');
        } else {
          dot.classList.remove('running');
        }

        row.querySelector('.worker-last').textContent = w.running ? 'Running...' : this._timeAgo(w.lastRun);

        const btn = row.querySelector('.worker-run-btn');
        if (btn) {
          const btnSpan = btn.querySelector('span');
          if (w.running) {
            btn.disabled = true;
            btn.removeAttribute('data-worker');
            btnSpan.textContent = 'Running';
          } else if (w.canTrigger) {
            btn.disabled = false;
            btn.dataset.worker = w.name;
            btnSpan.textContent = 'Run Now';
          }
        }

        if (w.error) {
          let err = row.querySelector('.worker-error');
          if (!err) {
            err = document.createElement('div');
            err.className = 'worker-error';
            row.querySelector('.worker-info').appendChild(err);
          }
          err.textContent = w.error;
        } else {
          const err = row.querySelector('.worker-error');
          if (err) err.remove();
        }
      });

      // Bind click handlers (only on buttons that can trigger)
      container.querySelectorAll('.worker-run-btn[data-worker]').forEach(btn => {
        if (btn._bound) return;
        btn._bound = true;
        btn.addEventListener('click', async () => {
          const name = btn.dataset.worker;
          btn.disabled = true;
          btn.querySelector('span').textContent = 'Triggered';
          try { await Api.runWorker(name); } catch (e) { this.showToast('Failed to trigger worker'); }
          setTimeout(render, 500);
        });
      });
    };

    render();
    this._workerPoll = setInterval(render, 3000);
  },

  _homeLayoutDrag: { item: null, spacer: null, dragging: false, startX: 0, startY: 0, offsetY: 0, offsetX: 0, listLeft: 0 },

  renderMetadataReview() {
    this._viewTrackList = [];
    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Review Matches</span></div>';

    html += '<div class="review-actions">'
      + '<button class="settings-btn settings-btn-primary" id="btn-approve-all">' + Icons.check() + '<span>Approve All High-Confidence</span></button>'
      + '</div>';

    html += '<div id="review-list" class="review-list"><div class="loading-spinner"></div></div>';

    this.els.content.innerHTML = html;

    document.getElementById('btn-approve-all').addEventListener('click', () => this._approveAllMatches());

    this._loadReviewMatches();
  },

  async _loadReviewMatches() {
    const listEl = document.getElementById('review-list');
    if (!listEl) return;

    try {
      const matches = await Api.metadataPending();
      if (matches.length === 0) {
        listEl.innerHTML = this._emptyState('No pending matches', 'All tracks have been reviewed', Icons.checkCircle());
        return;
      }

      const grouped = {};
      matches.forEach(m => {
        if (!grouped[m.trackId]) grouped[m.trackId] = [];
        grouped[m.trackId].push(m);
      });

      let html = '';
      Object.keys(grouped).forEach(trackId => {
        const group = grouped[trackId];
        const m = group[0];
        const scorePct = Math.round(m.mbScore * 100);
        const scoreClass = scorePct >= 80 ? 'score-high' : scorePct >= 50 ? 'score-mid' : 'score-low';

        html += '<div class="review-card">'
          + '<div class="review-card-header">'
          + '<div class="review-card-local">'
          + '<div class="review-card-label">Your Track</div>'
          + '<div class="review-card-title">' + this._esc(m.trackTitle) + '</div>'
          + '<div class="review-card-artist">' + this._esc(m.trackArtist) + '</div>'
          + '</div>'
          + '<div class="review-card-arrow">' + Icons.chevronRight() + '</div>'
          + '</div>'
          + '<div class="review-card-candidates">';

        group.forEach(cand => {
          const candScorePct = Math.round(cand.mbScore * 100);
          const candScoreClass = candScorePct >= 80 ? 'score-high' : candScorePct >= 50 ? 'score-mid' : 'score-low';
          html += '<div class="review-candidate">'
            + '<div class="review-candidate-info">'
            + '<div class="review-candidate-title">' + this._esc(cand.mbTitle) + '</div>'
            + '<div class="review-candidate-artist">' + this._esc(cand.mbArtist) + '</div>'
            + '<div class="review-candidate-album">' + this._esc(cand.mbAlbum) + '</div>'
            + '<span class="review-score ' + candScoreClass + '">' + candScorePct + '%</span>'
            + '</div>'
            + '<div class="review-candidate-actions">'
            + '<button class="review-btn review-btn-approve" data-match-id="' + cand.id + '">' + Icons.check() + '</button>'
            + '<button class="review-btn review-btn-reject" data-match-id="' + cand.id + '">' + Icons.close() + '</button>'
            + '</div></div>';
        });

        html += '</div></div>';
      });

      listEl.innerHTML = html;
      this._fadeIn(listEl);

      listEl.querySelectorAll('.review-btn-approve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.matchId;
          try {
            await Api.metadataApprove(id);
            this.showToast('Match approved');
            await Store.refreshLibrary();
            this._loadReviewMatches();
          } catch (err) {
            this.showToast('Failed to approve');
          }
        });
      });

      listEl.querySelectorAll('.review-btn-reject').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.matchId;
          try {
            await Api.metadataReject(id);
            this.showToast('Match rejected');
            this._loadReviewMatches();
          } catch (err) {
            this.showToast('Failed to reject');
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = this._emptyState('Failed to load matches', 'Try again later', Icons.xCircle());
    }
  },

  async _approveAllMatches() {
    const btn = document.getElementById('btn-approve-all');
    if (!btn) return;
    btn.disabled = true;
    try {
      const result = await Api.metadataApproveAll();
      this.showToast('Approved ' + result.approved + ' matches');
      await Store.refreshLibrary();
      this._loadReviewMatches();
    } catch (err) {
      this.showToast('Failed to approve all');
    }
    btn.disabled = false;
  },

  renderMetadataHistory() {
    this._viewTrackList = [];
    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Match History</span></div>'
      + '<div class="search-container" style="margin-bottom:12px">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input" id="history-search" type="search" enterkeyhint="search" placeholder="Search by track, artist, or album...">'
      + '</div>'
      + '<div class="filter-chips">'
      + '<button class="chip active" data-hist-filter="all">All</button>'
      + '<button class="chip" data-hist-filter="approved">Approved</button>'
      + '<button class="chip" data-hist-filter="rejected">Rejected</button>'
      + '</div>'
      + '<div id="history-list"><div class="loading-spinner"></div></div>';

    this.els.content.innerHTML = html;
    this._histFilter = 'all';

    const searchInput = document.getElementById('history-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => this._filterHistory());
    }

    this.els.content.querySelectorAll('[data-hist-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.els.content.querySelectorAll('[data-hist-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._histFilter = btn.dataset.histFilter;
        this._filterHistory();
      });
    });

    this._loadHistory();
  },

  async _loadHistory() {
    const listEl = document.getElementById('history-list');
    if (!listEl) return;

    try {
      const matches = await Api.metadataAll();
      this._historyMatches = matches || [];

      if (this._historyMatches.length === 0) {
        listEl.innerHTML = this._emptyState('No matches yet', 'Run a metadata scan to see results here', Icons.search());
        return;
      }

      this._renderHistoryList(this._historyMatches);
    } catch (err) {
      listEl.innerHTML = this._emptyState('Failed to load history', 'Try again later', Icons.xCircle());
    }
  },

  _renderHistoryList(matches) {
    const listEl = document.getElementById('history-list');
    if (!listEl) return;

    if (matches.length === 0) {
      listEl.innerHTML = this._emptyState('No matches found', 'Try a different filter or search', Icons.search());
      return;
    }

    let html = '';
    matches.forEach(m => {
      const scorePct = Math.round(m.mbScore * 100);
      const statusLabel = m.status === 'approved' ? '<span class="review-score score-high">Approved</span>'
        : m.status === 'rejected' ? '<span class="review-score score-low">Rejected</span>'
        : '<span class="review-score score-mid">Pending</span>';

      html += '<div class="review-card history-item" data-status="' + m.status + '" data-search="' + this._esc(m.trackTitle + ' ' + m.trackArtist + ' ' + m.mbTitle + ' ' + m.mbArtist + ' ' + m.mbAlbum).toLowerCase() + '">'
        + '<div class="review-card-header">'
        + '<div class="review-card-local">'
        + '<div class="review-card-label">Your Track</div>'
        + '<div class="review-card-title">' + this._esc(m.trackTitle) + '</div>'
        + '<div class="review-card-artist">' + this._esc(m.trackArtist) + '</div>'
        + '</div>'
        + '<div class="review-card-arrow">' + Icons.chevronRight() + '</div>'
        + '<div class="review-card-local">'
        + '<div class="review-card-label">MusicBrainz ' + statusLabel + '</div>'
        + '<div class="review-candidate-title">' + this._esc(m.mbTitle) + '</div>'
        + '<div class="review-candidate-artist">' + this._esc(m.mbArtist) + '</div>'
        + '<div class="review-candidate-album">' + this._esc(m.mbAlbum) + '</div>'
        + '<span class="review-score ' + (scorePct >= 80 ? 'score-high' : scorePct >= 50 ? 'score-mid' : 'score-low') + '">' + scorePct + '%</span>'
        + '</div>'
        + '</div>';

      if (m.status === 'approved') {
        html += '<div class="review-candidate-actions" style="padding:8px 0">'
          + '<button class="settings-btn settings-btn-danger" style="font-size:12px;padding:6px 12px" data-undo-id="' + m.id + '">Undo Match</button>'
          + '</div>';
      }

      html += '</div>';
    });

    listEl.innerHTML = html;
    this._fadeIn(listEl);
    this._filterHistory();

    listEl.querySelectorAll('[data-undo-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.undoId;
        btn.disabled = true;
        try {
          await Api.metadataUndo(id);
          this.showToast('Match undone — will be re-evaluated on next scan');
          await Store.refreshLibrary();
          this._loadHistory();
        } catch (err) {
          this.showToast('Failed to undo match');
        }
      });
    });
  },

  _filterHistory() {
    const listEl = document.getElementById('history-list');
    if (!listEl) return;

    const searchInput = document.getElementById('history-search');
    const q = searchInput ? searchInput.value.trim().toLowerCase() : '';

    listEl.querySelectorAll('.history-item').forEach(el => {
      const status = el.dataset.status;
      const searchData = el.dataset.search || '';

      const statusMatch = this._histFilter === 'all' || status === this._histFilter;
      const searchMatch = !q || searchData.includes(q);

      el.style.display = (statusMatch && searchMatch) ? '' : 'none';
    });
  },

  _uniqueAlbums(tracks) {
    const seen = new Set();
    const result = [];
    for (let i = 0; i < tracks.length; i++) {
      const aid = tracks[i].albumID;
      if (!seen.has(aid)) {
        seen.add(aid);
        const album = Store.getAlbum(aid);
        if (album) result.push(album);
      }
    }
    return result;
  },

  _smartPlay(track) {
    const existingIdx = Player.queue.findIndex(t => t.id === track.id);
    if (existingIdx !== -1) {
      Player.playInQueue(existingIdx);
      return;
    }
    const viewList = this._viewTrackList;
    if (viewList.length > 1) {
      const source = this._getViewSource();
      Player.play(track, viewList, source);
    } else {
      Player.play(track, null, null);
    }
  },

  _getViewSource() {
    const view = Store.currentView;
    const data = Store.viewData || {};
    if (view === 'album' && data.albumId) {
      const album = Store.getAlbum(data.albumId);
      return { type: 'album', name: album ? album.name : 'Album', id: data.albumId };
    }
    if (view === 'artist' && data.artistName) {
      return { type: 'artist', name: data.artistName };
    }
    if (view === 'playlist' && data.playlistId) {
      const pl = Store.getPlaylist(data.playlistId);
      return { type: 'playlist', name: pl ? pl.name : 'Playlist', id: data.playlistId };
    }
    if (view === 'favorites') {
      return { type: 'favorites', name: 'Favorites' };
    }
    if (view === 'all-music') {
      return { type: 'all', name: 'All Music' };
    }
    if (view === 'search') {
      return { type: 'search', name: 'Search Results' };
    }
    return null;
  },

  _escDiv: null,
  _esc(str) {
    if (!str) return '';
    if (!this._escDiv) this._escDiv = document.createElement('div');
    this._escDiv.textContent = String(str);
    return this._escDiv.innerHTML.replace(/"/g, '&quot;');
  },

  _trackTitle(track) {
    if (!track) return '';
    if (track.title && track.title !== 'Unknown') return track.title;
    if (track.filePath) {
      const parts = track.filePath.split('/');
      const name = parts[parts.length - 1];
      return name.replace(/\.[^.]+$/, '');
    }
    return track.title || '';
  },

  _trackArtist(track) {
    if (!track) return '';
    if (track.artist && track.artist !== 'Unknown') return track.artist;
    return '';
  },

  _getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning.';
    if (h < 17) return 'Good afternoon.';
    return 'Good evening.';
  },

  _formatTime(secs) {
    if (!secs || !isFinite(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  },

  _emptyState(title, text, iconSvg) {
    return '<div class="empty-state">'
      + (iconSvg || '')
      + '<div class="empty-state-title">' + title + '</div>'
      + (text ? '<div class="empty-state-text">' + text + '</div>' : '')
      + '</div>';
  },

  _strEq(a, b) {
    return a && b && a.toLowerCase().trim() === b.toLowerCase().trim();
  },

  _isQueued(artist, title) {
    if (!this._downloadJobs) return false;
    return this._downloadJobs.some(j =>
      j.status !== 'completed' && j.status !== 'failed' &&
      this._strEq(j.artist, artist) && this._strEq(j.title, title)
    );
  },

  _stableHash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  }
};

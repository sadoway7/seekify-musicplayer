const UI = {
  els: {},
  seeking: false,
  volumeDragging: false,
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

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  },

  _colorAlpha(color, alpha) {
    if (color.startsWith('rgba')) {
      return color.replace(/,\s*[\d.]+\)$/, ', ' + alpha + ')');
    }
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    if (color.startsWith('rgb(')) {
      return color.replace('rgb(', 'rgba(').replace(')', ', ' + alpha + ')');
    }
    return color;
  },

  init() {
    this._cacheDom();
    this._bindTabBar();
    this._bindMiniPlayer();
    this._bindNowPlaying();
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
    this._bindResize();
    this._bindQueueSwipe();
    this._bindQueueDrag();
    this._pollDownloadBadge();
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

    let prevVolume = 1;
    this.els.volumeBtn.addEventListener('click', () => {
      if (Player.volume > 0) {
        prevVolume = Player.volume;
        Player.setVolume(0);
      } else {
        Player.setVolume(prevVolume || 1);
      }
      this._updateVolumeBar();
    });

    if (this.els.queueVolumeBtn) {
      this.els.queueVolumeBtn.addEventListener('click', () => {
        if (Player.volume > 0) {
          prevVolume = Player.volume;
          Player.setVolume(0);
        } else {
          Player.setVolume(prevVolume || 1);
        }
        this._updateVolumeBar();
      });
    }
  },

  _bindSeekBar() {
    const canvas = this.els.waveformCanvas;
    if (!canvas) return;

    this._waveformData = [];
    this._waveformHoverX = -1;

    const getFraction = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

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

    canvas.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);

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

    const getFraction = (e) => {
      const rect = bar.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

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

      const getFraction = (e) => {
        const rect = bar.getBoundingClientRect();
        if (rect.width === 0) return Player.volume;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      };

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
    let prevVolume = 0.5;
    this.els.miniVolumeBtn.addEventListener('click', () => {
      if (Player.volume > 0) {
        prevVolume = Player.volume;
        Player.setVolume(0);
      } else {
        Player.setVolume(prevVolume || 0.5);
      }
      this._updateVolumeBar();
    });

    // Drag bar — independent state, keeps wrap active during drag
    const bar = this.els.miniVolumeBar;
    const self = this;
    if (bar) {
      let dragging = false;

      const getFrac = (e) => {
        const rect = bar.getBoundingClientRect();
        if (rect.width === 0) return Player.volume;
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        return Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
      };

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
        e.target.classList.add('hidden');
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
    this.els.content.addEventListener('click', (e) => {
      const genreBack = e.target.closest('.genre-back');
      if (genreBack) {
        this.searchGenre = '';
        this._renderSearchResults();
        return;
      }

      const backBtn = e.target.closest('.back-btn');
      if (backBtn) {
        this.navigateBack();
        return;
      }

      const seg = e.target.closest('.lib-tab[data-filter]');
      if (seg) {
        this.libFilter = seg.dataset.filter;
        this.renderLibrary();
        return;
      }

      const tmore = e.target.closest('.track-more');
        if (tmore) {
          const row = tmore.closest('.track-row');
        if (row) {
          this._showTrackContextMenu(row.dataset.trackId, tmore);
        }
        return;
      }

      const rmore = e.target.closest('.track-review-more');
      if (rmore) {
        const trackId = rmore.dataset.reviewTrackId;
        if (trackId) {
          this._showReviewTrackMenu(trackId, rmore);
        }
        return;
      }

      const trow = e.target.closest('.track-row') || e.target.closest('.new-song-card');
      if (trow) {
        const trackId = trow.dataset.trackId;
        const track = Store.getTrack(trackId);
        if (track) {
          const favSection = trow.closest('[data-home-section="favorites"]');
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
        }
        return;
      }

      const apill = e.target.closest('[data-type="artist"]');
      if (apill) {
        const type = apill.dataset.type;
        const id = apill.dataset.id;
        if (type === 'artist') this.navigateTo('artist', { artistName: id });
        return;
      }

      const acard = e.target.closest('.card[data-album-id]');
      if (acard) {
        this.navigateTo('album', { albumId: acard.dataset.albumId });
        return;
      }

      const qpCard = e.target.closest('.quick-play-card, .quick-play-card-inline');
      if (qpCard) {
        if (qpCard.dataset.navigate) {
          this.navigateTo(qpCard.dataset.navigate);
          return;
        }
        if (qpCard.dataset.action) {
          this._handleAction(qpCard.dataset.action);
          return;
        }
        if (qpCard.dataset.trackId) {
          const track = Store.getTrack(qpCard.dataset.trackId);
          if (track) {
            if (qpCard.classList.contains('quick-play-card-recent')) {
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
        if (qpCard.dataset.albumId) {
          this.navigateTo('album', { albumId: qpCard.dataset.albumId });
          return;
        }
        return;
      }

      const catCard = e.target.closest('.category-card');
      if (catCard) {
        this.searchGenre = catCard.dataset.genre;
        this.searchQuery = '';
        this._renderSearchResults();
        return;
      }

      const playAllBtn = e.target.closest('.play-all-btn');
      if (playAllBtn) {
        if (this._viewTrackList.length > 0) {
          const source = this._getViewSource();
          Player.play(this._viewTrackList[0], this._viewTrackList, source);
        }
        return;
      }

      const detailPlayBtn = e.target.closest('.detail-play-btn');
      if (detailPlayBtn) {
        if (this._viewTrackList.length > 0) {
          const source = this._getViewSource();
          Player.play(this._viewTrackList[0], this._viewTrackList, source);
          this.showNowPlaying();
        }
        return;
      }

      const ripMoreBtn = e.target.closest('[data-action="rip-more"]');
      if (ripMoreBtn) {
        const artistName = ripMoreBtn.dataset.artist;
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
          this.showToast('Failed to search MusicBrainz');
        });
        return;
      }

      const actionBtn = e.target.closest('.detail-action-btn, .home-review-card');
      if (actionBtn) {
        this._handleAction(actionBtn.dataset.action);
        return;
      }

      const heroActionBtn = e.target.closest('.hero-action-btn');
      if (heroActionBtn) {
        const action = heroActionBtn.dataset.heroAction;
        if (action === 'more-artist') {
          const artistName = heroActionBtn.dataset.artist;
          this._showArtistContextMenu(artistName, heroActionBtn);
        } else if (action === 'more-album') {
          const albumId = heroActionBtn.dataset.albumId;
          this._showAlbumContextMenu(albumId, heroActionBtn);
        } else if (action === 'more-playlist') {
          const playlistId = heroActionBtn.dataset.playlistId;
          this._showPlaylistContextMenu(playlistId, heroActionBtn);
        }
        return;
      }

      const headerLink = e.target.closest('.section-header-link');
      if (headerLink) {
        const target = headerLink.dataset.navigate;
        if (target) this.navigateTo(target);
        return;
      }

      const plmore = e.target.closest('.list-item-more');
      if (plmore) {
        const plrow = plmore.closest('.list-item');
        if (plrow) {
          const type = plrow.dataset.type;
          const id = plrow.dataset.id;
          if (type === 'playlist') {
            const playlist = Store.getPlaylist(id);
            if (playlist) {
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
                    try {
                      await navigator.share({ url: shareUrl });
                    } catch (err) {
                      if (err.name !== 'AbortError') this.showToast('Share failed');
                    }
                  } else {
                    try {
                      await navigator.clipboard.writeText(shareUrl);
                      this.showToast('Link copied');
                    } catch (err) {
                      this.showToast('Share not supported');
                    }
                  }
                }},
                { label: 'Delete', icon: Icons.trash(), action: async () => {
                  this.hideContextMenu();
                  if (!confirm('Delete this playlist?')) return;
                  try {
                    await Api.deletePlaylist(id);
                    await Store.refreshPlaylists();
                    if (Store.currentView === 'library') {
                      this.renderLibrary();
                    } else {
                      this.navigateBack();
                    }
                    this.showToast('Playlist deleted');
                  } catch (err) {
                    console.error('Delete playlist failed:', err);
                    this.showToast('Failed to delete playlist');
                  }
                }}
              ], plmore);
            }
          }
        }
        return;
      }

      const plrow = e.target.closest('.list-item');
      if (plrow) {
        if (plrow.dataset.action === 'create-playlist') {
          this._showCreatePlaylistInline(plrow);
          return;
        }
        if (plrow.dataset.action === 'favorites') {
          this.navigateTo('favorites');
          return;
        }
        if (plrow.dataset.action === 'all-music') {
          this.navigateTo('all-music');
          return;
        }
        if (plrow.dataset.action === 'needs-review') {
          this.navigateTo('needs-review');
          return;
        }
        const type = plrow.dataset.type;
        const id = plrow.dataset.id;
        if (type === 'album') this.navigateTo('album', { albumId: id });
        else if (type === 'artist') this.navigateTo('artist', { artistName: id });
        else if (type === 'playlist') this.navigateTo('playlist', { playlistId: id });
        return;
      }

      const showMore = e.target.closest('.show-more-btn');
      if (showMore) {
        if (showMore.dataset.action === 'show-more-new') {
          this._newSongsLimit = (this._newSongsLimit || 6) + 12;
          this.renderHome();
        }
        return;
      }
    });
  },

  navigateTo(view, data) {
    if (!this.els.nowPlaying.classList.contains('hidden')) {
      this.hideNowPlaying();
    }
    // Push current state to history before navigating
    if (Store.currentView && Store.currentView !== view) {
      this._navHistory.push({ view: Store.currentView, data: Object.assign({}, Store.viewData) });
    }
    Store.currentView = view;
    Store.viewData = data || {};
    this.renderPage();
    this.els.content.scrollTop = 0;
  },

  navigateBack() {
    if (!this.els.nowPlaying.classList.contains('hidden')) {
      this.hideNowPlaying();
      if (this._navHistory.length > 0) {
        const prev = this._navHistory.pop();
        Store.currentView = prev.view;
        Store.viewData = prev.data;
        this._clearPollTimers();
        this.renderPage();
        this.els.content.scrollTop = 0;
      }
      return;
    }
    if (this._navHistory.length > 0) {
      const prev = this._navHistory.pop();
      Store.currentView = prev.view;
      Store.viewData = prev.data;
      this._clearPollTimers();
      this.renderPage();
      this.els.content.scrollTop = 0;
      return;
    }
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
  },

  renderPage() {
    this._clearPollTimers();
    this.els.header.innerHTML = '';
    switch (Store.currentView) {
      case 'home': this.renderHome(); break;
      case 'search': this.renderSearch(); break;
      case 'library': this.renderLibrary(); break;
      case 'album': this.renderAlbum(Store.viewData.albumId); break;
      case 'artist': this.renderArtist(Store.viewData.artistName); break;
      case 'playlist': this.renderPlaylist(Store.viewData.playlistId); break;
      case 'favorites': this.renderFavorites(); break;
      case 'all-music': this.renderAllMusic(); break;
      case 'needs-review': this.renderNeedsReview(); break;
      case 'finder': this.renderFinder(); break;
      case 'finder-artist': this.renderFinderArtist(Store.viewData); break;
      case 'finder-release': this.renderFinderRelease(Store.viewData); break;
      case 'ripper2': RipperV2.render(this.els.content); break;
      case 'downloads': this.renderSettings(); break;
      case 'settings': this.renderSettings(); break;
      case 'metadata-review': this.renderMetadataReview(); break;
      case 'metadata-history': this.renderMetadataHistory(); break;
      default: this.renderHome();
    }
  },

  renderHome() {
    this._viewTrackList = [];
    this._renderHomeContent();

    let homeRenderPending = false;
    const scheduleHomeRender = () => {
      if (!homeRenderPending) {
        homeRenderPending = true;
        requestAnimationFrame(() => {
          homeRenderPending = false;
          if (Store.currentView === 'home') this._renderHomeContent();
        });
      }
    };

    Store.refreshLibrary().then(scheduleHomeRender);
    Store.refreshRecent().then(scheduleHomeRender);
    Api.getReviewCounts().then(counts => {
      Store.reviewCounts = counts;
      scheduleHomeRender();
    }).catch(() => {});
  },

  _renderHomeContent() {
    let html = '';

    html += '<div class="home-top-row">'
      + '<div class="home-menu-wrap" id="home-menu-wrap">'
      + '<button class="home-menu-btn" id="home-menu-btn" aria-label="Menu"><span class="hm-icon"><span class="hm-bar"></span><span class="hm-bar"></span><span class="hm-bar"></span></span></button>'
      + '<div class="home-menu-dropdown" id="home-menu-dropdown">'
      + '<div class="home-menu-label">Options</div>'
      + '<div class="home-menu-item" data-action="homepage-layout">' + Icons.grid() + '<span>Home Layout</span></div>'
      + '<div class="home-menu-divider"></div>'
      + '<div class="home-menu-item" data-action="settings">' + Icons.settings() + '<span>Settings</span></div>'
      + '</div>'
      + '</div>'
      + '<div class="home-search-bar" id="home-search-bar">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input" type="text" placeholder="" readonly>'
      + '</div>'
      + '</div>';

    const layout = Store.getHomeLayout();
    const sectionRenderers = {
      'recent': () => this._homeRecent(),
      'artists': () => this._homeArtists(),
      'albums': () => this._homeAlbums(),
      'new-songs': () => this._homeNewSongs(),
      'playlists': () => this._homePlaylists(),
      'needs-review': () => this._homeNeedsReview(),
      'favorites': () => this._homeFavorites()
    };

    const sections = [];
    layout.forEach(s => {
      if (!s.enabled) return;
      const renderer = sectionRenderers[s.id];
      if (!renderer) return;
      const rendered = renderer();
      if (rendered) sections.push(rendered);
    });

    html += sections.join('');

    if (Store.library.tracks.length === 0) {
      html += this._emptyState('No music yet', 'Add music files and rescan to get started', Icons.music());
    }

    this.els.content.innerHTML = html;

    this._bindHomeEvents();
  },

  _homeRecent() {
    const recentTracks = Store.recent.map(id => Store.getTrack(id)).filter(Boolean);
    const currentTrack = Player.getCurrentTrack();

    const recentCards = [];
    const seenTracks = new Set();
    recentTracks.forEach(t => {
      if (!seenTracks.has(t.id)) {
        seenTracks.add(t.id);
        recentCards.push({ type: 'track', name: this._trackTitle(t), id: t.id, albumID: t.albumID });
      }
    });

    if (recentCards.length === 0 && !currentTrack) return '';

    let html = '';
    html += '<div class="quick-play-grid" style="margin-top:24px">';

    html += '<div class="quick-play-card quick-play-card-shuffle" data-action="shuffle-all">'
      + '<div class="quick-play-art" style="background:linear-gradient(135deg, #ffffff, #f5f5f5);display:flex;align-items:center;justify-content:center;box-shadow:inset 6px 6px 8px rgba(255,255,255,0.75), inset -8px -8px 12px rgba(0,0,0,0.4), inset 0 0 18px rgba(0,0,0,0.15), 0 8px 16px rgba(0,0,0,0.5)">'
      + '<svg viewBox="0 0 100 100" width="100%" height="100%">'
      + '<circle cx="25" cy="25" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="75" cy="25" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="50" cy="50" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="25" cy="75" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '<circle cx="75" cy="75" r="9" fill="rgba(168,200,48,0.85)"/>'
      + '</svg>'
      + '<div style="position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:14px;overflow:hidden"><span style="font-family:Arial Black,Gadget,sans-serif;font-size:clamp(14px, 4vw, 28px);font-weight:900;color:rgba(0,0,0,0.9);letter-spacing:-0.06em;display:block;white-space:nowrap;filter:drop-shadow(0 0 4px rgba(255,255,255,1)) drop-shadow(0 0 10px rgba(255,255,255,0.9)) drop-shadow(0 0 20px rgba(255,255,255,0.7)) drop-shadow(0 0 40px rgba(255,255,255,0.5)) drop-shadow(0 0 60px rgba(255,255,255,0.3));display:none">SHUFFLED</span></div>'
      + '</div>'
      + '</div>';

    const cols = window.innerWidth >= 1024 ? 5 : window.innerWidth >= 768 ? 4 : 3;
    const maxRecent = window.innerWidth >= 768 ? 12 : 7;
    let addedRecent = 0;
    recentCards.forEach(c => {
      if (addedRecent >= maxRecent) return;
      addedRecent++;
      const isNowPlaying = currentTrack && c.id === currentTrack.id;
      const artInner = '<img src="' + Api.coverUrl(c.albumID || c.id) + '" alt="">';
      const nowPlayingBadge = isNowPlaying
        ? '<div class="quick-play-playing"><div class="eq"><div class="eqb" style="height:5px"></div><div class="eqb" style="height:11px"></div><div class="eqb" style="height:7px"></div></div></div>'
        : '';
      const cardClass = isNowPlaying ? ' quick-play-card-now' : '';
      html += '<div class="quick-play-card quick-play-card-recent' + cardClass + '" data-track-id="' + c.id + '" data-album-id="' + (c.albumID || c.id) + '">'
        + '<div class="quick-play-art">' + artInner + nowPlayingBadge + '</div>'
        + '<div class="quick-play-title">' + this._esc(c.name) + '</div>'
        + '</div>';
    });

    html += '<div class="quick-play-card quick-play-card-all" data-action="shuffle-recent">'
      + '<div class="quick-play-art" style="background:#0d0d0d;display:flex;align-items:center;justify-content:center">'
      + '<div style="position:absolute;bottom:0;left:0;right:0;height:55%;background:linear-gradient(175deg, rgba(220,50,80,0.35), rgba(50,100,220,0.25));pointer-events:none"></div>'
      + '<div style="position:absolute;top:-4px;right:-10px;width:40px;height:40px;background:rgba(220,50,80,0.6);border-radius:50%;pointer-events:none"></div>'
      + '<div style="position:absolute;bottom:28px;left:-6px;width:24px;height:24px;background:rgba(50,140,220,0.5);pointer-events:none"></div>'
      + '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden"><span style="font-family:Impact,Haettenschweiler,Arial Black,sans-serif;font-size:100px;font-weight:900;color:rgba(255,255,255,0.35);transform:rotate(-10deg);line-height:0.85;letter-spacing:-0.04em;display:block;margin-top:-8px;-webkit-text-stroke:1px rgba(255,255,255,0.08)">100</span></div></div>'
      + '<div class="quick-play-title" style="background:none;padding-top:38px;font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.7);line-height:1.3;white-space:normal">Recently<br>Added</div>'
      + '</div>';

    html += '</div>';
    return html;
  },

  _homeArtists() {
    const namedArtists = Store.library.artists.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    const artistLimit = window.innerWidth >= 768 ? 10 : 6;
    const newArtists = namedArtists.sort(() => Math.random() - 0.5).slice(0, artistLimit);
    if (newArtists.length === 0) return '';
    let html = '<div class="mega-title"><span>Artists</span></div>';
    html += '<div class="scroll-row artist-row">';
    newArtists.forEach(a => {
      html += '<div class="quick-play-card-inline artist-pill" data-type="artist" data-id="' + this._esc(a.name) + '">'
        + '<div class="quick-play-art"><img src="' + Api.artistArtUrl(a.name) + '" alt=""></div>'
        + '<div class="quick-play-title">' + this._esc(a.name) + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  _homeAlbums() {
    const namedAlbums = Store.library.albums.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    if (namedAlbums.length === 0) return '';
    let html = '<div class="mega-title"><span>Albums</span></div>';
    const shuffledAlbums = namedAlbums.sort(() => Math.random() - 0.5).slice(0, 15);
    html += '<div class="scroll-row">';
    shuffledAlbums.forEach(a => {
      html += '<div class="card" data-album-id="' + a.id + '">'
        + '<div class="card-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
        + '<div class="card-title">' + this._esc(a.name) + '</div>'
        + '<div class="card-subtitle">' + this._esc(a.artist) + '</div>'
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  _homeNewSongs() {
    const allTracks = Store.library.tracks.slice();
    const sortedNew = allTracks.filter(t => t.artist && t.artist !== '').sort((a, b) => (b.modTime || 0) - (a.modTime || 0));
    const newLimit = this._newSongsLimit || 6;
    const newTracks = sortedNew.slice(0, newLimit);
    if (newTracks.length === 0) return '';
    let html = '<div class="mega-title"><span>New Songs</span></div>';
    html += this.renderTrackList(newTracks, { showArt: true });
    if (sortedNew.length > newLimit) {
      html += '<button class="btn-text show-more-btn" data-action="show-more-new">Show more</button>';
    }
    return html;
  },

  _homePlaylists() {
    if (Store.playlists.length === 0) return '';
    let html = '<div class="mega-title"><span>Playlists</span></div>';
    Store.playlists.slice(0, 4).forEach(p => {
      const pTracks = p.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
      const firstTrack = pTracks[0];
      const artStyle = firstTrack && firstTrack.albumID
        ? 'background-image:url(' + Api.coverUrl(firstTrack.albumID) + ');background-size:cover;background-position:center'
        : 'background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)';
      const artContent = firstTrack && firstTrack.albumID ? '' : Icons.music();
      html += '<div class="list-item" data-type="playlist" data-id="' + p.id + '">'
        + '<div class="list-item-art" style="' + artStyle + '">' + artContent + '</div>'
        + '<div class="list-item-info">'
        + '<div class="list-item-title">' + this._esc(p.name) + '</div>'
        + '<div class="list-item-subtitle">' + pTracks.length + ' tracks</div>'
        + '</div></div>';
    });
    return html;
  },

  _homeNeedsReview() {
    const reviewCount = Store.reviewCounts.needs_review || 0;
    if (reviewCount === 0) return '';
    let html = '<div class="home-review-card" data-action="needs-review">'
      + '<div class="home-review-icon">' + Icons.warning() + '</div>'
      + '<div class="home-review-info">'
      + '<div class="home-review-title"><span class="home-review-count">' + reviewCount + '</span> For Review</div>'
      + '</div>'
      + '<div class="home-review-arrow">' + Icons.chevronRight() + '</div>'
      + '</div>';
    return html;
  },

  _homeFavorites() {
    const favTracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
    if (favTracks.length === 0) return '';
    const limit = window.innerWidth >= 768 ? 10 : 5;
    let html = '<div class="mega-title"><span>Favorites</span></div>';
    html += '<div class="home-fav-grid" data-home-section="favorites">';
    html += this.renderTrackList(favTracks.slice(0, limit), { showArt: true });
    html += '</div>';
    return html;
  },

  _bindHomeEvents() {
    const homeSearch = document.getElementById('home-search-bar');
    if (homeSearch) {
      homeSearch.addEventListener('click', () => {
        Store.currentView = 'search';
        Store.viewData = {};
        document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
        const searchTab = document.querySelector('[data-tab="search"]');
        if (searchTab) searchTab.classList.add('active');
        this.renderSearch();
        const input = this.els.content.querySelector('.search-input');
        if (input) input.focus();
      });
    }

    const menuBtn = document.getElementById('home-menu-btn');
    const menuDropdown = document.getElementById('home-menu-dropdown');
    if (menuBtn && menuDropdown) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle('open');
      });
      document.addEventListener('click', () => {
        menuDropdown.classList.remove('open');
      });
      menuDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.home-menu-item');
        if (!item) return;
        menuDropdown.classList.remove('open');
        const action = item.dataset.action;
        if (action === 'rescan') {
          this._rescanLibrary();
        } else if (action === 'settings') {
          Store.currentView = 'settings';
          Store.viewData = {};
          document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
          const settingsTab = document.querySelector('[data-tab="settings"]');
          if (settingsTab) settingsTab.classList.add('active');
          this.renderSettings();
        } else if (action === 'homepage-layout') {
          this._openHomepageLayoutModal();
        }
      });
    }
  },

  renderSearch() {
    this._viewTrackList = [];
    let html = '<div class="library-search-bar">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input" type="text" placeholder="Songs, artists, or albums" value="' + this._esc(this.searchQuery) + '">'
      + '</div>'
      + '<div id="search-results" style="margin-top:12px"></div>';

    if (!this.searchQuery && !this.searchGenre) {
      html += this._renderBrowseGrid();
    }

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

      const results = Store.library.tracks.filter(t => {
        const haystack = (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.genre || '')).toLowerCase();
        return words.every(w => haystack.includes(w));
      }).sort((a, b) => {
        const aTitle = a.title.toLowerCase().includes(q) ? 3 : a.title.toLowerCase().split(/\s+/).some(w => words.includes(w)) ? 2 : 0;
        const bTitle = b.title.toLowerCase().includes(q) ? 3 : b.title.toLowerCase().split(/\s+/).some(w => words.includes(w)) ? 2 : 0;
        return bTitle - aTitle;
      });
      this._viewTrackList = results;

      if (artistMatches.length === 0 && results.length === 0) {
        container.innerHTML = this._emptyState('No results', 'Try different keywords', Icons.search());
      } else {
        html += '<div class="detail-actions">'
          + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
          + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
          + '</div>';
        html += '<div class="search-results-header">' + results.length + ' track' + (results.length !== 1 ? 's' : '') + '</div>';
        html += this.renderTrackList(results, { showArt: true });
        container.innerHTML = html;
      }
    } else if (this.searchGenre) {
      const results = Store.library.tracks.filter(t =>
        t.genre && t.genre.toLowerCase() === this.searchGenre.toLowerCase()
      );
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
      container.innerHTML = '';
    }
  },

  _renderBrowseGrid() {
    const found = {};
    Store.library.tracks.forEach(t => {
      if (t.genre && t.genre.trim()) {
        const key = t.genre.trim().toLowerCase();
        if (!found[key]) found[key] = t.genre.trim();
      }
    });
    const genres = Object.values(found).sort(() => Math.random() - 0.5);
    if (genres.length === 0) return '';

    // Build a map of genre → list of album IDs (prefer ones with covers)
    const genreAlbums = {};
    const albumCoverMap = {};
    Store.library.albums.forEach(a => { albumCoverMap[a.id] = a.hasCover; });
    Store.library.tracks.forEach(t => {
      if (t.genre && t.genre.trim() && t.albumID) {
        const key = t.genre.trim().toLowerCase();
        if (!genreAlbums[key]) genreAlbums[key] = [];
        if (!genreAlbums[key].includes(t.albumID)) {
          genreAlbums[key].push(t.albumID);
        }
      }
    });

    return '<div class="browse-grid">' + genres.map(g => {
      const key = g.toLowerCase();
      const albumIds = genreAlbums[key] || [];
      // Pick a random album that has a cover, fall back to any
      const withCovers = albumIds.filter(id => albumCoverMap[id]);
      const pick = withCovers.length > 0
        ? withCovers[Math.floor(Math.random() * withCovers.length)]
        : (albumIds.length > 0 ? albumIds[Math.floor(Math.random() * albumIds.length)] : null);
      let coverHtml = '';
      if (pick) {
        coverHtml = '<img src="' + Api.coverUrl(pick) + '" alt="" class="category-card-bg" onerror="this.style.display=\'none\'">';
      }
      return '<div class="category-card" data-genre="' + this._esc(g) + '">'
        + coverHtml
        + '<div class="category-card-label">' + this._esc(g) + '</div></div>';
    }).join('') + '</div>';
  },

  renderLibrary() {
    this._viewTrackList = [];
    let html = '<div class="lib-sticky-header">'
      + '<div class="lib-tabs">'
      + '<button class="lib-tab' + (this.libFilter === 'playlists' ? ' active' : '') + '" data-filter="playlists">Playlists</button>'
      + '<button class="lib-tab' + (this.libFilter === 'albums' ? ' active' : '') + '" data-filter="albums">Albums</button>'
      + '<button class="lib-tab' + (this.libFilter === 'artists' ? ' active' : '') + '" data-filter="artists">Artists</button>'
      + '</div>'
      + '<div class="lib-search-row">'
      + '<div class="search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input lib-search-input" type="text" placeholder="">'
      + '</div>'
      + '<button class="lib-upload-btn" id="lib-upload-btn" aria-label="Upload music">' + Icons.upload() + '</button>'
      + '</div>'
      + '<div class="lib-results">';

    switch (this.libFilter) {
      case 'playlists': html += this._renderLibPlaylists(); break;
      case 'albums': html += this._renderLibAlbums(); break;
      case 'artists': html += this._renderLibArtists(); break;
    }

    html += '</div>';

    this.els.content.innerHTML = html;

    Store.refreshLibrary().then(() => {
      if (Store.currentView === 'library') {
        const results = this.els.content.querySelector('.lib-results');
        if (results) {
          switch (this.libFilter) {
            case 'playlists': results.innerHTML = this._renderLibPlaylists(); break;
            case 'albums': results.innerHTML = this._renderLibAlbums(); break;
            case 'artists': results.innerHTML = this._renderLibArtists(); break;
          }
        }
      }
    });
    Store.refreshPlaylists().then(() => {
      if (Store.currentView === 'library' && this.libFilter === 'playlists') {
        const results = this.els.content.querySelector('.lib-results');
        if (results) results.innerHTML = this._renderLibPlaylists();
      }
    });

    const searchInput = this.els.content.querySelector('.lib-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (q.length >= 2) {
          this._filterLibResults(q);
        } else {
          this._filterLibResults('');
        }
      });
    }

    const uploadBtn = this.els.content.querySelector('#lib-upload-btn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => this.openUploadModal());
    }
  },

  openUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (!modal) return;
    if (!this._uploadInit) {
      this._initUploadModal();
      this._uploadInit = true;
    }
    this._uploadSelected = [];
    this._uploadPreviewTracks = null;
    this._uploadCustomCover = null;
    this._uploadAddedTracks = [];
    this._uploadStep = 'select';
    const fi = document.getElementById('upload-file-input');
    const fo = document.getElementById('upload-folder-input');
    if (fi) fi.value = '';
    if (fo) fo.value = '';
    const preview = document.getElementById('upload-preview-area');
    if (preview) preview.innerHTML = '';
    this._setUploadTab('file');
    this._setUploadStep('select');
    modal.classList.remove('hidden');
  },

  closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    if (modal) modal.classList.add('hidden');
  },

  _initUploadModal() {
    const fileIcon = document.getElementById('upload-file-icon');
    const folderIcon = document.getElementById('upload-folder-icon');
    if (fileIcon) fileIcon.innerHTML = Icons.upload();
    if (folderIcon) folderIcon.innerHTML = Icons.folder();

    const closeBtn = document.getElementById('upload-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeUploadModal());

    const overlay = document.getElementById('upload-modal');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay && this._uploadStep !== 'progress') this.closeUploadModal();
      });
    }

    document.querySelectorAll('.upload-modal-tab').forEach((t) => {
      t.addEventListener('click', () => this._setUploadTab(t.dataset.utab));
    });

    const fileBtn = document.getElementById('upload-file-btn');
    const fileInput = document.getElementById('upload-file-input');
    if (fileBtn && fileInput) {
      fileBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => this._setUploadFiles(e.target.files));
    }

    const folderBtn = document.getElementById('upload-folder-btn');
    const folderInput = document.getElementById('upload-folder-input');
    if (folderBtn && folderInput) {
      folderBtn.addEventListener('click', () => folderInput.click());
      folderInput.addEventListener('change', (e) => this._setUploadFiles(e.target.files));
    }

    const coverInput = document.getElementById('upload-cover-input');
    if (coverInput) {
      coverInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        this._uploadCustomCover = file;
        const objUrl = URL.createObjectURL(file);
        let img = document.getElementById('upload-cover-img');
        if (!img) {
          const ph = document.getElementById('upload-cover-placeholder');
          if (ph) {
            img = document.createElement('img');
            img.className = 'upload-cover-img';
            img.id = 'upload-cover-img';
            ph.parentNode.replaceChild(img, ph);
          }
        }
        if (img) img.src = objUrl;
        coverInput.value = '';
        const hint = document.querySelector('.upload-cover-hint');
        if (hint) {
          hint.textContent = 'Cover selected';
          hint.classList.add('upload-cover-set');
          setTimeout(() => { hint.classList.remove('upload-cover-set'); }, 2000);
        }
      });
    }
  },

  _setUploadTab(tab) {
    document.querySelectorAll('.upload-modal-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.utab === tab);
    });
    document.querySelectorAll('.upload-modal-panel').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.utab !== tab);
    });
    this._uploadSelected = [];
    this._uploadPreviewTracks = null;
    this._uploadCustomCover = null;
    const list = document.getElementById('upload-file-list');
    if (list) list.innerHTML = '';
    const preview = document.getElementById('upload-preview-area');
    if (preview) preview.innerHTML = '';
    this._updateUploadButton();
  },

  async _setUploadFiles(fileList) {
    const audioExts = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus', 'wma'];
    const files = [];
    for (const f of fileList) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (audioExts.indexOf(ext) !== -1) files.push(f);
    }
    this._uploadSelected = files;
    this._uploadPreviewTracks = null;
    this._uploadCustomCover = null;
    const list = document.getElementById('upload-file-list');
    const preview = document.getElementById('upload-preview-area');
    if (list) {
      if (files.length === 0) {
        list.innerHTML = '';
      } else {
        let html = '<div class="upload-file-list-header">' + files.length + ' audio file' + (files.length !== 1 ? 's' : '') + ' selected</div>';
        html += '<div class="upload-file-list-items">';
        for (const f of files) {
          const name = f.webkitRelativePath || f.name;
          html += '<div class="upload-file-list-item"><span class="upload-file-list-item-name">' + this._esc(name) + '</span></div>';
        }
        html += '</div>';
        list.innerHTML = html;
      }
    }
    if (preview) preview.innerHTML = '<div class="upload-preview-loading">Reading metadata…</div>';
    this._updateUploadButton();
    if (files.length > 0) {
      try {
        const result = await Api.metadataPreview(files);
        this._uploadPreviewTracks = result.tracks || [];
        this._showPreviewEdit();
      } catch (e) {
        if (preview) preview.innerHTML = '<div class="upload-preview-loading">Could not read metadata</div>';
      }
    } else {
      if (preview) preview.innerHTML = '';
    }
  },

  _showPreviewEdit() {
    const tracks = this._uploadPreviewTracks;
    const area = document.getElementById('upload-preview-area');
    if (!area || !tracks || tracks.length === 0) {
      if (area) area.innerHTML = '';
      return;
    }
    const t = tracks[0];
    const coverSrc = t.cover || '';
    let html = '<div class="upload-edit-row">';
    html += '<div class="upload-cover-pick" id="upload-cover-pick">';
    if (coverSrc) {
      html += '<img class="upload-cover-img" id="upload-cover-img" src="' + coverSrc + '" alt="">';
    } else {
      html += '<div class="upload-cover-img upload-cover-placeholder" id="upload-cover-placeholder"><span>' + Icons.music() + '</span></div>';
    }
    html += '<div class="upload-cover-hint">Tap to change</div>';
    html += '</div>';
    html += '<div class="upload-meta-fields">';
    html += this._uploadMetaField('Title', 'title', t.title);
    html += this._uploadMetaField('Artist', 'artist', t.artist);
    html += this._uploadMetaField('Album', 'album', t.album);
    html += this._uploadMetaField('Year', 'year', t.year || '');
    html += '</div>';
    html += '</div>';
    if (tracks.length > 1) {
      html += '<div class="upload-more-tracks">+' + (tracks.length - 1) + ' more track' + (tracks.length - 1 !== 1 ? 's' : '') + '</div>';
    }
    area.innerHTML = html;
    const coverPick = document.getElementById('upload-cover-pick');
    const coverInput = document.getElementById('upload-cover-input');
    if (coverPick && coverInput) {
      coverPick.addEventListener('click', () => coverInput.click());
    }
    this._updateUploadButton();
  },

  _updateUploadButton() {
    const btn = document.getElementById('upload-modal-do');
    if (!btn) return;
    const ready = (this._uploadSelected || []).length > 0 && this._uploadPreviewTracks !== null;
    btn.disabled = !ready;
    btn.textContent = ready ? 'Add to Library' : 'Upload';
  },

  _uploadMetaField(label, key, value) {
    return '<div class="edit-meta-field"><label>' + label + '</label>'
      + '<input type="text" id="upload-meta-' + key + '" value="' + this._esc(value) + '"></div>';
  },

  _setUploadStep(step) {
    this._uploadStep = step;
    ['select', 'progress', 'complete'].forEach((s) => {
      const el = document.getElementById('upload-step-' + s);
      if (el) el.classList.toggle('hidden', s !== step);
    });
    const title = document.getElementById('upload-modal-title');
    const area = document.getElementById('upload-actions');
    if (title) {
      title.textContent = step === 'select' ? 'Upload Music' : step === 'progress' ? 'Adding…' : 'Added';
    }
    if (!area) return;
    if (step === 'select') {
      const ready = (this._uploadSelected || []).length > 0 && this._uploadPreviewTracks !== null;
      area.innerHTML = '<button class="edit-meta-cancel" onclick="UI.closeUploadModal()">Cancel</button>'
        + '<button class="edit-meta-save" id="upload-modal-do" onclick="UI.doUpload()"' + (ready ? '' : ' disabled') + '>' + (ready ? 'Add to Library' : 'Upload') + '</button>';
    } else if (step === 'progress') {
      area.innerHTML = '';
    } else {
      const hasTracks = (this._uploadAddedTracks || []).length > 0;
      area.innerHTML = '<button class="edit-meta-cancel" onclick="UI.closeUploadModal()">Close</button>'
        + '<button class="edit-meta-save" onclick="UI._uploadGoTo()">' + (hasTracks ? 'Play Now' : 'Done') + '</button>';
    }
  },

  async doUpload() {
    const files = this._uploadSelected || [];
    if (files.length === 0 || !this._uploadPreviewTracks) {
      this.showToast('No files selected');
      return;
    }
    this._setUploadStep('progress');
    const fill = document.getElementById('upload-progress-fill');
    const ptext = document.getElementById('upload-progress-text');
    if (ptext) ptext.textContent = 'Adding ' + files.length + ' file' + (files.length !== 1 ? 's' : '') + '…';
    if (fill) fill.style.width = '0%';
    try {
      const result = await Api.libraryUploadProgress(files, (loaded, total) => {
        const pct = Math.round(loaded / total * 100);
        if (fill) fill.style.width = pct + '%';
        if (ptext) ptext.textContent = 'Adding… ' + pct + '%';
      });
      const tracks = result.tracks || [];
      this._uploadAddedTracks = tracks;

      if (tracks.length > 0) {
        const t = tracks[0];
        const preview = this._uploadPreviewTracks[0] || {};
        const fields = {};
        const titleEl = document.getElementById('upload-meta-title');
        const artistEl = document.getElementById('upload-meta-artist');
        const albumEl = document.getElementById('upload-meta-album');
        const yearEl = document.getElementById('upload-meta-year');
        if (titleEl && titleEl.value !== (preview.title || '')) fields.title = titleEl.value;
        if (artistEl && artistEl.value !== (preview.artist || '')) fields.artist = artistEl.value;
        if (albumEl && albumEl.value !== (preview.album || '')) fields.album = albumEl.value;
        if (yearEl && yearEl.value && parseInt(yearEl.value, 10) !== (preview.year || 0)) fields.year = parseInt(yearEl.value, 10);
        if (Object.keys(fields).length > 0) {
          if (ptext) ptext.textContent = 'Applying metadata…';
          try { await Api.reviewEditMeta(t.id, fields); } catch (e) {}
        }
        if (this._uploadCustomCover) {
          if (ptext) ptext.textContent = 'Uploading cover…';
          try { await Api.uploadCustomCover(t.id, this._uploadCustomCover); } catch (e) {}
        }
      }

      const summary = document.getElementById('upload-result-summary');
      if (summary) {
        let html = '<div class="upload-complete-check">' + Icons.check() + '</div>';
        html += '<div class="upload-complete-msg">' + tracks.length + ' track' + (tracks.length !== 1 ? 's' : '') + ' added to your library</div>';
        summary.innerHTML = html;
      }
      this._setUploadStep('complete');
    } catch (e) {
      this.showToast('Upload failed');
      this._setUploadStep('select');
    }
  },

  async _uploadGoTo() {
    const tracks = this._uploadAddedTracks || [];
    this.closeUploadModal();
    if (tracks.length > 0) {
      await Store.refreshLibrary();
      const track = Store.library.tracks.find(tr => tr.id === tracks[0].id);
      if (track) {
        const queueTracks = tracks.map(t => Store.library.tracks.find(tr => tr.id === t.id)).filter(Boolean);
        Player.play(track, queueTracks, { type: 'upload', name: 'Uploaded' });
        this.showNowPlaying();
      }
      this.renderPage();
    } else {
      this.renderPage();
    }
  },

  _filterLibResults(query) {
    const container = this.els.content.querySelector('.lib-results');
    if (!container) return;

    if (!query) {
      // Show all items, restore current filter
      container.querySelectorAll('.lib-item').forEach(el => el.style.display = '');
      return;
    }

    container.querySelectorAll('.lib-item').forEach(el => {
      const title = (el.dataset.title || '').toLowerCase();
      const subtitle = (el.dataset.subtitle || '').toLowerCase();
      const match = title.includes(query) || subtitle.includes(query);
      el.style.display = match ? '' : 'none';
    });
  },

  _renderLibPlaylists() {
    let html = '<div class="list-item" data-action="favorites" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:rgba(212,240,64,.1);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.heartFilled() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title">Favorites</div>'
      + '<div class="list-item-subtitle">' + Store.favorites.length + ' songs</div></div></div>';

    html += '<div class="list-item" data-action="all-music" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.music() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title">All Music</div>'
      + '<div class="list-item-subtitle">' + Store.library.tracks.length + ' songs</div></div></div>';

    const reviewCount = Store.reviewCounts.needs_review || 0;
    html += '<div class="list-item" data-action="needs-review" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:rgba(255,107,107,.1);display:flex;align-items:center;justify-content:center;color:#ff6b6b">'
      + Icons.warning() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title" style="color:#ff6b6b">Needs Review</div>'
      + '<div class="list-item-subtitle">' + reviewCount + ' tracks flagged</div></div></div>';

    html += '<div class="list-item" data-action="create-playlist" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.plus() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title" style="color:var(--accent)">Create Playlist</div></div></div>';

    if (Store.playlists.length === 0) {
      html += this._emptyState('No playlists yet', 'Create a playlist to organize your music', Icons.library());
    } else {
      Store.playlists.forEach(p => {
        const firstTrack = p.trackIds.map(tid => Store.getTrack(tid)).find(Boolean);
        const artStyle = firstTrack && firstTrack.albumID
          ? 'background-image:url(' + Api.coverUrl(firstTrack.albumID) + ');background-size:cover;background-position:center'
          : 'background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)';
        const artContent = firstTrack && firstTrack.albumID ? '' : Icons.music();
        html += '<div class="list-item lib-item" data-type="playlist" data-id="' + p.id + '" data-title="' + this._esc(p.name) + '" data-subtitle="' + p.trackIds.length + ' tracks">'
          + '<div class="list-item-art" style="' + artStyle + '">' + artContent + '</div>'
          + '<div class="list-item-info">'
          + '<div class="list-item-title">' + this._esc(p.name) + '</div>'
          + '<div class="list-item-subtitle">' + p.trackIds.length + ' tracks</div>'
          + '</div>'
          + '<button class="list-item-more">' + Icons.more() + '</button></div>';
      });
    }
    return html;
  },

  _renderLibAlbums() {
    const albumsWithName = Store.library.albums.filter(a => a.name && a.name !== '');
    if (albumsWithName.length === 0) {
      return this._emptyState('No albums yet', 'Scan your music library to see albums', Icons.library());
    }
    if (this.viewMode === 'grid') {
      return '<div class="scroll-row" style="flex-wrap:wrap">' + albumsWithName.map(a =>
        '<div class="card lib-item" data-album-id="' + a.id + '" data-title="' + this._esc(a.name) + '" data-subtitle="' + this._esc(a.artist) + '">'
        + '<div class="card-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
        + '<div class="card-title">' + this._esc(a.name) + '</div>'
        + '<div class="card-subtitle">' + this._esc(a.artist) + '</div></div>'
      ).join('') + '</div>';
    }
    return albumsWithName.map(a =>
      '<div class="list-item lib-item" data-type="album" data-id="' + a.id + '" data-title="' + this._esc(a.name) + '" data-subtitle="' + this._esc(a.artist) + '">'
      + '<div class="list-item-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
      + '<div class="list-item-info">'
      + '<div class="list-item-title">' + this._esc(a.name) + '</div>'
      + '<div class="list-item-subtitle">' + this._esc(a.artist) + '</div>'
      + '</div></div>'
    ).join('');
  },

  _renderLibArtists() {
    const artistsWithName = Store.library.artists.filter(a => a.name && a.name !== '');
    if (artistsWithName.length === 0) {
      return this._emptyState('No artists yet', 'Scan your music library to see artists', Icons.music());
    }
    return artistsWithName.map(a =>
      '<div class="list-item lib-item" data-type="artist" data-id="' + this._esc(a.name) + '" data-title="' + this._esc(a.name) + '" data-subtitle="' + a.albumCount + ' album' + (a.albumCount !== 1 ? 's' : '') + '">'
      + '<div class="list-item-art round"><img src="' + Api.artistArtUrl(a.name) + '" alt=""></div>'
      + '<div class="list-item-info"><div class="list-item-title">' + this._esc(a.name) + '</div>'
      + '<div class="list-item-subtitle">' + a.albumCount + ' album' + (a.albumCount !== 1 ? 's' : '') + '</div></div></div>'
    ).join('');
  },

  _renderLibFavorites() {
    const tracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
    this._viewTrackList = tracks;
    if (tracks.length === 0) {
      return this._emptyState('No favorites yet', 'Songs you like will appear here', Icons.heart());
    }
    return this.renderTrackList(tracks, { showArt: true, filterable: true });
  },

  _buildMosaic(tracks) {
    var coverIds = [];
    if (tracks) {
      tracks.forEach(function(t) {
        if (t.albumID && coverIds.indexOf(t.albumID) === -1) coverIds.push(t.albumID);
      });
    }
    if (coverIds.length === 0) {
      coverIds = Store.library.albums
        .filter(function(a) { return a.hasCover && a.name && a.name !== 'Unknown'; })
        .map(function(a) { return a.id; })
        .sort(function() { return Math.random() - 0.5; })
        .slice(0, 12);
    }
    coverIds = coverIds.slice(0, 16);
    if (coverIds.length === 0) return '<div class="detail-hero-fallback-icon">' + Icons.music() + '</div>';
    var html = '';
    coverIds.forEach(function(id) {
      html += '<div class="mosaic-cell"><img src="' + Api.coverUrl(id) + '" alt="" onerror="this.parentElement.style.display=\'none\'"></div>';
    });
    return html;
  },

  renderAllMusic() {
    const allTracks = Store.library.tracks.slice();
    this._viewTrackList = allTracks;
    this._allMusicPage = 0;
    const pageSize = 50;
    const firstBatch = allTracks.slice(0, pageSize);

    let html = '<div class="detail-hero">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<button class="hero-action-btn" data-hero-action="more">' + Icons.more() + '</button>'
      + '<div class="mosaic-banner">' + this._buildMosaic() + '</div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-text">'
      + '<div class="detail-hero-title">All Music</div>'
      + '<div class="detail-hero-meta">' + allTracks.length + ' tracks</div>'
      + '</div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>'
      + '</div></div>';

    if (allTracks.length === 0) {
      html += this._emptyState('No music yet', 'Add music to your library to get started', Icons.music());
    } else {
      html += '<div id="all-music-list">' + this.renderTrackList(firstBatch, { showArt: true }) + '</div>';
      if (allTracks.length > pageSize) {
        html += '<div class="load-more-sentinel"></div>';
      }
    }

    this.els.content.innerHTML = html;
    this._setupAllMusicScroll(allTracks, pageSize);
  },

  _setupAllMusicScroll(allTracks, pageSize) {
    const sentinel = this.els.content.querySelector('.load-more-sentinel');
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      this._allMusicPage = (this._allMusicPage || 0) + 1;
      const start = this._allMusicPage * pageSize;
      if (start >= allTracks.length) {
        observer.disconnect();
        sentinel.remove();
        return;
      }
      const batch = allTracks.slice(start, start + pageSize);
      const listEl = this.els.content.querySelector('#all-music-list .track-list');
      if (listEl) {
        const tmp = document.createElement('div');
        tmp.innerHTML = this.renderTrackList(batch, { showArt: true });
        const rows = tmp.querySelector('.track-list');
        if (rows) {
          while (rows.firstChild) {
            listEl.appendChild(rows.firstChild);
          }
        }
      }
      if (start + pageSize >= allTracks.length) {
        observer.disconnect();
        sentinel.remove();
      }
    }, { root: this.els.content, threshold: 0.1 });
    observer.observe(sentinel);
  },

  renderAlbum(albumId) {
    const album = Store.getAlbum(albumId);
    if (!album) {
      this.els.content.innerHTML = this._emptyState('Album not found', '', Icons.library());
      return;
    }
    const tracks = Store.getAlbumTracks(albumId);
    this._viewTrackList = tracks;

    let html = '<div class="detail-hero">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<button class="hero-action-btn" data-hero-action="more-album" data-album-id="' + albumId + '">' + Icons.more() + '</button>'
      + '<div class="detail-hero-bg" style="background-image:url(' + Api.coverUrl(albumId) + ')"></div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-text">'
      + '<div class="detail-hero-title">' + this._esc(album.name) + '</div>'
      + '<div class="detail-hero-subtitle">' + this._esc(album.artist) + '</div>'
      + '<div class="detail-hero-meta">' + (album.year ? album.year + ' · ' : '') + tracks.length + ' tracks</div>'
      + '</div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>'
      + '</div></div>'
      + this.renderTrackList(tracks, { showArt: false });

    this.els.content.innerHTML = html;
  },

  renderArtist(name) {
    if (!name) {
      this.els.content.innerHTML = this._emptyState('Artist not found', '', Icons.music());
      return;
    }
    const tracks = Store.getArtistTracks(name);
    const albums = Store.getArtistAlbums(name);
    this._viewTrackList = tracks;

    // Use artist art as banner background
    const bgHtml = '<div class="detail-hero-bg" style="background-image:url(' + Api.artistArtUrl(name) + ')"></div>';

    let html = '<div class="detail-hero">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<button class="hero-action-btn" data-hero-action="more-artist" data-artist="' + this._esc(name) + '">' + Icons.more() + '</button>'
      + bgHtml
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-text">'
      + '<div class="detail-hero-title">' + this._esc(name) + '</div>'
      + '<div class="detail-hero-meta">' + albums.length + ' albums · ' + tracks.length + ' tracks</div>'
      + '</div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '<button class="detail-action-btn" data-action="rip-more" data-artist="' + this._esc(name) + '">' + Icons.globe() + '<span>Rip More</span></button>'
      + '</div>'
      + '</div></div>';

    if (albums.length > 0) {
      html += '<div class="section-header"><h2>Albums</h2></div><div class="scroll-row">';
      albums.forEach(a => {
        html += '<div class="card" data-album-id="' + a.id + '">'
          + '<div class="card-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
          + '<div class="card-title">' + this._esc(a.name) + '</div>'
          + '<div class="card-subtitle">' + this._esc(a.artist) + '</div></div>';
      });
      html += '</div>';
    }

    html += '<div class="section-header"><h2>Tracks</h2></div>'
      + this.renderTrackList(tracks, { showArt: true });

    this.els.content.innerHTML = html;
  },

  renderPlaylist(id) {
    const playlist = Store.getPlaylist(id);
    if (!playlist) {
      this.els.content.innerHTML = this._emptyState('Playlist not found', '', Icons.library());
      return;
    }
    const tracks = playlist.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
    this._viewTrackList = tracks;

    // Use first track's album cover as banner if available
    const firstTrack = tracks.length > 0 ? tracks[0] : null;
    const bgHtml = firstTrack && firstTrack.albumID
      ? '<div class="detail-hero-bg" style="background-image:url(' + Api.coverUrl(firstTrack.albumID) + ')"></div>'
      : '';

    let html = '<div class="detail-hero">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<button class="hero-action-btn" data-hero-action="more-playlist" data-playlist-id="' + id + '">' + Icons.more() + '</button>'
      + bgHtml
      + '<div class="detail-hero-fallback-icon">' + Icons.music() + '</div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-text" style="flex-direction:column">'
      + '<div class="detail-hero-title" style="display:flex;align-items:center;gap:8px"><span style="flex:1">' + this._esc(playlist.name) + '</span>'
      + '<button class="detail-action-btn" data-action="share-playlist" data-playlist-id="' + this._esc(id) + '" style="flex-shrink:0">' + Icons.share() + '</button>'
      + '</div>'
      + '<div class="detail-hero-meta">' + tracks.length + ' tracks</div>'
      + '</div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '<button class="detail-action-btn detail-action-btn-danger" data-action="delete-playlist">' + Icons.trash() + '</button>'
      + '</div>'
      + '</div></div>';

    if (tracks.length === 0) {
      html += this._emptyState('No tracks yet', 'Add tracks to this playlist', Icons.music());
    } else {
      html += this.renderTrackList(tracks, { showArt: true });
    }

    this.els.content.innerHTML = html;
  },

  renderFavorites() {
    const tracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
    this._viewTrackList = tracks;

    let bgHtml = '';
    if (tracks.length > 0) {
      bgHtml = '<div class="mosaic-banner">' + this._buildMosaic(tracks.slice(0, 16)) + '</div>';
    }

    let html = '<div class="detail-hero">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<button class="hero-action-btn" data-hero-action="more">' + Icons.more() + '</button>'
      + bgHtml
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-text">'
      + '<div class="detail-hero-title">Favorites</div>'
      + '<div class="detail-hero-meta">' + tracks.length + ' tracks</div>'
      + '</div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>'
      + '</div></div>';

    if (tracks.length === 0) {
      html += this._emptyState('No favorites yet', 'Songs you like will appear here', Icons.heart());
    } else {
      html += this.renderTrackList(tracks, { showArt: true });
    }

    this.els.content.innerHTML = html;
  },

  async renderNeedsReview() {
    this._viewTrackList = [];
    this._reviewOffset = 0;
    this._reviewTotal = 0;
    this.els.content.innerHTML = '<div class="loading-spinner"></div>';

    let data;
    try {
      data = await Api.getReviewTracks(0, 200);
    } catch (e) { data = { tracks: [], total: 0 }; }
    const tracks = data.tracks || [];
    this._reviewTotal = data.total || 0;
    this._reviewOffset = tracks.length;
    this._viewTrackList = tracks;

    let html = '<div class="review-page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<div class="review-page-title">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;color:#ff6b6b;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      + '<h1>Needs Review</h1>'
      + '</div>'
      + '<div class="review-page-meta">' + this._reviewTotal + ' tracks flagged</div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + (tracks.length > 0 ? '<button class="detail-action-btn detail-action-btn-danger" data-action="delete-review-all">' + Icons.trash() + '<span>Delete All</span></button>' : '')
      + '</div>'
      + '</div>';

    if (tracks.length === 0) {
      html += this._emptyState('All clear', 'No tracks need review right now', Icons.checkCircle());
    } else {
      html += '<div id="review-track-list-container">' + this._renderReviewTrackList(tracks) + '</div>';
      if (this._reviewOffset < this._reviewTotal) {
        html += '<div class="review-load-more" id="review-load-trigger" style="text-align:center;padding:24px;color:var(--text-muted)">Scroll for more...</div>';
      }
    }

    this.els.content.innerHTML = html;
    this._setupReviewScrollLoader();
  },

  _setupReviewScrollLoader() {
    const trigger = document.getElementById('review-load-trigger');
    if (!trigger) return;
    const container = this.els.content;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      observer.disconnect();
      this._loadMoreReviewTracks();
    }, { root: container, threshold: 0.1 });
    observer.observe(trigger);
    this._reviewScrollObserver = observer;
  },

  async _loadMoreReviewTracks() {
    const trigger = document.getElementById('review-load-trigger');
    if (trigger) trigger.innerHTML = '<div class="loading-spinner" style="margin:0 auto"></div>';

    let data;
    try {
      data = await Api.getReviewTracks(this._reviewOffset, 200);
    } catch (e) { data = { tracks: [], total: 0 }; }
    const more = data.tracks || [];
    this._reviewTotal = data.total || this._reviewTotal;

    if (more.length > 0) {
      const container = document.getElementById('review-track-list-container');
      const listEl = container ? container.querySelector('.track-list') : null;
      if (listEl) {
        listEl.insertAdjacentHTML('beforeend', this._renderReviewTrackRows(more));
      }
      this._viewTrackList = this._viewTrackList.concat(more);
      this._reviewOffset += more.length;
    }

    const oldTrigger = document.getElementById('review-load-trigger');
    if (oldTrigger) oldTrigger.remove();

    if (this._reviewOffset < this._reviewTotal) {
      const newTrigger = document.createElement('div');
      newTrigger.className = 'review-load-more';
      newTrigger.id = 'review-load-trigger';
      newTrigger.style.cssText = 'text-align:center;padding:24px;color:var(--text-muted)';
      newTrigger.textContent = 'Scroll for more...';
      this.els.content.appendChild(newTrigger);
      this._setupReviewScrollLoader();
    }
  },

  _renderReviewTrackList(reviewTracks) {
    return '<div class="track-list">' + this._renderReviewTrackRows(reviewTracks) + '</div>';
  },

  _renderReviewTrackRows(reviewTracks) {
    let html = '';
    reviewTracks.forEach(t => {
      const artStyle = t.albumID
        ? 'background-image:url(' + Api.coverUrl(t.albumID) + ');background-size:cover;background-position:center'
        : 'background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)';
      const isCurrent = Player.getCurrentTrack() && Player.getCurrentTrack().id === t.id;
      const flags = (t.reviewFlags || []).map(f =>
        '<span class="review-flag-badge">' + this._esc(ReviewUI.flagLabel(f)) + '</span>'
      ).join('');
      html += '<div class="track-row" data-track-id="' + t.id + '">'
        + '<div class="track-art" style="' + artStyle + '"></div>'
        + '<div class="track-info">'
        + '<div class="track-title' + (isCurrent ? ' on' : '') + '">' + this._esc(t.title || 'Unknown') + '</div>'
        + '<div class="track-artist">' + this._esc(t.artist || 'Unknown') + ' - ' + this._esc(t.album || 'Unknown') + '</div>'
        + (flags ? '<div class="track-review-flags">' + flags + '</div>' : '')
        + '</div>'
        + '<div class="track-duration">' + this._formatTime(t.duration) + '</div>'
        + '<button class="track-review-more" data-review-track-id="' + t.id + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;color:#ff6b6b"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
        + '</button>'
        + '</div>';
    });
    html += '</div>';
    return html;
  },

  _showReviewTrackMenu(trackId, triggerEl) {
    ReviewUI.showDropdownForTrack(trackId, triggerEl, () => {
      if (Store.currentView === 'needs-review') this.renderNeedsReview();
    });
  },

  renderFinder() {
    this._viewTrackList = [];
    if (!this._finderType) this._finderType = 'artist';
    if (!this._finderQuery) this._finderQuery = '';
    if (!this._finderResults) this._finderResults = null;
    if (!this._finderHistory) this._finderHistory = JSON.parse(localStorage.getItem('finderHistory') || '[]');
    if (!this._finderTab) this._finderTab = 'search';
    if (this._downloadPollTimer) { clearInterval(this._downloadPollTimer); this._downloadPollTimer = null; }

    let html = '<div class="lib-sticky-header">'
      + '<div class="lib-tabs">'
      + '<button class="lib-tab' + (this._finderTab === 'search' ? ' active' : '') + '" data-finder-tab="search">Rip Search</button>'
      + '<button class="lib-tab' + (this._finderTab === 'import' ? ' active' : '') + '" data-finder-tab="import">YT Import</button>'
      + '<button class="lib-tab' + (this._finderTab === 'downloads' ? ' active' : '') + '" data-finder-tab="downloads">Downloads</button>'
      + '</div>';

    if (this._finderTab === 'downloads') {
      html += '</div>'
        + '<div id="downloads-content"><div class="loading-spinner" style="margin:40px auto"></div></div>';
    } else if (this._finderTab === 'import') {
      html += '</div>'
        + '<div class="playlist-import-section">'
        + '<div class="playlist-import-body">'
        + '<div class="playlist-import-form">'
        + '<input class="settings-input" type="text" id="playlist-url-input" placeholder="Paste YouTube playlist URL..." style="flex:1">'
        + '<button class="settings-btn settings-btn-primary" id="btn-import-playlist">Import</button>'
        + '</div>'
        + '<div id="playlist-import-result"></div>'
        + '<div id="watched-playlists"></div>'
        + '</div>'
        + '</div>';
    } else {
      const subChips = '<div class="finder-type-chips finder-sub-chips">'
        + '<button class="chip finder-sub' + (this._finderType === 'artist' ? ' active' : '') + '" data-finder-type="artist">Artists</button>'
        + '<button class="chip finder-sub' + (this._finderType === 'recording' ? ' active' : '') + '" data-finder-type="recording">Songs</button>'
        + '<button class="chip finder-sub' + (this._finderType === 'release' ? ' active' : '') + '" data-finder-type="release">Albums</button>'
        + '</div>';
      html += '<div class="search-container finder-search-container">'
        + '<span class="search-icon">' + Icons.search() + '</span>'
        + '<input class="search-input finder-search-input" type="text" placeholder="Search artists, songs, albums..." value="' + this._esc(this._finderQuery) + '">'
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
        this._finderType = chip.dataset.finderType;
        this._finderResults = null;
        this.renderFinder();
        if (this._finderQuery) {
          this._renderFinderResults();
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
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await Api.deleteWatch(btn.dataset.delete);
          this._loadWatchedPlaylists();
        });
      });
    } catch (e) {}
  },

  renderDownloads() {
    this._viewTrackList = [];

    let html = '<div class="page-header">'
      + '<span class="page-header-title">Downloads</span></div>'
      + '<div id="downloads-content"><div class="loading-spinner" style="margin:40px auto"></div></div>';

    this.els.content.innerHTML = html;
    this._loadDownloads();
    this._downloadPollTimer = setInterval(() => this._loadDownloads(), 3000);
  },

  async _loadDownloads() {
    const container = document.getElementById('downloads-content');
    if (!container) return;

    try {
      const jobs = await Api.getQueue(1000);
      const counts = await Api.getQueueCounts();
      this._updateDownloadBadge(counts);

      if (!jobs || jobs.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
          + '<div class="empty-state-title">No Downloads Yet</div>'
          + '<div class="empty-state-text">Search for music in the Finder tab and tap download to start.</div></div>';
        return;
      }

      const activeCount = (counts.queued || 0) + (counts.searching || 0) + (counts.downloading || 0);
      const failedCount = counts.failed || 0;
      let html = '';

      const needsSel = counts.needs_selection || 0;
      if (activeCount > 0 || counts.completed > 0 || counts.failed > 0 || needsSel > 0) {
        html += '<div class="queue-stats">'
          + '<div class="queue-stats-badges">'
          + (counts.queued > 0 ? '<span class="stat-badge stat-queued">' + counts.queued + ' queued</span>' : '')
          + (activeCount > 0 && counts.queued <= 0 ? '<span class="stat-badge stat-active">' + activeCount + ' active</span>' : '')
          + (needsSel > 0 ? '<span class="stat-badge stat-failed">' + needsSel + ' needs pick</span>' : '')
          + (counts.completed > 0 ? '<span class="stat-badge stat-completed">' + counts.completed + ' done</span>' : '')
          + (counts.failed > 0 ? '<span class="stat-badge stat-failed">' + counts.failed + ' failed</span>' : '')
          + '</div>'
          + '<div class="queue-stats-actions">'
          + (failedCount > 0 ? '<button class="settings-btn settings-btn-primary" id="btn-retry-all-failed" style="font-size:11px;padding:4px 10px;white-space:nowrap">&#x21bb; Retry All</button>' : '')
          + (counts.completed > 0 || counts.failed > 0 ? '<button class="settings-btn" id="btn-clear-history" style="font-size:11px;padding:4px 10px;white-space:nowrap">Clear History</button>' : '')
          + '</div>'
          + '</div>';
      }

      html += '<div class="queue-job-list">';
      const now = Date.now();
      let queuedIndex = 0;
      jobs.forEach(j => {
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
        html += '<div class="queue-job-card' + cardClass + (clickable ? ' queue-job-clickable' : '') + '"'
          + (clickable ? ' data-artist="' + this._esc(j.artist || '') + '" data-title="' + this._esc(j.title || '') + '"' : '') + '>'
          + leftHtml
          + '<div class="queue-job-info">'
          + '<div class="queue-job-title">' + this._esc(j.artist || '') + (j.artist && j.title ? ' - ' : '') + this._esc(j.title || j.query || 'Unknown') + '</div>'
      + '<div class="queue-job-detail">'
      + (completed ? (j.audioQuality ? '<span class="queue-job-quality">' + this._esc(j.audioQuality) + '</span>' : '<span>Completed</span>') : (active ? '<span class="queue-elapsed">' + elapsed + '</span>' : (isQueued ? queuePos + '<span class="queue-elapsed">' + elapsed + '</span>' : '<span>' + j.status + '</span>')))
      + (j.progressStage && !isQueued && !completed ? '<span>' + this._esc(j.progressStage) + '</span>' : '')
      + (!completed && j.audioQuality ? '<span class="queue-job-quality">' + this._esc(j.audioQuality) + '</span>' : '')
      + (failed && j.error ? '<span class="queue-job-error">' + this._esc(j.error) + '</span>' : '')
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
      container.querySelectorAll('.queue-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          Api.deleteJob(btn.dataset.jobId).then(() => this._loadDownloads());
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
          const artist = card.dataset.artist;
          const title = card.dataset.title;
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
        clearBtn.addEventListener('click', async () => {
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
      }
    } catch (e) {
      container.innerHTML = '<div class="empty-state-text">Failed to load downloads</div>';
    }
  },

  async _pollFinderStatus() {
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
      listHtml += '<div class="candidate-item" data-video-id="' + this._esc(c.videoId) + '">'
        + '<div class="candidate-item-art"><img src="https://i.ytimg.com/vi/' + this._esc(c.videoId) + '/default.jpg" alt="" onerror="this.style.display=\'none\'"></div>'
        + '<div class="candidate-item-info">'
        + '<div class="candidate-item-title">' + this._esc(c.title) + '</div>'
        + '<div class="candidate-item-subtitle">' + this._esc(c.channel) + (dur ? ' &middot; ' + dur : '') + '</div>'
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
      + '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    overlay.querySelector('.candidate-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.candidate-item').forEach(item => {
      item.addEventListener('click', () => {
        const videoId = item.dataset.videoId;
        item.style.opacity = '0.5';
        item.style.pointerEvents = 'none';
        Api.selectVideo(job.id, videoId).then(() => {
          overlay.remove();
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
  },

  _pollDownloadBadge() {
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

    if (!this._finderQuery) {
      container.innerHTML = '<div class="empty-state" style="padding:40px 22px">'
        + '<div class="empty-state-text">Search for songs, artists, or albums on MusicBrainz</div></div>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner" style="margin:40px auto"></div>';

    try {
      try { this._downloadJobs = await Api.getQueue(); } catch(e) { this._downloadJobs = []; }
      let results;
      if (this._finderType === 'youtube') {
        results = await Api.finderYouTubeSearch(this._finderQuery);
      } else {
        results = await Api.finderSearch(this._finderQuery, this._finderType);
      }
      this._finderResults = results;
      this._addSearchHistory(this._finderQuery);
      this._renderFinderResultsList(container, results);
    } catch (err) {
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
          statusHtml = '<button class="finder-download-btn" data-action="download-song" data-artist="' + this._esc(r.artist) + '" data-title="' + this._esc(r.title) + '" data-album="' + this._esc(r.album || '') + '" data-album-mbid="' + this._esc(r.albumId || '') + '" title="Download">' + Icons.download() + '<span>Download</span></button>';
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
          statusHtml = '<button class="finder-download-btn" data-action="download-song" data-artist="' + this._esc(r.channel) + '" data-title="' + this._esc(r.title) + '" title="Download">' + Icons.download() + '<span>Download</span></button>';
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
    this._bindFinderResults();
  },

  _bindFinderResults() {
    const container = this.els.content.querySelector('#finder-results');
    if (!container) return;

    container.addEventListener('click', (e) => {
      const previewBtn = e.target.closest('.finder-preview-btn');
      if (previewBtn) {
        e.stopPropagation();
        this._doPreview(previewBtn);
        return;
      }

      const dlBtn = e.target.closest('[data-action="download-song"]');
      if (dlBtn) {
        e.stopPropagation();
        const badge = document.createElement('span');
        badge.className = 'finder-status-badge finder-in-queue';
        badge.textContent = 'Queued';
        dlBtn.replaceWith(badge);
        this._addToQueue({
          artist: dlBtn.dataset.artist,
          title: dlBtn.dataset.title,
          album: dlBtn.dataset.album || '',
          albumMbid: dlBtn.dataset.albumMbid || ''
        });
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
    } catch (err) {
      const msg = err.message || 'Failed to add to queue';
      if (msg.includes('already in library') || msg.includes('already')) {
        this._showToast('Already in your library');
      } else {
        this._showToast(msg);
      }
    }
  },

  _showToast(msg) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 2500);
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
      + '<input class="search-input artist-tracklist-search" type="text" placeholder="Filter tracks...">'
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
        if (countEl) countEl.firstElementChild.textContent = q ? visible + ' of ' + allTracks.length + ' tracks' : allTracks.length + ' unique track' + (allTracks.length !== 1 ? 's' : '');
      });
    }

    container.querySelectorAll('.finder-track-dl').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const badge = document.createElement('span');
        badge.className = 'finder-status-badge finder-in-queue';
        badge.textContent = 'Queued';
        btn.replaceWith(badge);
        this._addToQueue({
          artist: btn.dataset.artist,
          title: btn.dataset.title,
          album: btn.dataset.album || '',
          albumMbid: btn.dataset.albumMbid || '',
          trackNumber: parseInt(btn.dataset.trackNumber) || 0,
          trackTotal: parseInt(btn.dataset.trackTotal) || 0
        });
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
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const badge = document.createElement('span');
          badge.className = 'finder-status-badge finder-in-queue';
          badge.textContent = 'Queued';
          btn.replaceWith(badge);
          this._addToQueue({
            artist: btn.dataset.artist,
            title: btn.dataset.title,
            album: btn.dataset.album || '',
            albumMbid: btn.dataset.albumMbid || '',
            trackNumber: parseInt(btn.dataset.trackNumber) || 0,
            trackTotal: parseInt(btn.dataset.trackTotal) || 0
          });
        });
      });
    }).catch(() => {
      const container = document.getElementById('finder-release-content');
      if (container) container.innerHTML = '<div class="empty-state-text">Failed to load tracks</div>';
    });
  },

  renderSettings() {
    this._viewTrackList = [];

    if (!this._settingsUnlocked) {
      this._renderSettingsLocked();
      return;
    }

    let html = '<div class="page-header">'
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Settings</span></div>';

    const st = (id, label, hint) => {
      return '<div class="settings-toggle-row">'
        + '<div><div class="settings-toggle-label">' + label + '</div>'
        + (hint ? '<div class="settings-toggle-hint">' + hint + '</div>' : '')
        + '</div>'
        + '<div class="stoggle" id="' + id + '"><div class="stoggle-track"><div class="stoggle-knob"></div></div></div>'
        + '</div>';
    };

    // Section 1: Playback
    html += '<div class="settings-section">'
      + '<div class="settings-section-title" data-collapse>' + Icons.waveform() + ' Playback' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
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
      + '</div></div></div>';

    // Section 2: User Downloads
    html += '<div class="settings-section collapsed">'
      + '<div class="settings-section-title" data-collapse>' + Icons.download() + ' User Downloads' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
      + st('setting-downloads-enabled', 'Enable Downloads', 'Allow users to download tracks from the player')
      + '<div class="settings-actions" style="margin-top:16px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-user-downloads">' + Icons.check() + '<span>Save</span></button>'
      + '<button class="settings-btn" id="btn-toggle-download-list">' + Icons.library() + '<span>Manage Per-Track</span></button>'
      + '</div>'
      + '<div id="download-list"></div>'
      + '</div></div>';

    // Section 3: Import Settings
    html += '<div class="settings-section collapsed">'
      + '<div class="settings-section-title" data-collapse>' + Icons.download() + ' Import Settings' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
      + '<div id="finder-settings" class="settings-status"></div>'
      + '<div class="settings-form-grid">'
      + '<div class="settings-field"><label>Audio Format</label>'
      + '<select id="setting-download-format" class="settings-select">'
      + '<option value="flac">FLAC (lossless)</option>'
      + '<option value="mp3">MP3</option>'
      + '<option value="opus">Opus</option>'
      + '<option value="m4a">M4A/AAC</option>'
      + '<option value="best">Original (no conversion)</option>'
      + '</select></div>'
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
      + '<div class="settings-field"><label>Minimum Bitrate (kbps)</label>'
      + '<input type="text" id="setting-download-min-bitrate" class="settings-input" placeholder="0 (no minimum)"></div>'
      + '</div>'
      + st('setting-download-convert-to-flac', 'Convert to FLAC', 'Re-encode imported files as FLAC')
      + st('setting-download-organise-by-artist', 'Organise by Artist', 'Move imported files into Artist/Album/ folders')
      + '<div class="settings-subsection-label" style="margin-top:16px">YouTube Cookies</div>'
      + '<div class="settings-section-desc">Required for age-restricted videos. Choose a browser to import cookies from, or provide a cookies.txt file path.</div>'
      + '<div class="settings-form-grid">'
      + '<div class="settings-field"><label>Cookies from Browser</label>'
      + '<select id="setting-yt-cookies-from-browser" class="settings-select">'
      + '<option value="">Disabled</option>'
      + '<option value="chrome">Chrome</option>'
      + '<option value="firefox">Firefox</option>'
      + '<option value="safari">Safari</option>'
      + '<option value="edge">Edge</option>'
      + '<option value="brave">Brave</option>'
      + '</select></div>'
      + '<div class="settings-field"><label>Or: Cookies File Path</label>'
      + '<input type="text" id="setting-yt-cookies-file" class="settings-input" placeholder="/path/to/cookies.txt"></div>'
      + '</div>'
      + '<div class="settings-subsection-label" style="margin-top:16px">Bulk Import</div>'
      + '<div class="settings-section-desc">Paste tracks to download (one per line, "Artist - Title").</div>'
      + '<textarea id="bulk-import-input" class="settings-textarea" rows="4" placeholder="Radiohead - Creep&#10;Arcade Fire - Rebellion"></textarea>'
      + '<div class="settings-actions" style="margin-top:8px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-finder-settings">' + Icons.check() + '<span>Save Import Settings</span></button>'
      + '<button class="settings-btn settings-btn-primary" id="btn-bulk-import">' + Icons.download() + '<span>Import & Download All</span></button>'
      + '</div></div></div>';

    // Section 4: Library Health
    const rc = Store.reviewCounts || {};
    const total = (rc.unchecked || 0) + (rc.needs_review || 0) + (rc.reviewed_ok || 0);
    const reviewedPct = total > 0 ? Math.round(((rc.reviewed_ok || 0) / total) * 100) : 0;
    html += '<div class="settings-section collapsed">'
      + '<div class="settings-section-title" data-collapse style="color:#ff6b6b">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
      + ' Library Health' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
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
      + '<div style="margin-top:12px">'
      + st('setting-review-enabled', 'Review Worker', 'Automatically flag tracks with metadata or quality issues')
      + '<div class="settings-field" style="padding:10px 0"><label style="font-size:14px;color:var(--text1)">Recheck Interval (hours)</label>'
      + '<input type="text" id="setting-review-recheck-hours" class="settings-input" style="width:60px;display:inline-block;margin-left:6px" placeholder="24"></div>'
      + '</div>'
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
      + '</div></div>';

    // Section 5: System
    html += '<div class="settings-section collapsed">'
      + '<div class="settings-section-title" data-collapse>' + Icons.settings() + ' System' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
      + '<div class="settings-actions" style="margin-bottom:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-rescan">' + Icons.refresh() + '<span>Rescan Library</span></button>'
      + '</div>'
      + '<div class="settings-subsection-label">Background Workers</div>'
      + st('setting-watcher-enabled', 'File Watcher', 'Poll music directories for changes')
      + st('setting-cover-fetch-enabled', 'Cover Art Fetch', 'Download missing album covers')
      + st('setting-artist-art-fetch-enabled', 'Artist Art Fetch', 'Download artist images')
      + '<div class="settings-field" style="max-width:200px;margin-top:8px"><label>Watcher Interval (seconds)</label>'
      + '<input type="text" id="setting-watcher-interval" class="settings-input" placeholder="30"></div>'
      + '<div class="settings-actions" style="margin-top:12px">'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-worker-settings">' + Icons.check() + '<span>Save Worker Settings</span></button>'
      + '</div></div></div>';

    // Section 6: About
    html += '<div class="settings-section collapsed">'
      + '<div class="settings-section-title" data-collapse>' + Icons.settings() + ' About' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
      + '<div class="settings-about">'
      + '<div>MusicApp</div>'
      + '<div style="color:var(--text3);font-size:13px">Personal music library with MusicBrainz integration</div>'
      + '</div></div></div>';

    this.els.content.innerHTML = html;

    this._loadMetadataStatus();

    this.els.content.querySelectorAll('.stoggle').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('active'));
    });

    this.els.content.querySelectorAll('.settings-section-title').forEach(el => {
      const section = el.closest('.settings-section');
      if (section && section.querySelector('.settings-section-body')) {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          section.classList.toggle('collapsed');
        });
      }
    });

    document.getElementById('btn-meta-scan').addEventListener('click', () => this._startMetadataScan());
    document.getElementById('btn-meta-history').addEventListener('click', () => this.navigateTo('metadata-history'));
    document.getElementById('btn-rescan').addEventListener('click', () => this._rescanLibrary());

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

    this._paintWaveformPreview();

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
      this._stoggleOn('setting-downloads-enabled', settings.downloads_enabled !== 'false');
      Store.downloadsEnabled = settings.downloads_enabled !== 'false';
      this._updateQualityVisibility();
      if (fmt) fmt.addEventListener('change', () => this._updateQualityVisibility());

      this._stoggleOn('setting-watcher-enabled', settings.watcher_enabled !== 'false');
      const watcherInterval = document.getElementById('setting-watcher-interval');
      if (watcherInterval && settings.watcher_interval) watcherInterval.value = settings.watcher_interval;
      this._stoggleOn('setting-cover-fetch-enabled', settings.cover_fetch_enabled !== 'false');
      this._stoggleOn('setting-artist-art-fetch-enabled', settings.artist_art_fetch_enabled !== 'false');

      this._stoggleOn('setting-review-enabled', settings.review_enabled !== 'false');
      const revRecheckHours = document.getElementById('setting-review-recheck-hours');
      if (revRecheckHours && settings.review_recheck_hours) revRecheckHours.value = settings.review_recheck_hours;
      const revEnabled = document.getElementById('setting-review-enabled');
      if (revEnabled) revEnabled.addEventListener('click', () => this._saveReviewSettings());
      if (revRecheckHours) revRecheckHours.addEventListener('change', () => this._saveReviewSettings());

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
      await Api.saveSettings({
        download_format: fmt ? fmt.value : 'flac',
        download_convert_to_flac: String(this._stoggleVal('setting-download-convert-to-flac')),
        download_organise_by_artist: String(this._stoggleVal('setting-download-organise-by-artist')),
        mp3_bitrate: mp3 ? mp3.value : 'v2',
        opus_bitrate: opus ? opus.value : '320k',
        download_min_bitrate: minBr ? minBr.value : '0'
      });
      this._showToast('Import settings saved');
    } catch (e) {
      this._showToast('Failed to save settings');
    }
  },

  async _saveWorkerSettings() {
    const watcherInterval = document.getElementById('setting-watcher-interval');
    try {
      await Api.saveSettings({
        watcher_enabled: String(this._stoggleVal('setting-watcher-enabled')),
        watcher_interval: watcherInterval ? watcherInterval.value : '30',
        cover_fetch_enabled: String(this._stoggleVal('setting-cover-fetch-enabled')),
        artist_art_fetch_enabled: String(this._stoggleVal('setting-artist-art-fetch-enabled'))
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

  _generateWaveformPreviewPeaks(numBars) {
    const peaks = [];
    for (let i = 0; i < numBars; i++) {
      const t = i / numBars;
      const base = 0.15 + 0.7 * Math.pow(Math.sin(t * Math.PI), 0.8);
      const noise = 0.15 * (Math.sin(i * 1.7 + 0.3) * 0.5 + 0.5) * Math.cos(i * 0.4 + 1.2);
      peaks.push(Math.max(0.08, Math.min(1, base + noise)));
    }
    return peaks;
  },

  _paintWaveformPreview() {
    const canvas = document.getElementById('waveform-preview-canvas');
    if (!canvas) return;
    const sel = document.getElementById('setting-waveform-style');
    const style = sel ? sel.value : Store.waveformStyle;

    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = 64;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const numBars = Math.floor(w / 5);
    const rawPeaks = this._generateWaveformPreviewPeaks(numBars);
    const data = rawPeaks.map(v => Math.max(8, Math.round(v * 100)));

    this._paintWaveformOnCanvas(ctx, data, 3, 2, canvas.width, canvas.height, 0.6, style);
  },

  _paintWaveformOnCanvas(ctx, data, pw, pg, w, h, progressFraction, style) {
    const dpr = window.devicePixelRatio || 1;
    pw *= dpr;
    pg *= dpr;
    const totalWidth = data.length * (pw + pg);

    const styleComp = getComputedStyle(document.documentElement);
    const playedColor = styleComp.getPropertyValue('--waveform-played').trim() || '#D4F040';
    const unplayedColor = styleComp.getPropertyValue('--waveform-unplayed').trim() || 'rgba(255, 255, 255, 0.22)';

    const playingPoint = progressFraction * data.length;

    ctx.clearRect(0, 0, w, h);

    if (style === 'mirror') {
      this._paintWaveformMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else if (style === 'layered') {
      this._paintWaveformLayered(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else if (style === 'layered-mirror') {
      this._paintWaveformLayeredMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else if (style === 'squiggle') {
      this._paintWaveformSquiggle(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    } else {
      this._paintWaveformRounded(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor);
    }
  },

  _paintWaveformRounded(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const totalWidth = data.length * (pw + pg);
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const barH = (val / 100) * h * 0.85;
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const y = (h - barH) / 2;

      ctx.fillStyle = i < playingPoint ? playedColor : unplayedColor;

      const radius = Math.min(pw / 2, barH / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + pw - radius, y);
      ctx.arcTo(x + pw, y, x + pw, y + radius, radius);
      ctx.lineTo(x + pw, y + barH - radius);
      ctx.arcTo(x + pw, y + barH, x + pw - radius, y + barH, radius);
      ctx.lineTo(x + radius, y + barH);
      ctx.arcTo(x, y + barH, x, y + barH - radius, radius);
      ctx.lineTo(x, y + radius);
      ctx.arcTo(x, y, x + radius, y, radius);
      ctx.closePath();
      ctx.fill();
    }
  },

  _paintWaveformMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const totalWidth = data.length * (pw + pg);
    const mid = h * 0.68;
    const gap = Math.max(1, h * 0.02);
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const topH = (val / 100) * mid * 0.92;
      const botH = (val / 100) * (h - mid) * 0.92;
      const x = (w - totalWidth) / 2 + i * (pw + pg);

      const topColor = i < playingPoint ? playedColor : unplayedColor;

      const rTop = Math.min(pw / 2, topH / 2);
      ctx.fillStyle = topColor;
      ctx.beginPath();
      ctx.moveTo(x + rTop, mid - gap - topH);
      ctx.lineTo(x + pw - rTop, mid - gap - topH);
      ctx.arcTo(x + pw, mid - gap - topH, x + pw, mid - gap - topH + rTop, rTop);
      ctx.lineTo(x + pw, mid - gap);
      ctx.lineTo(x, mid - gap);
      ctx.lineTo(x, mid - gap - topH + rTop);
      ctx.arcTo(x, mid - gap - topH, x + rTop, mid - gap - topH, rTop);
      ctx.closePath();
      ctx.fill();

      const rBot = Math.min(pw / 2, botH / 2);
      const botTop = mid + gap;
      const botBot = mid + gap + botH;
      const grad = ctx.createLinearGradient(0, botTop, 0, botBot);
      const botColorStart = i < playingPoint ? this._colorAlpha(playedColor, 0.5) : this._colorAlpha(unplayedColor, 0.2);
      const botColorEnd = i < playingPoint ? this._colorAlpha(playedColor, 0) : this._colorAlpha(unplayedColor, 0);
      grad.addColorStop(0, botColorStart);
      grad.addColorStop(1, botColorEnd);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, botTop);
      ctx.lineTo(x + pw, botTop);
      ctx.lineTo(x + pw, botBot - rBot);
      ctx.arcTo(x + pw, botBot, x + pw - rBot, botBot, rBot);
      ctx.lineTo(x + rBot, botBot);
      ctx.arcTo(x, botBot, x, botBot - rBot, rBot);
      ctx.lineTo(x, botTop);
      ctx.closePath();
      ctx.fill();
    }
  },

  _colorToRGBA(ctx, css, fallback) {
    ctx.fillStyle = '#000';
    ctx.fillStyle = css || fallback;
    let v = ctx.fillStyle;
    if (v[0] === '#') {
      if (v.length === 4) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
      return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
    }
    const m = v.match(/rgba?\(([^)]+)\)/);
    const p = m[1].split(',').map(s => parseFloat(s));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  },

  _paintWaveformLayered(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');

    const mid = h / 2;
    const maxH = h / 2 - 2;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;
    const totalWidth = data.length * (pw + pg);
    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const barH = Math.max(1.5, barVal * maxH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        const isPlayed = cx <= playX;
        const c = isPlayed ? played : unplayed;
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const grad = ctx.createLinearGradient(0, mid - barH, 0, mid + barH);
        grad.addColorStop(0, fade);
        grad.addColorStop(0.12, full);
        grad.addColorStop(0.88, full);
        grad.addColorStop(1, fade);
        ctx.fillStyle = grad;
        ctx.fillRect(x0, mid - barH, lw, barH * 2);
      }
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

  _paintWaveformLayeredScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');
    const hoverC = this._colorToRGBA(ctx, hoverPlayed, 'rgba(212,240,64,0.55)');

    const mid = h / 2;
    const maxH = (h / 2 - 2) * scale;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;

    const hov = hoverX >= 0;
    const hx = hov ? hoverX : -1;
    const hLo = hov ? Math.min(playX, hx) : 0;
    const hHi = hov ? Math.max(playX, hx) : -1;
    const inHover = (cx) => hov && cx >= hLo && cx <= hHi;

    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const barH = Math.max(1.5, barVal * maxH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        let c;
        if (inHover(cx)) {
          c = hoverC;
        } else if (cx <= playX) {
          c = played;
        } else {
          c = unplayed;
        }
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const grad = ctx.createLinearGradient(0, mid - barH, 0, mid + barH);
        grad.addColorStop(0, fade);
        grad.addColorStop(0.12, full);
        grad.addColorStop(0.88, full);
        grad.addColorStop(1, fade);
        ctx.fillStyle = grad;
        ctx.fillRect(x0, mid - barH, lw, barH * 2);
      }
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

  _paintWaveformLayeredMirror(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;
    const mirrorSplit = 0.68;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');

    const split = h * mirrorSplit;
    const gap = Math.max(2, h * 0.03);
    const maxTopH = split - gap - 2;
    const maxBotH = (h - split - gap) * 0.9;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;
    const totalWidth = data.length * (pw + pg);
    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;
    const botStart = split + gap;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const topH = Math.max(1.5, barVal * maxTopH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        const isPlayed = cx <= playX;
        const c = isPlayed ? played : unplayed;
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const topGrad = ctx.createLinearGradient(0, split - gap - topH, 0, split - gap);
        topGrad.addColorStop(0, fade);
        topGrad.addColorStop(0.12, full);
        topGrad.addColorStop(0.88, full);
        topGrad.addColorStop(1, full);
        ctx.fillStyle = topGrad;
        ctx.fillRect(x0, split - gap - topH, lw, topH);
      }
    }

    for (let i = 0; i < data.length; i++) {
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const cx = x + pw / 2;
      const barVal = data[i] / 100;
      const barH = Math.max(1, barVal * maxBotH);
      const isPlayed = cx <= playX;
      const c = isPlayed ? played : unplayed;
      const botGrad = ctx.createLinearGradient(0, botStart, 0, botStart + barH);
      botGrad.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.5).toFixed(3) + ')');
      botGrad.addColorStop(0.4, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.2).toFixed(3) + ')');
      botGrad.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(x, botStart, pw, barH);
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

  _paintWaveformLayeredMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const layers = 6;
    const opacityFalloff = 0.52;
    const heightGrowth = 0.08;
    const waveAmplitude = 0.15;
    const wavePhaseShift = 1.4;
    const waveCycles = 2.4;
    const mirrorSplit = 0.68;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const unplayed = this._colorToRGBA(ctx, unplayedColor, 'rgba(255,255,255,0.5)');
    const hoverC = this._colorToRGBA(ctx, hoverPlayed, 'rgba(212,240,64,0.55)');

    const split = h * mirrorSplit;
    const gap = Math.max(2, h * 0.03);
    const maxTopH = (split - gap - 2) * scale;
    const maxBotH = (h - split - gap) * 0.9 * scale;
    const freq = (Math.PI * 2 * waveCycles) / w;
    const playX = (playingPoint / data.length) * w;

    const hov = hoverX >= 0;
    const hx = hov ? hoverX : -1;
    const hLo = hov ? Math.min(playX, hx) : 0;
    const hHi = hov ? Math.max(playX, hx) : -1;
    const inHover = (cx) => hov && cx >= hLo && cx <= hHi;

    const hShiftAmp = (pw + pg) * 0.6;
    const hWaveFreq = (Math.PI * 2 * 1.5) / w;
    const botStart = split + gap;

    ctx.clearRect(0, 0, w, h);

    for (let l = layers - 1; l >= 0; l--) {
      const la = Math.pow(opacityFalloff, l);
      const hsc = 1 + l * heightGrowth;
      const phase = l * wavePhaseShift;
      const lw = pw * (1 - l * 0.04);

      for (let i = 0; i < data.length; i++) {
        const baseX = (w - totalWidth) / 2 + i * (pw + pg);
        const xOff = l * hShiftAmp * (0.5 + 0.5 * Math.sin(baseX * hWaveFreq + l * 0.8));
        const x = baseX + xOff;
        const cx = x + lw / 2;
        const barVal = data[i] / 100;
        const waveMod = 1 + waveAmplitude * Math.sin(baseX * freq + phase);
        const topH = Math.max(1.5, barVal * maxTopH * hsc * waveMod);
        const x0 = x + (pw - lw) / 2;

        let c;
        if (inHover(cx)) {
          c = hoverC;
        } else if (cx <= playX) {
          c = played;
        } else {
          c = unplayed;
        }
        const alpha = (c[3] * la).toFixed(3);
        const full = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
        const fade = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)';

        const topGrad = ctx.createLinearGradient(0, split - gap - topH, 0, split - gap);
        topGrad.addColorStop(0, fade);
        topGrad.addColorStop(0.12, full);
        topGrad.addColorStop(0.88, full);
        topGrad.addColorStop(1, full);
        ctx.fillStyle = topGrad;
        ctx.fillRect(x0, split - gap - topH, lw, topH);
      }
    }

    for (let i = 0; i < data.length; i++) {
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const cx = x + pw / 2;
      const barVal = data[i] / 100;
      const barH = Math.max(1, barVal * maxBotH);

      let c;
      if (inHover(cx)) {
        c = hoverC;
      } else if (cx <= playX) {
        c = played;
      } else {
        c = unplayed;
      }
      const botGrad = ctx.createLinearGradient(0, botStart, 0, botStart + barH);
      botGrad.addColorStop(0, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.5).toFixed(3) + ')');
      botGrad.addColorStop(0.4, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] * 0.2).toFixed(3) + ')');
      botGrad.addColorStop(1, 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0)');
      ctx.fillStyle = botGrad;
      ctx.fillRect(x, botStart, pw, barH);
    }

    ctx.fillStyle = 'rgba(' + played[0] + ',' + played[1] + ',' + played[2] + ',0.85)';
    ctx.fillRect(playX - 0.6, 0, 1.2, h);
  },

   _paintWaveformSquiggle(ctx, data, pw, pg, w, h, playingPoint, playedColor, unplayedColor) {
    const mid = h / 2;
    const maxH = h / 2 - 2;
    const playX = (playingPoint / data.length) * w;
    const totalWidth = data.length * (pw + pg);
    const offsetX = (w - totalWidth) / 2;
    const per = pw + pg;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');

    const greyR = Math.round(played[0] * 0.35 + 128 * 0.65);
    const greyG = Math.round(played[1] * 0.35 + 128 * 0.65);
    const greyB = Math.round(played[2] * 0.35 + 128 * 0.65);

    ctx.clearRect(0, 0, w, h);

    const upTips = [];
    const dnTips = [];
    for (let i = 0; i < data.length; i++) {
      const barVal = data[i] / 100;
      const barH = Math.max(2, barVal * maxH);
      const x = offsetX + i * per + pw / 2;
      upTips.push({ x, y: mid - barH });
      dnTips.push({ x, y: mid + barH });
    }

    if (upTips.length < 2) return;
    const drawShape = (from, to, fillColor, strokeColor, lineW) => {
      if (to - from < 2) return;
      ctx.beginPath();
      ctx.moveTo(upTips[from].x, upTips[from].y);
      for (let i = from + 1; i < to; i++) {
        const prev = upTips[i - 1], curr = upTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.lineTo(upTips[to - 1].x, dnTips[to - 1].y);
      for (let i = to - 2; i >= from; i--) {
        const prev = dnTips[i + 1], curr = dnTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineW;
      ctx.stroke();
    };

    const splitIdx = upTips.findIndex(t => t.x > playX);
    const playedEnd = splitIdx >= 0 ? splitIdx + 1 : upTips.length;

    if (playedEnd > 1) {
      drawShape(0, playedEnd, playedColor, playedColor, 2.5);
    }

    if (playedEnd >= 2 && playedEnd < upTips.length) {
      const midC = 'rgba(' +
        Math.round(played[0] * 0.55 + greyR * 0.45) + ',' +
        Math.round(played[1] * 0.55 + greyG * 0.45) + ',' +
        Math.round(played[2] * 0.55 + greyB * 0.45) + ',0.45)';
      drawShape(playedEnd - 1, playedEnd + 1, midC, midC, 1.5);
    }

    if (playedEnd + 1 < upTips.length) {
      const unplayedFill = 'rgba(' + greyR + ',' + greyG + ',' + greyB + ',0.28)';
      drawShape(playedEnd, upTips.length, unplayedFill, unplayedFill, 1);
    }
  },

   _paintWaveformSquiggleScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const mid = h / 2;
    const maxH = (h / 2 - 2) * scale;
    const playX = (playingPoint / data.length) * w;
    const offsetX = (w - totalWidth) / 2;
    const per = pw + pg;
    const dpr = window.devicePixelRatio || 1;

    const played = this._colorToRGBA(ctx, playedColor, '#D4F040');
    const hoverC = this._colorToRGBA(ctx, hoverPlayed, 'rgba(212,240,64,0.55)');

    const greyR = Math.round(played[0] * 0.35 + 128 * 0.65);
    const greyG = Math.round(played[1] * 0.35 + 128 * 0.65);
    const greyB = Math.round(played[2] * 0.35 + 128 * 0.65);

    const hov = hoverX >= 0;
    const hLo = hov ? Math.min(playX, hoverX) : 0;
    const hHi = hov ? Math.max(playX, hoverX) : -1;

    ctx.clearRect(0, 0, w, h);

    const upTips = [];
    const dnTips = [];
    for (let i = 0; i < data.length; i++) {
      const barVal = data[i] / 100;
      const barH = Math.max(2, barVal * maxH);
      const x = offsetX + i * per + pw / 2;
      upTips.push({ x, y: mid - barH });
      dnTips.push({ x, y: mid + barH });
    }

    if (upTips.length < 2) return;

    const fadeBars = Math.max(2, Math.round(data.length * 0.015));

    const drawShape = (from, to, fillColor, strokeColor, lineW) => {
      if (to - from < 2) return;
      ctx.beginPath();
      ctx.moveTo(upTips[from].x, upTips[from].y);
      for (let i = from + 1; i < to; i++) {
        const prev = upTips[i - 1], curr = upTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.lineTo(upTips[to - 1].x, dnTips[to - 1].y);
      for (let i = to - 2; i >= from; i--) {
        const prev = dnTips[i + 1], curr = dnTips[i];
        const cpx = (prev.x + curr.x) / 2;
        ctx.bezierCurveTo(cpx, prev.y, cpx, curr.y, curr.x, curr.y);
      }
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineW;
      ctx.stroke();
    };

    const splitIdx = upTips.findIndex(t => t.x > playX);
    const playedEnd = splitIdx >= 0 ? splitIdx + 1 : upTips.length;

    if (playedEnd > 1) {
      drawShape(0, playedEnd, playedColor, playedColor, 2.5 * dpr);
    }

    if (playedEnd >= 2 && playedEnd < upTips.length) {
      const midC = 'rgba(' +
        Math.round(played[0] * 0.55 + greyR * 0.45) + ',' +
        Math.round(played[1] * 0.55 + greyG * 0.45) + ',' +
        Math.round(played[2] * 0.55 + greyB * 0.45) + ',0.45)';
      drawShape(playedEnd - 1, playedEnd + 1, midC, midC, 1.5 * dpr);
    }

    if (playedEnd + 1 < upTips.length) {
      const unplayedFill = 'rgba(' + greyR + ',' + greyG + ',' + greyB + ',0.28)';
      drawShape(playedEnd, upTips.length, unplayedFill, unplayedFill, 1 * dpr);
    }

    if (hov) {
      const hStart = upTips.findIndex(t => t.x >= hLo);
      const hEnd = upTips.findIndex(t => t.x > hHi);
      const hoverFrom = Math.max(0, hStart);
      const hoverTo = hEnd >= 0 ? hEnd + 1 : upTips.length;
      if (hoverTo - hoverFrom >= 2) {
        drawShape(hoverFrom, hoverTo, 'rgba(' + hoverC[0] + ',' + hoverC[1] + ',' + hoverC[2] + ',0.2)', 'rgba(' + hoverC[0] + ',' + hoverC[1] + ',' + hoverC[2] + ',0.6)', 2 * dpr);
      }
    }
  },

  async _doBulkImport() {
    const input = document.getElementById('bulk-import-input');
    if (!input || !input.value.trim()) return;
    try {
      const result = await Api.bulkImport(input.value);
      this._showToast(result.queued + ' tracks queued');
      input.value = '';
    } catch (e) {
      this._showToast('Bulk import failed');
    }
  },

  _renderSettingsLocked() {
    const html = '<div class="settings-lock">'
      + '<div class="settings-lock-icon">' + Icons.settings() + '</div>'
      + '<div class="settings-lock-title">Settings</div>'
      + '<div class="settings-lock-desc">Enter password to continue</div>'
      + '<div class="settings-lock-form">'
      + '<input type="password" id="settings-password" class="settings-lock-input" placeholder="Password" autocomplete="off">'
      + '<button id="settings-unlock-btn" class="settings-btn settings-btn-primary">Unlock</button>'
      + '</div>'
      + '<div id="settings-lock-error" class="settings-lock-error hidden">Incorrect password</div>'
      + '</div>';
    this.els.content.innerHTML = html;

    const input = document.getElementById('settings-password');
    const btn = document.getElementById('settings-unlock-btn');
    const error = document.getElementById('settings-lock-error');

    const tryUnlock = () => {
      if (input.value === 'pancake') {
        this._settingsUnlocked = true;
        this.renderSettings();
      } else {
        error.classList.remove('hidden');
        input.value = '';
        input.focus();
      }
    };

    btn.addEventListener('click', tryUnlock);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') tryUnlock();
      error.classList.add('hidden');
    });
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

  _homeLayoutDrag: { item: null, spacer: null, dragging: false, startX: 0, startY: 0, offsetY: 0, offsetX: 0, listLeft: 0 },

  _openHomepageLayoutModal() {
    const modal = document.getElementById('home-layout-modal');
    const body = document.getElementById('home-layout-body');
    if (!modal || !body) return;

    modal.classList.remove('hidden');

    const layout = Store.getHomeLayout();

    let html = '<div class="hl-hint">Drag to reorder</div>';
    html += '<div class="hl-sections" id="hl-sections">';
    layout.forEach((s, i) => {
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

  async _rescanLibrary() {
    const btn = document.getElementById('btn-rescan');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner" style="padding:0"></div><span>Scanning...</span>';
    try {
      const stats = await Api.scan();
      await Store.refreshLibrary();
      const msg = stats.scanned + ' files scanned' + (stats.added > 0 ? ', ' + stats.added + ' added' : '') + (stats.removed > 0 ? ', ' + stats.removed + ' removed' : '');
      this._showToast(msg);
    } catch (err) {
      this._showToast('Rescan failed');
    }
    btn.disabled = false;
    btn.innerHTML = Icons.refresh() + '<span>Rescan Library</span>';
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
        + '<input type="text" id="download-search" placeholder="Search songs..." style="width:100%;padding:10px 14px;background:var(--l2);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:14px;margin-bottom:8px">';

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
      + '<input class="search-input" id="history-search" type="text" placeholder="Search by track, artist, or album...">'
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

  renderTrackList(tracks, options) {
    const opts = options || {};
    const showArt = !!opts.showArt;
    const filterable = !!opts.filterable;
    const currentTrack = Player.getCurrentTrack();

    return '<div class="track-list">' + tracks.map((track) => {
      const isCurrent = currentTrack && currentTrack.id === track.id;
      const artHtml = showArt
        ? '<div class="track-art"><img src="' + Api.coverUrl(track.albumID) + '" alt=""></div>'
        : '';
      const rightHtml = isCurrent
        ? '<div class="eq"><div class="eqb" style="height:5px"></div><div class="eqb" style="height:11px"></div><div class="eqb" style="height:7px"></div></div>'
        : (track.duration ? '<div class="track-duration">' + this._formatTime(track.duration) + '</div>' : '');
      const artistAlbum = track.album
        ? this._esc(track.artist) + ' - ' + this._esc(track.album)
        : this._esc(track.artist);

      const cls = 'track-row' + (filterable ? ' lib-item' : '');
      const attrs = filterable
        ? ' data-title="' + this._esc(track.title) + '" data-subtitle="' + this._esc(track.artist + ' ' + (track.album || '')) + '"'
        : '';

      return '<div class="' + cls + '" data-track-id="' + track.id + '"' + attrs + '>'
        + artHtml
        + '<div class="track-info">'
        + '<div class="track-title' + (isCurrent ? ' on' : '') + '">' + this._esc(track.title) + '</div>'
        + '<div class="track-artist">' + artistAlbum + '</div>'
        + '</div>'
        + rightHtml
        + '<button class="track-more" aria-label="More">' + Icons.dots() + '</button>'
        + '</div>';
    }).join('') + '</div>';
  },

  updateMiniPlayer() {
    const track = Player.getCurrentTrack();
    if (!track) {
      this.els.miniPlayer.classList.add('hidden');
      this.els.miniPlayer.style.background = '';
      document.body.classList.remove('mini-player-visible');
      this._applyThemeColor(14, 14, 14);
      return;
    }

    this.els.miniPlayer.classList.remove('hidden');
    document.body.classList.add('mini-player-visible');

    this.els.miniArt.style.backgroundImage = 'url(' + Api.coverUrl(track.albumID) + ')';
    this.els.miniTitle.textContent = track.title;
    this.els.miniArtist.textContent = track.artist;
    this.els.miniPlayBtn.innerHTML = Player.playing ? Icons.pause() : Icons.play();

    const progress = Player.getProgress();
    this.els.miniProgress.style.setProperty('--progress', (progress.fraction * 100) + '%');
    this._applyMiniPlayerColor();
  },

  updateNowPlaying() {
    const track = Player.getCurrentTrack();
    if (!track) return;

    const newSrc = Api.coverUrl(track.albumID);
    const artChanged = !this._lastArtTrackId || this._lastArtTrackId !== track.id || this._lastArtAlbumId !== track.albumID || this._lastArtSrc !== newSrc;
    if (artChanged) {
      this._lastArtTrackId = track.id;
      this._lastArtAlbumId = track.albumID;
      this._lastArtSrc = newSrc;
      const art = this.els.npArt;
      const bg = this.els.npArtBg;
      if (!this.els.nowPlaying.classList.contains('hidden') && art.src && !art.src.endsWith('/') && art.src !== newSrc) {
        const preload = new Image();
        preload.src = newSrc;
        bg.src = art.src;
        bg.style.opacity = '1';
        art.style.opacity = '0';
        const doSwap = () => {
          art.src = newSrc;
          art.style.opacity = '0';
          bg.style.zIndex = '2';
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              art.style.opacity = '1';
              bg.style.opacity = '0';
              setTimeout(() => { bg.style.zIndex = '0'; }, 1000);
            });
          });
        };
        if (preload.complete) {
          setTimeout(doSwap, 400);
        } else {
          preload.onload = () => setTimeout(doSwap, 400);
          preload.onerror = () => setTimeout(doSwap, 400);
        }
      } else {
        art.src = newSrc;
      }
    }
    this.els.npTitle.textContent = track.title;
    this.els.npArtist.textContent = track.artist;

    const isFav = Store.isFavorite(track.id);
    this.els.npLikeBtn.innerHTML = isFav ? Icons.heartFilled() : Icons.heart();
    this.els.npLikeBtn.classList.toggle('active', isFav);

    const canDownload = Store.downloadsEnabled;
    if (this.els.npDownloadBtn) this.els.npDownloadBtn.style.display = canDownload ? '' : 'none';

    this.els.npPlay.innerHTML = Player.playing ? Icons.pause() : Icons.play();
    this.els.npShuffle.classList.toggle('active', Player.shuffle);
    this.els.npRepeat.classList.toggle('active', Player.repeat !== 'off');
    this.els.npRepeat.innerHTML = Player.repeat === 'one' ? Icons.repeatOne() : Icons.repeat();

    // Grey out prev/next when no track available in that direction
    const hasNext = Player.repeat !== 'off' || Player.currentIndex < Player.queue.length - 1;
    const hasPrev = Player.currentIndex > 0;
    this.els.npNext.style.opacity = hasNext ? '' : '0.3';
    this.els.npNext.style.pointerEvents = hasNext ? '' : 'none';
    // Prev always active — restarts current song if at start

    this.els.nowPlaying.classList.toggle('playing', Player.playing);

    if (this.els.npHeaderText) {
      const sourceName = Player.getSourceName();
      this.els.npHeaderText.textContent = sourceName || '';
    }

    this._applyNowPlayingBg();
    this._checkTitleOverflow();

    if (artChanged) {
      this._currentWaveformTrackId = track.id;
      this._loadWaveform(track);
    }

    if (typeof ReviewUI !== 'undefined') {
      ReviewUI.updateForTrack(track);
    }
  },

  _checkTitleOverflow() {
    const el = this.els.npTitle;
    if (!el) return;
    el.classList.remove('scrolling');
    el.style.removeProperty('--marquee-dur');
    el.style.removeProperty('--marquee-dist');
    if (el.scrollWidth > el.clientWidth + 4) {
      const dur = Math.max(6, el.scrollWidth / 60);
      const dist = el.scrollWidth - el.clientWidth;
      el.style.setProperty('--marquee-dur', dur + 's');
      el.style.setProperty('--marquee-dist', '-' + dist + 'px');
      el.classList.add('scrolling');
    }
  },

  updateSeekBar() {
    const progress = Player.getProgress();
    if (this.seeking) return;
    const fraction = progress.fraction;
    this._waveformProgress = fraction;
    this._paintWaveform(fraction);
    this.els.npTimeCurrent.textContent = this._formatTime(progress.current);
    this.els.npTimeTotal.textContent = this._formatTime(progress.duration);
    const pct = (fraction * 100) + '%';
    this.els.miniProgress.style.setProperty('--progress', pct);
  },

  _loadWaveform(track) {
    if (!track) return;

    const isFirstLoad = !this._waveformData || this._waveformData.length === 0;
    this._waveformProgress = 0;
    this._realWaveform = false;
    this._waveformRawPeaks = null;
    this._currentWaveformTrackId = track.id;
    this._waveformMorphFrom = null;
    this._waveformAnimProgress = 1;

    if (isFirstLoad) {
      this._waveformHeightScale = 0.3;
      this.els.waveformCanvas.classList.add('fading');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.els.waveformCanvas.classList.remove('fading');
          this._animateWaveformScale(1, 400);
        });
      });
    }

    this._generateWaveform(track.id);
    this._paintWaveform(this._waveformProgress || 0);

    const trackId = track.id;
    Api.getWaveform(trackId).then(data => {
      if (!data || !data.peaks || data.peaks.length === 0) return;
      const currentTrack = Player.getCurrentTrack();
      if (!currentTrack || currentTrack.id !== trackId) return;

      this._waveformRawPeaks = data.peaks;
      this._realWaveform = true;
      this._waveformHeightScale = 0.4;
      this._animateWaveformScale(1, 350);
      this._scaleWaveformData();
      this._paintWaveform(this._waveformProgress || 0);
    }).catch(() => {});
  },

  _animateWaveformScale(target, duration) {
    if (this._waveformScaleFrame) cancelAnimationFrame(this._waveformScaleFrame);
    if (this._waveformHeightScale == null) this._waveformHeightScale = 0;
    const from = this._waveformHeightScale;
    const delta = target - from;
    if (Math.abs(delta) < 0.001) {
      this._waveformHeightScale = target;
      this._paintWaveform(this._waveformProgress || 0);
      return;
    }
    const start = performance.now();
    const mass = 1;
    const stiffness = 120;
    const damping = 14;
    const omega = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    let scale = from;
    let velocity = 0;
    const dt = 1 / 60;
    const maxFrames = Math.ceil(duration / 16) + 60;
    let frame = 0;
    const tick = () => {
      const springForce = stiffness * (target - scale);
      const dampForce = -damping * velocity;
      const accel = (springForce + dampForce) / mass;
      velocity += accel * dt;
      scale += velocity * dt;
      this._waveformHeightScale = scale;
      this._paintWaveform(this._waveformProgress || 0);
      frame++;
      const settled = Math.abs(scale - target) < 0.002 && Math.abs(velocity) < 0.01;
      if (!settled && frame < maxFrames) {
        this._waveformScaleFrame = requestAnimationFrame(tick);
      } else {
        this._waveformHeightScale = target;
        this._paintWaveform(this._waveformProgress || 0);
      }
    };
    this._waveformScaleFrame = requestAnimationFrame(tick);
  },

  _getWaveformBarSizes() {
    const w = window.innerWidth;
    if (w < 480) return { pw: 1, pg: 1 };
    if (w < 768) return { pw: 2, pg: 1 };
    return { pw: 3, pg: 1 };
  },

  _scaleWaveformData() {
    if (!this._waveformRawPeaks) return;
    const canvas = this.els.waveformCanvas;
    if (!canvas) return;

    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const { pw, pg } = this._getWaveformBarSizes();
    const numBars = Math.floor(w / (pw + pg));
    const raw = this._waveformRawPeaks;
    const data = [];
    for (let i = 0; i < numBars; i++) {
      const idx = (i / numBars) * raw.length;
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, raw.length - 1);
      const frac = idx - lo;
      const val = raw[lo] * (1 - frac) + raw[hi] * frac;
      data.push(Math.max(8, Math.min(100, Math.round(val * 100))));
    }
    this._waveformData = data;
    this._waveformPointWidth = pw;
    this._waveformPointGap = pg;
  },

  _generateWaveform(trackId) {
    const canvas = this.els.waveformCanvas;
    if (!canvas) return;

    const container = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const { pw, pg } = this._getWaveformBarSizes();
    const numPoints = Math.floor(w / (pw + pg));

    const data = [];
    for (let i = 0; i < numPoints; i++) {
      data.push(12);
    }

    this._waveformData = data;
    this._waveformPointWidth = pw;
    this._waveformPointGap = pg;
  },

  _paintWaveform(progressFraction) {
    const canvas = this.els.waveformCanvas;
    if (!canvas || !this._waveformData.length) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const data = this._waveformData;
    const pw = this._waveformPointWidth * (window.devicePixelRatio || 1);
    const pg = this._waveformPointGap * (window.devicePixelRatio || 1);
    const totalWidth = data.length * (pw + pg);

    const styleComp = getComputedStyle(document.documentElement);
    const playedColor = styleComp.getPropertyValue('--waveform-played').trim() || '#D4F040';
    const unplayedColor = styleComp.getPropertyValue('--waveform-unplayed').trim() || 'rgba(255, 255, 255, 0.22)';
    const hoverPlayed = styleComp.getPropertyValue('--waveform-hover').trim() || 'rgba(212, 240, 64, 0.8)';
    const hoverUnplayed = 'rgba(255,255,255,0.45)';

    ctx.clearRect(0, 0, w, h);

    const playingPoint = progressFraction * data.length;
    const hoverX = this._waveformHoverX >= 0 ? this._waveformHoverX * (window.devicePixelRatio || 1) : -1;
    const scale = this._waveformHeightScale != null ? this._waveformHeightScale : 1;
    const wfStyle = Store.waveformStyle;

    if (wfStyle === 'mirror') {
      this._paintWaveformMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else if (wfStyle === 'layered') {
      this._paintWaveformLayeredScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else if (wfStyle === 'layered-mirror') {
      this._paintWaveformLayeredMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else if (wfStyle === 'squiggle') {
      this._paintWaveformSquiggleScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    } else {
      this._paintWaveformRoundedScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth);
    }
  },

  _paintWaveformRoundedScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const barH = (val / 100) * h * 0.85 * scale;
      const x = (w - totalWidth) / 2 + i * (pw + pg);
      const y = (h - barH) / 2;

      const isPlayed = i < playingPoint;
      const isHovered = hoverX >= 0 && x <= hoverX && hoverX <= x + pw;

      if (isHovered) {
        ctx.fillStyle = isPlayed ? hoverPlayed : hoverUnplayed;
      } else if (isPlayed) {
        ctx.fillStyle = playedColor;
      } else {
        ctx.fillStyle = unplayedColor;
      }

      const radius = Math.min(pw / 2, barH / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + pw - radius, y);
      ctx.arcTo(x + pw, y, x + pw, y + radius, radius);
      ctx.lineTo(x + pw, y + barH - radius);
      ctx.arcTo(x + pw, y + barH, x + pw - radius, y + barH, radius);
      ctx.lineTo(x + radius, y + barH);
      ctx.arcTo(x, y + barH, x, y + barH - radius, radius);
      ctx.lineTo(x, y + radius);
      ctx.arcTo(x, y, x + radius, y, radius);
      ctx.closePath();
      ctx.fill();
    }
  },

  _paintWaveformMirrorScaled(ctx, data, pw, pg, w, h, playingPoint, scale, playedColor, unplayedColor, hoverPlayed, hoverUnplayed, hoverX, totalWidth) {
    const mid = h * 0.68;
    const gap = Math.max(1, h * 0.02);
    for (let i = 0; i < data.length; i++) {
      const val = data[i];
      const topH = (val / 100) * mid * 0.92 * scale;
      const botH = (val / 100) * (h - mid) * 0.92 * scale;
      const x = (w - totalWidth) / 2 + i * (pw + pg);

      const isPlayed = i < playingPoint;
      const isHovered = hoverX >= 0 && x <= hoverX && hoverX <= x + pw;

      let topColor, botColorStart;
      if (isHovered) {
        topColor = isPlayed ? hoverPlayed : hoverUnplayed;
        botColorStart = isPlayed ? this._colorAlpha(hoverPlayed, 0.5) : this._colorAlpha(hoverUnplayed, 0.2);
      } else if (isPlayed) {
        topColor = playedColor;
        botColorStart = this._colorAlpha(playedColor, 0.5);
      } else {
        topColor = unplayedColor;
        botColorStart = this._colorAlpha(unplayedColor, 0.2);
      }

      const rTop = Math.min(pw / 2, topH / 2);
      ctx.fillStyle = topColor;
      ctx.beginPath();
      ctx.moveTo(x + rTop, mid - gap - topH);
      ctx.lineTo(x + pw - rTop, mid - gap - topH);
      ctx.arcTo(x + pw, mid - gap - topH, x + pw, mid - gap - topH + rTop, rTop);
      ctx.lineTo(x + pw, mid - gap);
      ctx.lineTo(x, mid - gap);
      ctx.lineTo(x, mid - gap - topH + rTop);
      ctx.arcTo(x, mid - gap - topH, x + rTop, mid - gap - topH, rTop);
      ctx.closePath();
      ctx.fill();

      const rBot = Math.min(pw / 2, botH / 2);
      const botTop = mid + gap;
      const botBot = mid + gap + botH;
      const grad = ctx.createLinearGradient(0, botTop, 0, botBot);
      grad.addColorStop(0, botColorStart);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x, botTop);
      ctx.lineTo(x + pw, botTop);
      ctx.lineTo(x + pw, botBot - rBot);
      ctx.arcTo(x + pw, botBot, x + pw - rBot, botBot, rBot);
      ctx.lineTo(x + rBot, botBot);
      ctx.arcTo(x, botBot, x, botBot - rBot, rBot);
      ctx.lineTo(x, botTop);
      ctx.closePath();
      ctx.fill();
    }
  },

  showNowPlaying() {
    this.updateNowPlaying();
    const track = Player.getCurrentTrack();
    this._loadWaveform(track);
    this.updateSeekBar();
    this._renderQueue();
    this.els.nowPlaying.style.animation = '';
    this.els.nowPlaying.classList.remove('hidden');
    this.els.miniPlayer.classList.add('hidden');
    this._applyNowPlayingBg();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    if (window.innerWidth >= 768) {
      this.els.queuePanel.classList.remove('hidden');
    }
  },

  hideNowPlaying() {
    const np = this.els.nowPlaying;
    np.style.animation = 'nowPlayingSlideDown 0.35s cubic-bezier(0.55, 0.06, 0.68, 0.19) forwards';
    np.addEventListener('animationend', () => {
      np.classList.add('hidden');
      np.style.animation = '';
      np.style.background = '';
    this._lastColorAlbumId = null;
    this._albumColor = null;
      document.documentElement.style.setProperty('--waveform-played', '#D4F040');
      document.documentElement.style.setProperty('--waveform-hover', 'rgba(212, 240, 64, 0.8)');
    }, { once: true });
    if (Player.getCurrentTrack()) {
      this.els.miniPlayer.classList.remove('hidden');
    }
    // Hide queue
    this.els.queuePanel.classList.add('hidden');
    // Restore active tab highlight
    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === Store.currentTab);
    });
  },

  showQueue() {
    this._renderQueue();
    this.els.queuePanel.classList.remove('hidden');
  },

  hideQueue() {
    const panel = this.els.queuePanel;
    panel.style.animation = 'panelSlideDownFade 0.25s cubic-bezier(0.4, 0, 1, 1) forwards';
    setTimeout(() => {
      panel.classList.add('hidden');
      panel.style.animation = '';
    }, 250);
  },

  updateQueueIfVisible() {
    this._renderQueue();
  },

  _renderQueue() {
    if (Player.queue.length === 0) {
      this.els.queueList.innerHTML = '<div class="empty-state"><div class="empty-state-title">Queue is empty</div><div class="empty-state-text">Play something to see it here</div></div>';
      return;
    }

    const sourceName = Player.getSourceName();
    const headerTitle = this.els.queuePanel.querySelector('.queue-header h2');
    if (headerTitle) headerTitle.textContent = sourceName || 'Playlist';

    this.els.queueList.innerHTML = Player.queue.map((track, i) => {
      const isCurrent = i === Player.currentIndex;
      const section = i < Player.currentIndex ? 'history' : 'upnext';
      return '<div class="queue-item queue-item-' + section + (isCurrent ? ' active' : '') + '" data-queue-index="' + i + '">'
        + (section !== 'history' ? '<div class="queue-item-drag" aria-label="Drag to reorder">' + Icons.grip() + '</div>' : '')
        + '<div class="queue-item-art"><img src="' + Api.coverUrl(track.albumID) + '" alt=""></div>'
        + '<div class="queue-item-info">'
        + '<div class="queue-item-title">' + this._esc(track.title) + '</div>'
        + '<div class="queue-item-artist">' + this._esc(track.artist) + '</div>'
        + '</div>'
        + '<button class="queue-item-more" aria-label="More">' + Icons.more() + '</button>'
        + '</div>';
    }).join('');

    const historyItems = this.els.queueList.querySelectorAll('.queue-item-history');
    if (historyItems.length > 0) {
      const wrapper = document.createElement('div');
      wrapper.className = 'queue-history';
      const header = document.createElement('div');
      header.className = 'queue-history-header';
      header.innerHTML = '<span class="queue-history-label">' + Icons.clock() + ' History</span><span class="queue-history-badge">' + historyItems.length + '</span>' + Icons.chevronDown();
      wrapper.appendChild(header);
      const body = document.createElement('div');
      body.className = 'queue-history-body';
      historyItems.forEach(el => body.appendChild(el));
      wrapper.appendChild(body);
      this.els.queueList.insertBefore(wrapper, this.els.queueList.firstChild);

      header.addEventListener('click', () => {
        wrapper.classList.toggle('open');
      });
    }
  },

  showContextMenu(options, triggerEl) {
    this.els.contextMenuItems.innerHTML = options.map((opt, i) => {
      if (opt.type === 'divider') return '<div class="modal-divider"></div>';
      if (opt.type === 'label') return '<div class="modal-title">' + this._esc(opt.label) + '</div>';
      return '<div class="modal-option" data-menu-index="' + i + '">'
        + (opt.icon || '') + '<span>' + opt.label + '</span></div>';
    }).join('');
    this._contextMenuActions = options.map(o => o.action);
    this._contextMenuTrigger = triggerEl;
    this.els.contextMenu.classList.remove('hidden');

    this.els.contextMenu.style.background = 'transparent';

    const sheet = this.els.contextMenu.querySelector('.modal-sheet');
    sheet.style.removeProperty('top');
    sheet.style.removeProperty('bottom');
    sheet.style.removeProperty('left');
    sheet.style.removeProperty('right');

    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      const menuW = 240;
      sheet.offsetHeight;
      const menuH = sheet.scrollHeight;
      const pad = 8;

      let top = rect.bottom + 4;
      let left = rect.right - menuW;

      if (left < pad) left = rect.left;
      if (left + menuW > vpW - pad) left = vpW - menuW - pad;

      if (top + menuH > vpH - pad) {
        const aboveTop = rect.top - menuH - 4;
        if (aboveTop >= pad) {
          top = aboveTop;
        } else {
          top = Math.max(pad, vpH - menuH - pad);
        }
      }

      sheet.style.top = top + 'px';
      sheet.style.left = left + 'px';
    }
  },

  hideContextMenu() {
    this.els.contextMenu.classList.add('hidden');
    this._contextMenuActions = null;
    this._contextMenuTrigger = null;
  },

  showPlaylistModal(trackId) {
    this.playlistModalTrackId = trackId || null;
    if (trackId && Store.playlists.length > 0) {
      this.els.playlistModalList.innerHTML = Store.playlists.map(p =>
        '<div class="modal-list-item" data-playlist-id="' + p.id + '">'
        + Icons.queue()
        + '<span>' + this._esc(p.name) + '</span>'
        + '<span style="color:var(--text-muted);margin-left:auto;font-size:12px">' + p.trackIds.length + ' tracks</span></div>'
      ).join('');
    } else {
      this.els.playlistModalList.innerHTML = '';
    }
    this.els.createPlaylistBtn.style.display = '';
    const existingForm = this.els.playlistModal.querySelector('.modal-create-form');
    if (existingForm) existingForm.remove();
    this.els.playlistModal.classList.remove('hidden');
  },

  hidePlaylistModal() {
    this.els.playlistModal.classList.add('hidden');
    this.playlistModalTrackId = null;
  },

  showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    clearTimeout(this._toastTimer);
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  },

  updateTrackHighlights() {
    const current = Player.getCurrentTrack();
    if (!current) return;
    document.querySelectorAll('.track-row').forEach(row => {
      const isCurrent = row.dataset.trackId === current.id;
      const titleEl = row.querySelector('.track-title');
      const eqEl = row.querySelector('.eq');
      const durationEl = row.querySelector('.track-duration');
      if (titleEl) {
        titleEl.classList.toggle('on', isCurrent);
      }
      if (isCurrent && !eqEl && durationEl) {
        durationEl.remove();
        const eq = document.createElement('div');
        eq.className = 'eq';
        eq.innerHTML = '<div class="eqb" style="height:5px"></div><div class="eqb" style="height:11px"></div><div class="eqb" style="height:7px"></div>';
        row.appendChild(eq);
      } else if (!isCurrent && eqEl) {
        eqEl.remove();
        if (!durationEl) {
          const dur = document.createElement('div');
          dur.className = 'track-duration';
          const track = Store.getTrack(row.dataset.trackId);
          dur.textContent = this._formatTime(track ? track.duration : 0);
          row.appendChild(dur);
        }
      }
    });
    document.querySelectorAll('.queue-item').forEach(item => {
      const idx = parseInt(item.dataset.queueIndex);
      item.classList.toggle('active', idx === Player.currentIndex);
    });
  },

  _showArtistContextMenu(artistName, triggerEl) {
    this.showContextMenu([
      { label: 'Play All', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        const tracks = Store.getArtistTracks(artistName);
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'artist', name: artistName });
          this.showNowPlaying();
        }
      }},
      { label: 'Shuffle', icon: Icons.shuffle(), action: () => {
        this.hideContextMenu();
        const tracks = Store.getArtistTracks(artistName).slice().sort(() => Math.random() - 0.5);
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'artist', name: artistName });
          this.showNowPlaying();
        }
      }},
      { type: 'divider' },
      { label: 'Fetch Artist Image', icon: Icons.refresh(), action: async () => {
        this.hideContextMenu();
        this.showToast('Fetching artist image...');
        try {
          const res = await fetch('/api/artist-art-fetch/' + encodeURIComponent(artistName), { method: 'POST' });
          const data = await res.json();
          if (data.fetched) {
            this.showToast('Artist image updated');
            this.renderArtist(artistName);
          } else {
            this.showToast('No image found for this artist');
          }
        } catch (err) {
          this.showToast('Failed to fetch artist image');
        }
      }},
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?artist=' + encodeURIComponent(artistName);
        if (navigator.share) {
          try { await navigator.share({ title: artistName, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }}
    ], triggerEl);
  },

  _showAlbumContextMenu(albumId, triggerEl) {
    const album = Store.getAlbum(albumId);
    if (!album) return;
    const tracks = Store.getAlbumTracks(albumId);
    this.showContextMenu([
      { label: 'Play', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'album', name: album.name, id: albumId });
          this.showNowPlaying();
        }
      }},
      { label: 'Shuffle', icon: Icons.shuffle(), action: () => {
        this.hideContextMenu();
        const shuffled = tracks.slice().sort(() => Math.random() - 0.5);
        if (shuffled.length > 0) {
          Player.play(shuffled[0], shuffled, { type: 'album', name: album.name, id: albumId });
          this.showNowPlaying();
        }
      }},
      { type: 'divider' },
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?album=' + encodeURIComponent(albumId);
        if (navigator.share) {
          try { await navigator.share({ title: album.name, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }}
    ], triggerEl);
  },

  _showPlaylistContextMenu(playlistId, triggerEl) {
    const playlist = Store.getPlaylist(playlistId);
    if (!playlist) return;
    const tracks = playlist.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
    this.showContextMenu([
      { label: 'Play', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        if (tracks.length > 0) {
          Player.play(tracks[0], tracks, { type: 'playlist', name: playlist.name, id: playlistId });
          this.showNowPlaying();
        }
      }},
      { label: 'Shuffle', icon: Icons.shuffle(), action: () => {
        this.hideContextMenu();
        const shuffled = tracks.slice().sort(() => Math.random() - 0.5);
        if (shuffled.length > 0) {
          Player.play(shuffled[0], shuffled, { type: 'playlist', name: playlist.name, id: playlistId });
          this.showNowPlaying();
        }
      }},
      { type: 'divider' },
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?playlist=' + encodeURIComponent(playlistId);
        const shareTitle = playlist.name || 'Playlist';
        if (navigator.share) {
          try { await navigator.share({ title: shareTitle, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }},
      { label: 'Rename', icon: Icons.edit(), action: () => {
        this.hideContextMenu();
        const newName = prompt('Playlist name:', playlist.name);
        if (!newName || !newName.trim() || newName.trim() === playlist.name) return;
        Api.updatePlaylist(playlistId, { name: newName.trim() }).then(() => {
          Store.refreshPlaylists().then(() => {
            this.renderPage();
            this.showToast('Playlist renamed');
          });
        }).catch(() => {
          this.showToast('Failed to rename playlist');
        });
      }},
      { label: 'Delete', icon: Icons.trash(), action: async () => {
        this.hideContextMenu();
        if (!confirm('Delete this playlist?')) return;
        try {
          await Api.deletePlaylist(playlistId);
          await Store.refreshPlaylists();
          this.navigateBack();
          this.showToast('Playlist deleted');
        } catch (err) {
          console.error('Delete playlist failed:', err);
          this.showToast('Failed to delete playlist');
        }
      }}
    ], triggerEl);
  },

  _showTrackContextMenu(trackId, triggerEl) {
    const track = Store.getTrack(trackId);
    if (!track) return;
    this.contextTrackId = trackId;
    const isFav = Store.isFavorite(trackId);
    const menuItems = [
      { label: 'Add to Queue', icon: Icons.queue(), action: () => {
        this.hideContextMenu();
        Player.addToQueue(track);
        this.showToast('Added to queue');
      }},
      { label: 'Add to Playlist', icon: Icons.plus(), action: () => {
        this.hideContextMenu();
        this.showPlaylistModal(trackId);
      }},
      { label: 'Rescan Metadata', icon: Icons.search(), action: async () => {
        this.hideContextMenu();
        this._showRescanModal(trackId);
      }},
      { label: 'Edit Metadata', icon: Icons.edit(), action: () => {
        this.hideContextMenu();
        ReviewUI.showEditMetaModal(trackId);
      }},
      { type: 'divider' },
      { label: 'Go to Album', icon: Icons.library(), action: () => {
        this.hideContextMenu();
        this.navigateTo('album', { albumId: track.albumID });
      }},
      { label: 'Go to Artist', icon: Icons.music(), action: () => {
        this.hideContextMenu();
        this.navigateTo('artist', { artistName: track.artist });
      }},
      { type: 'divider' },
      { label: 'Save File', icon: Icons.download(), action: () => {
        this.hideContextMenu();
        const ext = track.filePath ? '.' + track.filePath.split('.').pop() : '';
        const a = document.createElement('a');
        a.href = Api.downloadUrl(trackId);
        a.download = (track.artist ? track.artist + ' - ' : '') + (track.title || 'track') + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }},
      { type: 'divider' },
      { label: isFav ? 'Remove from Favorites' : 'Add to Favorites', icon: isFav ? Icons.heartFilled() : Icons.heart(), action: async () => {
        try {
          await Api.toggleFavorite(trackId);
          await Store.refreshFavorites();
          this.hideContextMenu();
          this.renderPage();
          this.updateNowPlaying();
          this.showToast(isFav ? 'Removed from favorites' : 'Added to favorites');
        } catch (err) {
          this.hideContextMenu();
          this.showToast('Failed to update favorites');
        }
      }}
    ];

    // If viewing a playlist, offer "Remove from Playlist"
    if (Store.currentView === 'playlist' && Store.viewData.playlistId) {
      const playlist = Store.getPlaylist(Store.viewData.playlistId);
      if (playlist && playlist.trackIds.includes(trackId)) {
        menuItems.push({ type: 'divider' });
        menuItems.push({ label: 'Remove from Playlist', icon: Icons.trash(), action: async () => {
          this.hideContextMenu();
          try {
            await Api.removeTrackFromPlaylist(Store.viewData.playlistId, trackId);
            await Store.refreshPlaylists();
            this.renderPage();
            this.showToast('Removed from playlist');
          } catch (err) {
            this.showToast('Failed to remove track');
          }
        }});
      }
    }

    this.showContextMenu(menuItems, triggerEl);
  },

  _showQueueItemContextMenu(index, triggerEl) {
    const track = Player.queue[index];
    if (!track) return;
    const menuItems = [
      { label: 'Remove from Queue', icon: Icons.trash(), action: () => {
        this.hideContextMenu();
        Player.removeFromQueue(index);
      }},
      { label: 'Play Next', icon: Icons.play(), action: () => {
        this.hideContextMenu();
        if (index === Player.currentIndex) return;
        const t = Player.queue.splice(index, 1)[0];
        const insertAt = Player.currentIndex + 1;
        Player.queue.splice(insertAt, 0, t);
        if (index < Player.currentIndex) {
          Player.currentIndex--;
        }
        if (Player.onQueueChange) Player.onQueueChange();
      }},
      { type: 'divider' },
      { label: 'Go to Album', icon: Icons.library(), action: () => {
        this.hideContextMenu();
        this.hideQueue();
        this.navigateTo('album', { albumId: track.albumID });
      }},
      { label: 'Go to Artist', icon: Icons.music(), action: () => {
        this.hideContextMenu();
        this.hideQueue();
        this.navigateTo('artist', { artistName: track.artist });
      }},
      { type: 'divider' },
      { label: 'Share', icon: Icons.share(), action: async () => {
        this.hideContextMenu();
        const shareUrl = window.location.origin + '/?track=' + encodeURIComponent(track.id);
        if (navigator.share) {
          try { await navigator.share({ title: track.title, url: shareUrl }); } catch (e) { if (e.name !== 'AbortError') this.showToast('Share failed'); }
        } else {
          try { await navigator.clipboard.writeText(shareUrl); this.showToast('Link copied'); } catch (e) { this.showToast('Share not supported'); }
        }
      }},
      { label: 'Add to Playlist', icon: Icons.plus(), action: () => {
        this.hideContextMenu();
        this.showPlaylistModal(track.id);
      }},
      { type: 'divider' },
      { label: 'Save File', icon: Icons.download(), action: () => {
        this.hideContextMenu();
        const ext = track.filePath ? '.' + track.filePath.split('.').pop() : '';
        const a = document.createElement('a');
        a.href = Api.downloadUrl(track.id);
        a.download = (track.artist ? track.artist + ' - ' : '') + (track.title || 'track') + ext;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }}
    ];

    this.showContextMenu(menuItems, triggerEl);
  },

  async _showRescanModal(trackId) {
    const track = Store.getTrack(trackId);
    if (!track) return;

    const modal = document.getElementById('rescan-modal');
    const list = document.getElementById('rescan-modal-list');
    const title = document.getElementById('rescan-modal-title');
    const searchInput = document.getElementById('rescan-search-input');
    const searchBtn = document.getElementById('rescan-search-btn');

    const initialQuery = [track.artist, track.title].filter(Boolean).join(' - ');
    searchInput.value = initialQuery;
    title.textContent = this._esc(track.title);

    const renderCandidates = (candidates) => {
      if (!candidates || candidates.length === 0) {
        list.innerHTML = this._emptyState('No matches found', 'Try a different search', Icons.search());
        return;
      }

      let html = '<div class="rescan-your-track">'
        + '<div class="rescan-label">Your Track</div>'
        + '<div class="rescan-your-title">' + this._esc(track.title) + '</div>'
        + '<div class="rescan-your-artist">' + this._esc(track.artist) + '</div>'
        + '</div>';

      candidates.forEach(c => {
        const pct = Math.round(c.score * 100);
        const cls = pct >= 80 ? 'score-high' : pct >= 50 ? 'score-mid' : 'score-low';
        const art = c.albumId ? '<img src="/api/finder/cover/' + c.albumId + '" alt="" onerror="this.style.display=\'none\'">' : '';
        const coverBadge = c.hasCover ? ' <span style="color:var(--accent);font-size:10px">&#10003; cover</span>' : '';
        html += '<div class="rescan-candidate" data-title="' + this._esc(c.title) + '" data-artist="' + this._esc(c.artist) + '" data-album="' + this._esc(c.album) + '" data-album-id="' + (c.albumId || '') + '">'
          + (art ? '<div class="rescan-candidate-art">' + art + '</div>' : '')
          + '<div class="rescan-candidate-info">'
          + '<div class="rescan-candidate-title">' + this._esc(c.title) + '</div>'
          + '<div class="rescan-candidate-artist">' + this._esc(c.artist) + '</div>'
          + '<div class="rescan-candidate-album">' + this._esc(c.album || '—') + coverBadge + '</div>'
          + '</div>'
          + '<span class="review-score ' + cls + '">' + pct + '%</span>'
          + '</div>';
      });

      list.innerHTML = html;

      list.querySelectorAll('.rescan-candidate').forEach(el => {
        el.addEventListener('click', async () => {
          const newTitle = el.dataset.title;
          const newArtist = el.dataset.artist;
          const newAlbum = el.dataset.album;
          const newAlbumId = el.dataset.albumId;

          const result = await Api.metadataUpdateTrack(trackId, {
            title: newTitle,
            artist: newArtist,
            album: newAlbum,
            albumArtist: newArtist,
            albumId: newAlbumId
          });

          if (!result) {
            this.showToast('Failed to update metadata');
            return;
          }

          await Store.refreshLibrary();
          modal.classList.add('hidden');
          this.showToast('Metadata updated');
          this.renderPage();
          if (Player.getCurrentTrack() && Player.getCurrentTrack().id === trackId) {
            const fresh = Store.getTrack(trackId);
            if (fresh) {
              Object.assign(Player.getCurrentTrack(), fresh);
              this.updateNowPlaying();
            }
          }
          ReviewUI.updateForTrack(trackId);
        });
      });
    };

    const doSearch = async (query) => {
      if (!query.trim()) return;
      title.textContent = 'Searching...';
      list.innerHTML = '<div class="loading-spinner" style="margin:24px auto"></div>';
      try {
        const candidates = await Api.metadataSearch(query);
        title.textContent = this._esc(track.title);
        renderCandidates(candidates);
      } catch (err) {
        title.textContent = this._esc(track.title);
        list.innerHTML = this._emptyState('Search failed', 'Could not reach MusicBrainz', Icons.xCircle());
      }
    };

    searchBtn.onclick = () => doSearch(searchInput.value);
    searchInput.onkeydown = (e) => { if (e.key === 'Enter') doSearch(searchInput.value); };

    modal.classList.remove('hidden');
    doSearch(initialQuery);
  },

  _handleAction(action) {
    if (!action) return;
    if (action === 'favorites') {
      this.navigateTo('favorites');
      return;
    }
    if (action === 'all-music') {
      this.navigateTo('all-music');
      return;
    }
    if (action === 'create-playlist') {
      const row = document.querySelector('.list-item[data-action="create-playlist"]');
      if (row) this._showCreatePlaylistInline(row);
      return;
    }
    if (action === 'needs-review') {
      this.navigateTo('needs-review');
      return;
    }
    if (action === 'delete-review-all') {
      ReviewUI.deleteAllFlagged(() => this.renderNeedsReview());
      return;
    }
    if (action === 'shuffle' || action === 'shuffle-all') {
      let list = (this._viewTrackList && this._viewTrackList.length > 0)
        ? this._viewTrackList.slice()
        : Store.library.tracks.slice();
      if (list.length > 0) {
        const shuffled = list.sort(() => Math.random() - 0.5);
        const capped = shuffled.slice(0, 100);
        Player.shuffle = false;
        const source = (action === 'shuffle-all')
          ? { type: 'all', name: 'All Music' }
          : this._getViewSource();
        Player.play(capped[0], capped, source);
        this.showNowPlaying();
      }
      return;
    }
    if (action === 'shuffle-recent') {
      const sorted = Store.library.tracks.slice().sort((a, b) => (b.modTime || 0) - (a.modTime || 0));
      const recent = sorted.slice(0, 100);
      if (recent.length > 0) {
        for (let i = recent.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [recent[i], recent[j]] = [recent[j], recent[i]];
        }
        Player.play(recent[0], recent, { type: 'recent', name: 'Recently Added' });
        this.showNowPlaying();
      }
      return;
    }
    if (action === 'delete-playlist') {
      const playlistId = Store.viewData.playlistId;
      if (!playlistId) return;
      if (!confirm('Delete this playlist? This cannot be undone.')) return;
      Api.deletePlaylist(playlistId).then(async () => {
        await Store.refreshPlaylists();
        this.navigateBack();
        this.showToast('Playlist deleted');
      }).catch((err) => {
        console.error('Delete playlist failed:', err);
        this.showToast('Failed to delete playlist');
      });
      return;
    }
    if (action === 'share-playlist') {
      const pid = Store.viewData.playlistId || '';
      const playlist = Store.getPlaylist(pid);
      const shareTitle = playlist ? playlist.name : 'Playlist';
      const shareUrl = window.location.origin + '/?playlist=' + encodeURIComponent(pid);
      if (navigator.share) {
        navigator.share({ title: shareTitle + ' — Music Playlist', url: shareUrl }).catch(() => {});
      } else {
        navigator.clipboard.writeText(shareUrl).then(() => this.showToast('Link copied')).catch(() => this.showToast('Share not supported'));
      }
      return;
    }
  },

  _showCreatePlaylistInline(row) {
    const form = document.createElement('div');
    form.className = 'list-item';
    form.style.cssText = 'gap:8px;padding:8px 16px;';
    form.innerHTML = '<input type="text" placeholder="Playlist name" style="flex:1;background:var(--l2);border:none;border-radius:8px;padding:8px 12px;color:var(--text-primary);font-size:14px;">'
      + '<button style="background:var(--accent);color:var(--text-primary);border-radius:8px;padding:8px 16px;font-size:14px;font-weight:600;">Create</button>';
    row.style.display = 'none';
    row.parentElement.insertBefore(form, row.nextSibling);
    const input = form.querySelector('input');
    const btn = form.querySelector('button');
    input.focus();
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        await Api.createPlaylist(name);
        await Store.refreshPlaylists();
        this.renderLibrary();
        this.showToast('Playlist created');
      } catch (err) {
        this.showToast('Failed to create playlist');
      }
    };
    btn.addEventListener('click', create);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
      if (e.key === 'Escape') {
        form.remove();
        row.style.display = '';
      }
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

  _applyMiniPlayerColor() {
    if (!this.els.miniPlayer || !this._albumColor) return;
    const { h, s, l } = this._albumColor;
    const vibS = Math.min(100, s + 35);
    const vibL = Math.min(65, Math.max(45, l + 10));
    const playedColor = 'hsl(' + h + ',' + vibS + '%,' + vibL + '%)';
    this.els.miniProgress.style.setProperty('--mini-progress-color', playedColor);
    this.els.miniPlayer.style.background = 'linear-gradient(135deg, hsl(' + h + ',' + Math.round(vibS * 0.4) + '%,' + Math.max(12, vibL * 0.18) + '%), hsl(' + h + ',' + Math.round(vibS * 0.2) + '%,' + Math.max(8, vibL * 0.1) + '%))';
    this.els.miniPlayer.style.setProperty('--mini-art-glow', playedColor);
  },

  _applyThemeColor(r, g, b) {
    const darkR = Math.round(r * 0.15);
    const darkG = Math.round(g * 0.15);
    const darkB = Math.round(b * 0.15);
    document.querySelector('meta[name="theme-color"]').content = 'rgb(' + darkR + ',' + darkG + ',' + darkB + ')';
  },

  _applyNowPlayingBg() {
    const track = Player.getCurrentTrack();
    const glow = document.getElementById('np-bg-glow');
    if (!track || !glow) {
      if (glow) glow.classList.remove('active');
      return;
    }
    if (track.albumID === this._lastColorAlbumId) return;
    this._lastColorAlbumId = track.albumID;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = this._colorCtx;
      const size = 10;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
      const r = Math.round(rSum / count);
      const g = Math.round(gSum / count);
      const b = Math.round(bSum / count);

      glow.style.backgroundColor = 'rgba(' + r + ',' + g + ',' + b + ',0.45)';
      glow.classList.add('active');

      const [h, s, l] = this.rgbToHsl(r, g, b);
      const vibS = Math.min(100, s + 35);
      const vibL = Math.min(65, Math.max(45, l + 10));
      document.documentElement.style.setProperty('--waveform-played', 'hsl(' + h + ',' + vibS + '%,' + vibL + '%)');
      document.documentElement.style.setProperty('--waveform-hover', 'hsl(' + h + ',' + vibS + '%,' + Math.min(80, vibL + 15) + '%)');
      document.documentElement.style.setProperty('--waveform-muted', 'hsl(' + h + ',' + Math.round(vibS * 0.35) + '%,' + Math.min(85, vibL + 30) + '%)');

      this._albumColor = { r, g, b, h, s, l };
      this._applyMiniPlayerColor();
      this._applyThemeColor(r, g, b);
    };
    img.onerror = () => {
      glow.classList.remove('active');
      this._albumColor = null;
      this._applyThemeColor(14, 14, 14);
    };
    img.src = Api.coverUrl(track.albumID);
  },

  _updateVolumeBar() {
    const pct = (Player.volume * 100) + '%';
    const icon = Player.volume === 0 ? Icons.volumeMute() : Icons.volume();
    if (this.els.volumeFill) this.els.volumeFill.style.width = pct;
    if (this.els.volumeBtn) this.els.volumeBtn.innerHTML = icon;
    if (this.els.queueVolumeFill) this.els.queueVolumeFill.style.width = pct;
    if (this.els.queueVolumeBtn) this.els.queueVolumeBtn.innerHTML = icon;
    if (this.els.miniVolumeFill) this.els.miniVolumeFill.style.width = pct;
    if (this.els.miniVolumeBtn) this.els.miniVolumeBtn.innerHTML = icon;
  }
};

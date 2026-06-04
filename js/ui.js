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

  init() {
    this._cacheDom();
    this._bindTabBar();
    this._bindMiniPlayer();
    this._bindNowPlaying();
    this._bindSeekBar();
    this._bindTopProgress();
    this._bindVolumeBar();
    this._bindQueuePanel();
    this._bindModals();
    this._bindContentEvents();
    this._colorCanvas = document.getElementById('color-sample-canvas');
    this._colorCtx = this._colorCanvas.getContext('2d', { willReadFrequently: true });
    this._lastColorAlbumId = null;
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
      npTitle: document.getElementById('np-title'),
      npArtist: document.getElementById('np-artist'),
      npLikeBtn: document.getElementById('np-like-btn'),
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
      queuePanel: document.getElementById('queue-panel'),
      queueList: document.getElementById('queue-list'),
      playlistModal: document.getElementById('playlist-modal'),
      playlistModalList: document.getElementById('playlist-modal-list'),
      createPlaylistBtn: document.getElementById('create-playlist-btn'),
      contextMenu: document.getElementById('context-menu'),
      contextMenuItems: document.getElementById('context-menu-items'),
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
        this.renderPage();
      });
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
      } else if (!e.target.closest('.mini-btn')) {
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
      this.showQueue();
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
      this.seeking = true;
      const f = getFraction(e);
      this._waveformProgress = f;
      this._paintWaveform(f);
    };

    const onMove = (e) => {
      if (!this.seeking) return;
      const f = getFraction(e);
      this._waveformProgress = f;
      this._paintWaveform(f);
    };

    const onEnd = (e) => {
      if (!this.seeking) return;
      this.seeking = false;
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
    document.addEventListener('touchmove', onMove, { passive: true });
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
      this._generateWaveform();
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
    const bindBar = (bar, fillEl) => {
      if (!bar) return;

      const getFraction = (e) => {
        const rect = bar.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      };

      const onStart = (e) => {
        this.volumeDragging = true;
        const f = getFraction(e);
        Player.setVolume(f);
        this._updateVolumeBar();
      };

      const onMove = (e) => {
        if (!this.volumeDragging) return;
        const f = getFraction(e);
        Player.setVolume(f);
        this._updateVolumeBar();
      };

      const onEnd = () => {
        this.volumeDragging = false;
      };

      bar.addEventListener('mousedown', onStart);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onEnd);
      bar.addEventListener('touchstart', onStart, { passive: true });
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onEnd);
    };

    bindBar(this.els.volumeBar, this.els.volumeFill);
    bindBar(this.els.queueVolumeBar, this.els.queueVolumeFill);
  },

  _bindQueuePanel() {
    document.querySelector('.queue-close').addEventListener('click', () => {
      this.hideQueue();
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
      this.hideQueue();
    });

    this.els.queueList.addEventListener('click', (e) => {
      const item = e.target.closest('.queue-item');
      if (!item) return;
      const index = parseInt(item.dataset.queueIndex);
      if (isNaN(index)) return;
      this._queueClickActive = true;
      Player.playInQueue(index);
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

      const seg = e.target.closest('.chip[data-filter]');
      if (seg) {
        this.libFilter = seg.dataset.filter;
        this.renderLibrary();
        return;
      }

      const viewToggle = e.target.closest('.lib-view-toggle');
      if (viewToggle) {
        this.viewMode = this.viewMode === 'list' ? 'grid' : 'list';
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

      const trow = e.target.closest('.track-row') || e.target.closest('.new-song-card');
      if (trow) {
        const trackId = trow.dataset.trackId;
        const track = Store.getTrack(trackId);
        if (track) {
          this._smartPlay(track);
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
            this._smartPlay(track);
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

      const actionBtn = e.target.closest('.action-btn');
      if (actionBtn) {
        this._handleAction(actionBtn.dataset.action);
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
                  try {
                    await Api.deletePlaylist(id);
                    await Store.refreshPlaylists();
                    this.renderLibrary();
                    this.showToast('Playlist deleted');
                  } catch (err) {
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
        const type = plrow.dataset.type;
        const id = plrow.dataset.id;
        if (type === 'album') this.navigateTo('album', { albumId: id });
        else if (type === 'artist') this.navigateTo('artist', { artistName: id });
        else if (type === 'playlist') this.navigateTo('playlist', { playlistId: id });
        return;
      }
    });
  },

  navigateTo(view, data) {
    Store.currentView = view;
    Store.viewData = data || {};
    this.renderPage();
    this.els.content.scrollTop = 0;
  },

  navigateBack() {
    Store.currentView = Store.currentTab;
    Store.viewData = {};
    this.renderPage();
  },

  renderPage() {
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
      case 'settings': this.renderSettings(); break;
      case 'metadata-review': this.renderMetadataReview(); break;
      default: this.renderHome();
    }
  },

  renderHome() {
    this._viewTrackList = [];
    let html = '';

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

    html += '<div class="mega-title"><span>Recently Played</span></div>';

    if (recentCards.length > 0 || currentTrack) {
      html += '<div class="quick-play-grid">';

      // Spot 1: All Music
      html += '<div class="quick-play-card quick-play-card-all" data-navigate="all-music">'
        + '<div class="quick-play-art" style="background:linear-gradient(135deg, var(--l3), var(--l2))">'
        + '<div class="quick-play-card-icon-text">ALL</div></div>'
        + '<div class="quick-play-title">All Music</div>'
        + '</div>';

      // Spots 2-8: 7 most recently played
      let addedRecent = 0;
      recentCards.forEach(c => {
        if (addedRecent >= 7) return;
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

      // Spot 9: Shuffle
      html += '<div class="quick-play-card quick-play-card-shuffle" data-action="shuffle-all">'
        + '<div class="quick-play-art" style="background:linear-gradient(135deg, var(--accent), #a8c830);display:flex;align-items:center;justify-content:center">'
        + '<svg viewBox="0 0 100 100" width="100%" height="100%">'
        + '<circle cx="28" cy="28" r="9" fill="#0A0A0A" opacity="0.6"/>'
        + '<circle cx="72" cy="28" r="9" fill="#0A0A0A" opacity="0.6"/>'
        + '<circle cx="50" cy="50" r="9" fill="#0A0A0A" opacity="0.6"/>'
        + '<circle cx="28" cy="72" r="9" fill="#0A0A0A" opacity="0.6"/>'
        + '<circle cx="72" cy="72" r="9" fill="#0A0A0A" opacity="0.6"/>'
        + '</svg>'
        + '</div>'
        + '<div class="quick-play-title">Shuffle</div>'
        + '</div>';

      html += '</div>';
    } else {
      html += '<div class="empty-state" style="padding:16px"><div class="empty-state-text" style="color:var(--text3)">Play some music to see your history</div></div>';
    }

    const allTracks = Store.library.tracks.slice();
    const newTracks = allTracks.filter(t => t.artist && t.artist !== '').sort((a, b) => (b.modTime || 0) - (a.modTime || 0)).slice(0, 6);
    if (newTracks.length > 0) {
      html += '<div class="mega-title"><span>New Songs</span></div>';
      html += '<div class="new-songs-grid">';
      newTracks.forEach(t => {
        html += '<div class="new-song-card" data-track-id="' + t.id + '">'
          + '<div class="new-song-art" style="background-image:url(' + Api.coverUrl(t.albumID) + ')"></div>'
          + '<div class="new-song-info">'
          + '<div class="new-song-title">' + this._esc(this._trackTitle(t)) + '</div>'
          + '<div class="new-song-artist">' + this._esc(this._trackArtist(t)) + '</div>'
          + '</div></div>';
      });
      html += '</div>';
    }

    const namedArtists = Store.library.artists.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    const newArtists = namedArtists.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0)).slice(0, 6);
    html += '<div class="mega-title"><span>Artists</span></div>';
    if (newArtists.length > 0) {
      html += '<div class="scroll-row" style="flex-wrap:nowrap">';
      newArtists.forEach(a => {
        html += '<div class="quick-play-card-inline" data-type="artist" data-id="' + this._esc(a.name) + '">'
          + '<div class="quick-play-art"></div>'
          + '<div class="quick-play-title">' + this._esc(a.name) + '</div>'
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="empty-state" style="padding:16px 22px">' + Icons.music() + '<div class="empty-state-title">No artists yet</div><div class="empty-state-text">Add tagged music files to see artists</div></div>';
    }

    const namedAlbums = Store.library.albums.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    html += '<div class="mega-title"><span>Albums</span></div>';
    if (namedAlbums.length > 0) {
      html += '<div class="scroll-row">';
      namedAlbums.forEach(a => {
        html += '<div class="card" data-album-id="' + a.id + '">'
          + '<div class="card-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
          + '<div class="card-title">' + this._esc(a.name) + '</div>'
          + '<div class="card-subtitle">' + this._esc(a.artist) + '</div>'
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="empty-state" style="padding:16px 22px">' + Icons.library() + '<div class="empty-state-title">No albums yet</div><div class="empty-state-text">Add tagged music files to see albums</div></div>';
    }

    if (Store.playlists.length > 0) {
      html += '<div class="mega-title"><span>Playlists</span></div>';
      Store.playlists.slice(0, 4).forEach(p => {
        const pTracks = p.trackIds.map(tid => Store.getTrack(tid)).filter(Boolean);
        html += '<div class="list-item" data-type="playlist" data-id="' + p.id + '">'
          + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">'
          + Icons.music() + '</div>'
          + '<div class="list-item-info">'
          + '<div class="list-item-title">' + this._esc(p.name) + '</div>'
          + '<div class="list-item-subtitle">' + pTracks.length + ' tracks</div>'
          + '</div></div>';
      });
    }

    const favTracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
    if (favTracks.length > 0) {
      html += '<div class="mega-title"><span>Liked Songs</span></div>';
      html += this.renderTrackList(favTracks.slice(0, 5), { showArt: true });
    }

    if (Store.library.tracks.length === 0) {
      html += this._emptyState('No music yet', 'Add music files and rescan to get started', Icons.music());
    }

    this.els.content.innerHTML = html;
  },

  renderSearch() {
    this._viewTrackList = [];
    let html = '<div class="page-header">'
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Search</span></div>'
      + '<div class="search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input" type="text" placeholder="Songs, artists, or albums" value="' + this._esc(this.searchQuery) + '">'
      + '</div>'
      + '<div id="search-results"></div>';

    if (!this.searchQuery && !this.searchGenre) {
      html += this._renderBrowseGrid();
    }

    this.els.content.innerHTML = html;

    const input = this.els.content.querySelector('.search-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
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
      const results = Store.library.tracks.filter(t => {
        const haystack = (t.title + ' ' + t.artist + ' ' + t.album + ' ' + (t.genre || '')).toLowerCase();
        return words.every(w => haystack.includes(w));
      }).sort((a, b) => {
        // Prioritize title matches, then artist, then album
        const aTitle = a.title.toLowerCase().includes(q) ? 3 : a.title.toLowerCase().split(/\s+/).some(w => words.includes(w)) ? 2 : 0;
        const bTitle = b.title.toLowerCase().includes(q) ? 3 : b.title.toLowerCase().split(/\s+/).some(w => words.includes(w)) ? 2 : 0;
        return bTitle - aTitle;
      });
      this._viewTrackList = results;
      if (results.length === 0) {
        container.innerHTML = this._emptyState('No results', 'Try different keywords', Icons.search());
      } else {
        let html = '<div class="detail-actions">'
          + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
          + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
          + '</div>';
        html += '<div class="search-results-header">' + results.length + ' result' + (results.length !== 1 ? 's' : '') + '</div>';
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
    const colorMap = {
      'pop': '#8b5cf6', 'rock': '#ef4444', 'hip-hop': '#f59e0b', 'hip hop': '#f59e0b',
      'electronic': '#06b6d4', 'jazz': '#22c55e', 'classical': '#a855f7',
      'r&b': '#ec4899', 'rhythm': '#ec4899', 'country': '#f97316',
      'metal': '#64748b', 'indie': '#14b8a6', 'folk': '#84cc16',
      'latin': '#eab308', 'blues': '#3b82f6', 'soul': '#d946ef',
      'punk': '#f43f5e', 'reggae': '#10b981', 'alternative': '#6366f1',
    };
    const found = {};
    Store.library.tracks.forEach(t => {
      if (t.genre && t.genre.trim()) {
        const key = t.genre.trim().toLowerCase();
        if (!found[key]) found[key] = t.genre.trim();
      }
    });
    const genres = Object.values(found).sort((a, b) => a.localeCompare(b));
    if (genres.length === 0) return '';
    return '<div class="browse-grid">' + genres.map(g => {
      const color = colorMap[g.toLowerCase()] || '#' + (Math.floor(Math.random()*4 + 4).toString(16)) + (Math.floor(Math.random()*8 + 4).toString(16)) + (Math.floor(Math.random()*8 + 4).toString(16));
      return '<div class="category-card" data-genre="' + this._esc(g) + '" style="background:' + color + '">' + this._esc(g) + '</div>';
    }).join('') + '</div>';
  },

  renderLibrary() {
    this._viewTrackList = [];
    let html = '<div class="library-header">'
      + '<h1>Your Library</h1>'
      + '<div class="library-header-actions">'
      + '<button class="lib-view-toggle">' + (this.viewMode === 'list' ? Icons.grid() : Icons.sort()) + '</button>'
      + '</div></div>'
      + '<div class="search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input lib-search-input" type="text" placeholder="Search your library...">'
      + '</div>'
      + '<div class="filter-chips">'
      + '<button class="chip' + (this.libFilter === 'playlists' ? ' active' : '') + '" data-filter="playlists">Playlists</button>'
      + '<button class="chip' + (this.libFilter === 'albums' ? ' active' : '') + '" data-filter="albums">Albums</button>'
      + '<button class="chip' + (this.libFilter === 'artists' ? ' active' : '') + '" data-filter="artists">Artists</button>'
      + '<button class="chip' + (this.libFilter === 'favorites' ? ' active' : '') + '" data-filter="favorites">Favorites</button>'
      + '</div>';

    switch (this.libFilter) {
      case 'playlists': html += this._renderLibPlaylists(); break;
      case 'albums': html += this._renderLibAlbums(); break;
      case 'artists': html += this._renderLibArtists(); break;
      case 'favorites': html += this._renderLibFavorites(); break;
    }

    this.els.content.innerHTML = html;

    const searchInput = this.els.content.querySelector('.lib-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (q.length >= 2) {
          Store.currentView = 'search';
          this.searchQuery = q;
          this.searchGenre = '';
          this.renderSearch();
          const tabItems = document.querySelectorAll('.tab-item');
          tabItems.forEach(t => {
            t.classList.toggle('active', t.dataset.tab === 'search');
          });
        }
      });
    }
  },

  _renderLibPlaylists() {
    let html = '<div class="list-item" data-action="favorites" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:rgba(212,240,64,.1);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.heartFilled() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title">Liked Songs</div>'
      + '<div class="list-item-subtitle">' + Store.favorites.length + ' songs</div></div></div>';

    html += '<div class="list-item" data-action="all-music" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.music() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title">All Music</div>'
      + '<div class="list-item-subtitle">' + Store.library.tracks.length + ' songs</div></div></div>';

    html += '<div class="list-item" data-action="create-playlist" style="cursor:pointer">'
      + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.plus() + '</div>'
      + '<div class="list-item-info"><div class="list-item-title" style="color:var(--accent)">Create Playlist</div></div></div>';

    if (Store.playlists.length === 0) {
      html += this._emptyState('No playlists yet', 'Create a playlist to organize your music', Icons.library());
    } else {
      Store.playlists.forEach(p => {
        html += '<div class="list-item" data-type="playlist" data-id="' + p.id + '">'
          + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">'
          + Icons.music() + '</div>'
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
        '<div class="card" data-album-id="' + a.id + '">'
        + '<div class="card-art"><img src="' + Api.coverUrl(a.id) + '" alt=""></div>'
        + '<div class="card-title">' + this._esc(a.name) + '</div>'
        + '<div class="card-subtitle">' + this._esc(a.artist) + '</div></div>'
      ).join('') + '</div>';
    }
    return albumsWithName.map(a =>
      '<div class="list-item" data-type="album" data-id="' + a.id + '">'
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
    return '<div class="prow" style="flex-wrap:wrap">' + artistsWithName.map(a =>
      '<div class="apill" data-type="artist" data-id="' + this._esc(a.name) + '">'
      + '<div class="apill-dot"></div>'
      + '<div class="apill-name">' + this._esc(a.name) + '</div>'
      + '<div style="font-size:12px;color:var(--text-muted)">' + a.albumCount + ' albums</div>'
      + '</div>'
    ).join('') + '</div>';
  },

  _renderLibFavorites() {
    const tracks = Store.favorites.map(id => Store.getTrack(id)).filter(Boolean);
    this._viewTrackList = tracks;
    if (tracks.length === 0) {
      return this._emptyState('No favorites yet', 'Songs you like will appear here', Icons.heart());
    }
    return this.renderTrackList(tracks, { showArt: true });
  },

  renderAllMusic() {
    const tracks = Store.library.tracks.slice();
    this._viewTrackList = tracks;

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">All Music</span></div>'
      + '<div class="detail-hero">'
      + '<div class="detail-hero-fallback-icon">' + Icons.music() + '</div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-title">All Music</div>'
      + '<div class="detail-hero-meta">' + tracks.length + ' tracks</div>'
      + '</div></div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>';

    if (tracks.length === 0) {
      html += this._emptyState('No music yet', 'Add music to your library to get started', Icons.music());
    } else {
      html += this.renderTrackList(tracks, { showArt: true });
    }

    this.els.content.innerHTML = html;
  },

  renderAlbum(albumId) {
    const album = Store.getAlbum(albumId);
    if (!album) {
      this.els.content.innerHTML = this._emptyState('Album not found', '', Icons.library());
      return;
    }
    const tracks = Store.getAlbumTracks(albumId);
    this._viewTrackList = tracks;

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Album</span></div>'
      + '<div class="detail-hero">'
      + '<div class="detail-hero-bg" style="background-image:url(' + Api.coverUrl(albumId) + ')"></div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-title">' + this._esc(album.name) + '</div>'
      + '<div class="detail-hero-subtitle">' + this._esc(album.artist) + '</div>'
      + '<div class="detail-hero-meta">' + (album.year ? album.year + ' · ' : '') + tracks.length + ' tracks</div>'
      + '</div></div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>'
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

    // Use first album cover as artist banner background
    const firstAlbum = albums.length > 0 ? albums[0] : null;
    const bgHtml = firstAlbum
      ? '<div class="detail-hero-bg" style="background-image:url(' + Api.coverUrl(firstAlbum.id) + ')"></div>'
      : '';

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Artist</span></div>'
      + '<div class="detail-hero">'
      + bgHtml
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-title">' + this._esc(name) + '</div>'
      + '<div class="detail-hero-meta">' + albums.length + ' albums · ' + tracks.length + ' tracks</div>'
      + '</div></div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>';

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
      + this.renderTrackList(tracks.slice(0, 30), { showArt: true });

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

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Playlist</span></div>'
      + '<div class="detail-hero">'
      + bgHtml
      + '<div class="detail-hero-fallback-icon">' + Icons.music() + '</div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-title">' + this._esc(playlist.name) + '</div>'
      + '<div class="detail-hero-meta">' + tracks.length + ' tracks</div>'
      + '</div></div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '<button class="detail-action-btn detail-action-btn-danger" data-action="delete-playlist">' + Icons.trash() + '</button>'
      + '</div>';

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

    // Use first track's album cover as banner if available
    const firstTrack = tracks.length > 0 ? tracks[0] : null;
    const bgHtml = firstTrack && firstTrack.albumID
      ? '<div class="detail-hero-bg" style="background-image:url(' + Api.coverUrl(firstTrack.albumID) + ')"></div>'
      : '';

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Favorites</span></div>'
      + '<div class="detail-hero">'
      + bgHtml
      + '<div class="detail-hero-fallback-icon">' + Icons.heartFilled() + '</div>'
      + '<div class="detail-hero-overlay"></div>'
      + '<div class="detail-hero-info">'
      + '<div class="detail-hero-title">Favorites</div>'
      + '<div class="detail-hero-meta">' + tracks.length + ' tracks</div>'
      + '</div></div>'
      + '<div class="detail-actions">'
      + '<button class="detail-play-btn">' + Icons.play() + '<span>Play</span></button>'
      + '<button class="detail-action-btn" data-action="shuffle">' + Icons.shuffle() + '<span>Shuffle</span></button>'
      + '</div>';

    if (tracks.length === 0) {
      html += this._emptyState('No favorites yet', 'Songs you like will appear here', Icons.heart());
    } else {
      html += this.renderTrackList(tracks, { showArt: true });
    }

    this.els.content.innerHTML = html;
  },

  renderSettings() {
    this._viewTrackList = [];
    let html = '<div class="page-header">'
      + '<span class="page-header-title" style="font-size:var(--fs-screen);font-weight:700;letter-spacing:var(--ls-tight)">Settings</span></div>';

    html += '<div class="settings-section">'
      + '<div class="settings-section-title">' + Icons.database() + ' MusicBrainz Metadata</div>'
      + '<div class="settings-section-desc">Match your tracks against MusicBrainz to fetch titles, artists, albums, and cover art.</div>'
      + '<div id="metadata-status" class="settings-status"></div>'
      + '<div class="settings-actions">'
      + '<button class="settings-btn settings-btn-primary" id="btn-meta-scan">' + Icons.refresh() + '<span>Scan Metadata</span></button>'
      + '<button class="settings-btn" id="btn-meta-review" style="display:none">' + Icons.check() + '<span>Review Matches</span></button>'
      + '<button class="settings-btn settings-btn-danger" id="btn-meta-clear">' + Icons.trash() + '<span>Clear Matches</span></button>'
      + '</div></div>';

    html += '<div class="settings-section">'
      + '<div class="settings-section-title">' + Icons.music() + ' Library</div>'
      + '<div class="settings-section-desc">Rescan your music directory for new files.</div>'
      + '<div class="settings-actions">'
      + '<button class="settings-btn settings-btn-primary" id="btn-rescan">' + Icons.refresh() + '<span>Rescan Library</span></button>'
      + '</div></div>';

    html += '<div class="settings-section">'
      + '<div class="settings-section-title">' + Icons.settings() + ' About</div>'
      + '<div class="settings-about">'
      + '<div>MusicApp</div>'
      + '<div style="color:var(--text3);font-size:13px">Personal music library with MusicBrainz integration</div>'
      + '</div></div>';

    this.els.content.innerHTML = html;

    this._loadMetadataStatus();

    document.getElementById('btn-meta-scan').addEventListener('click', () => this._startMetadataScan());
    document.getElementById('btn-meta-clear').addEventListener('click', () => this._clearMetadata());
    document.getElementById('btn-rescan').addEventListener('click', () => this._rescanLibrary());

    const reviewBtn = document.getElementById('btn-meta-review');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', () => {
        this.navigateTo('metadata-review');
      });
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
          this.showToast('Found ' + p.result.pending + ' matches (' + p.result.failed + ' failed)');
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

  async _rescanLibrary() {
    const btn = document.getElementById('btn-rescan');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner" style="padding:0"></div><span>Scanning...</span>';
    try {
      await Api.scan();
      await Store.refreshLibrary();
      this.showToast('Library rescanned');
    } catch (err) {
      this.showToast('Rescan failed');
    }
    btn.disabled = false;
    btn.innerHTML = Icons.refresh() + '<span>Rescan Library</span>';
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

  renderTrackList(tracks, options) {
    const opts = options || {};
    const showArt = !!opts.showArt;
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

      return '<div class="track-row" data-track-id="' + track.id + '">'
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
      document.body.classList.remove('mini-player-visible');
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
  },

  updateNowPlaying() {
    const track = Player.getCurrentTrack();
    if (!track) return;

    this.els.npArt.src = Api.coverUrl(track.albumID);
    this.els.npTitle.textContent = track.title;
    this.els.npArtist.textContent = track.artist;

    const isFav = Store.isFavorite(track.id);
    this.els.npLikeBtn.innerHTML = isFav ? Icons.heartFilled() : Icons.heart();
    this.els.npLikeBtn.classList.toggle('active', isFav);

    this.els.npPlay.innerHTML = Player.playing ? Icons.pause() : Icons.play();
    this.els.npShuffle.classList.toggle('active', Player.shuffle);
    this.els.npRepeat.classList.toggle('active', Player.repeat !== 'off');
    this.els.npRepeat.innerHTML = Player.repeat === 'one' ? Icons.repeatOne() : Icons.repeat();

    this.els.nowPlaying.classList.toggle('playing', Player.playing);

    this._checkTitleOverflow();
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
    if (this.seeking || this.topSeeking) return;
    const fraction = progress.fraction;
    this._waveformProgress = fraction;
    this._paintWaveform(fraction);
    this.els.npTimeCurrent.textContent = this._formatTime(progress.current);
    this.els.npTimeTotal.textContent = this._formatTime(progress.duration);
    const pct = (fraction * 100) + '%';
    this.els.miniProgress.style.setProperty('--progress', pct);
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

    const pointWidth = 3;
    const pointGap = 2;
    const numPoints = Math.floor(w / (pointWidth + pointGap));

    // Seeded pseudo-random from track ID for consistent waveform per track
    const seed = trackId || 'default';
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    const rand = () => {
      hash = (hash * 16807 + 0) % 2147483647;
      return (hash & 0x7fffffff) / 0x7fffffff;
    };

    const data = [];
    for (let i = 0; i < numPoints; i++) {
      const t = i / numPoints;
      // Envelope: ramp up, sustain with variation, ramp down
      let env = 1;
      if (t < 0.05) env = t / 0.05;
      else if (t > 0.95) env = (1 - t) / 0.05;

      // Main amplitude with some structure
      const base = rand() * 0.5 + 0.15;
      const mid = Math.sin(t * Math.PI * (2 + rand() * 3)) * 0.15 + 0.5;
      const amp = (base + mid) * env;

      // Normalize to 8-100 range (min height so it's always visible)
      data.push(Math.max(8, Math.min(100, Math.round(amp * 100))));
    }

    this._waveformData = data;
    this._waveformPointWidth = pointWidth;
    this._waveformPointGap = pointGap;
  },

  _paintWaveform(progressFraction) {
    const canvas = this.els.waveformCanvas;
    if (!canvas || !this._waveformData.length) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const data = this._waveformData;
    const pw = this._waveformPointWidth * dpr;
    const pg = this._waveformPointGap * dpr;
    const totalWidth = data.length * (pw + pg);

    // Read colors from CSS tokens
    const style = getComputedStyle(document.documentElement);
    const playedColor = style.getPropertyValue('--waveform-played').trim() || '#D4F040';
    const unplayedColor = style.getPropertyValue('--waveform-unplayed').trim() || 'rgba(255, 255, 255, 0.22)';
    const hoverPlayed = style.getPropertyValue('--waveform-hover').trim() || 'rgba(212, 240, 64, 0.8)';
    const hoverUnplayed = 'rgba(255,255,255,0.45)';

    ctx.clearRect(0, 0, w, h);

    const playingPoint = progressFraction * data.length;
    const hoverX = this._waveformHoverX >= 0 ? this._waveformHoverX * dpr : -1;

    for (let i = 0; i < data.length; i++) {
      const barH = (data[i] / 100) * h * 0.85;
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

      // Rounded bars
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

  showNowPlaying() {
    this.updateNowPlaying();
    const track = Player.getCurrentTrack();
    this._generateWaveform(track ? track.id : null);
    this.updateSeekBar();
    this._renderQueue();
    this.els.nowPlaying.style.animation = '';
    this.els.nowPlaying.classList.remove('hidden');
    this.els.miniPlayer.classList.add('hidden');
    this._applyNowPlayingBg();
  },

  hideNowPlaying() {
    const np = this.els.nowPlaying;
    np.style.animation = 'nowPlayingSlideDown 0.35s cubic-bezier(0.55, 0.06, 0.68, 0.19) forwards';
    np.addEventListener('animationend', () => {
      np.classList.add('hidden');
      np.style.animation = '';
      np.style.background = '';
      this._lastColorAlbumId = null;
    }, { once: true });
    if (Player.getCurrentTrack()) {
      this.els.miniPlayer.classList.remove('hidden');
    }
  },

  showQueue() {
    this._renderQueue();
    this.els.queuePanel.classList.remove('hidden');
  },

  hideQueue() {
    this.els.queuePanel.classList.add('hidden');
  },

  updateQueueIfVisible() {
    if (this.els.queuePanel && !this.els.queuePanel.classList.contains('hidden')) {
      this._renderQueue();
    }
  },

  _renderQueue() {
    if (Player.queue.length === 0) {
      this.els.queueList.innerHTML = '<div class="empty-state"><div class="empty-state-title">Queue is empty</div><div class="empty-state-text">Play something to see it here</div></div>';
      return;
    }

    const sourceName = Player.getSourceName();
    const sourceEl = this.els.queuePanel.querySelector('.queue-source');
    if (sourceEl) sourceEl.remove();

    if (sourceName) {
      const label = document.createElement('div');
      label.className = 'queue-source';
      label.textContent = sourceName;
      this.els.queueList.parentElement.insertBefore(label, this.els.queueList);
    } else {
      const existing = this.els.queuePanel.querySelector('.queue-source');
      if (existing) existing.remove();
    }

    this.els.queueList.innerHTML = Player.queue.map((track, i) => {
      const isCurrent = i === Player.currentIndex;
      return '<div class="queue-item' + (isCurrent ? ' active' : '') + '" data-queue-index="' + i + '">'
        + '<div class="queue-item-art"><img src="' + Api.coverUrl(track.albumID) + '" alt=""></div>'
        + '<div class="queue-item-info">'
        + '<div class="queue-item-title">' + this._esc(track.title) + '</div>'
        + '<div class="queue-item-artist">' + this._esc(track.artist) + '</div>'
        + '</div></div>';
    }).join('');
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
      const menuW = 240;
      const menuH = sheet.scrollHeight || 200;
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;

      let top = rect.bottom + 4;
      let left = rect.right - menuW;

      if (left < 8) left = rect.left;
      if (left + menuW > vpW - 8) left = vpW - menuW - 8;
      if (top + menuH > vpH - 8) top = rect.top - menuH - 4;
      if (top < 8) top = 8;

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
          dur.textContent = this._formatTime(Store.getTrack(current.id) ? 0 : 0);
          row.appendChild(dur);
        }
      }
    });
    document.querySelectorAll('.queue-item').forEach(item => {
      const idx = parseInt(item.dataset.queueIndex);
      item.classList.toggle('active', idx === Player.currentIndex);
    });
  },

  _showTrackContextMenu(trackId, triggerEl) {
    const track = Store.getTrack(trackId);
    if (!track) return;
    this.contextTrackId = trackId;
    const isFav = Store.isFavorite(trackId);
    this.showContextMenu([
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
    ], triggerEl);
  },

  async _showRescanModal(trackId) {
    const track = Store.getTrack(trackId);
    if (!track) return;

    const modal = document.getElementById('rescan-modal');
    const list = document.getElementById('rescan-modal-list');
    const title = document.getElementById('rescan-modal-title');

    title.textContent = 'Scanning...';
    list.innerHTML = '<div class="loading-spinner" style="margin:24px auto"></div>';
    modal.classList.remove('hidden');

    try {
      const candidates = await Api.metadataRescanSync(trackId);
      if (!candidates || candidates.length === 0) {
        title.textContent = this._esc(track.title);
        list.innerHTML = this._emptyState('No matches found', 'Could not find this track on MusicBrainz', Icons.search());
        return;
      }

      title.textContent = this._esc(track.title);

      let html = '<div class="rescan-your-track">'
        + '<div class="rescan-label">Your Track</div>'
        + '<div class="rescan-your-title">' + this._esc(track.title) + '</div>'
        + '<div class="rescan-your-artist">' + this._esc(track.artist) + '</div>'
        + '</div>';

      candidates.forEach(c => {
        const pct = Math.round(c.score * 100);
        const cls = pct >= 80 ? 'score-high' : pct >= 50 ? 'score-mid' : 'score-low';
        html += '<div class="rescan-candidate" data-title="' + this._esc(c.title) + '" data-artist="' + this._esc(c.artist) + '" data-album="' + this._esc(c.album) + '">'
          + '<div class="rescan-candidate-info">'
          + '<div class="rescan-candidate-title">' + this._esc(c.title) + '</div>'
          + '<div class="rescan-candidate-artist">' + this._esc(c.artist) + '</div>'
          + '<div class="rescan-candidate-album">' + this._esc(c.album || '—') + '</div>'
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

          // Apply directly to the track
          const t = Store.getTrack(trackId);
          if (t) {
            t.title = newTitle;
            t.artist = newArtist;
            if (newAlbum) t.album = newAlbum;
            if (newArtist) t.albumArtist = newArtist;
            if (t.album) t.albumID = (t.albumArtist || t.artist) + ':' + t.album;
          }

          await Store.refreshLibrary();
          modal.classList.add('hidden');
          this.showToast('Metadata updated');
          this.renderPage();
        });
      });

    } catch (err) {
      title.textContent = this._esc(track.title);
      list.innerHTML = this._emptyState('Scan failed', 'Could not reach MusicBrainz', Icons.xCircle());
    }
  },

  _handleAction(action) {
    if (!action) return;
    if (action === 'shuffle' || action === 'shuffle-all') {
      const list = Store.library.tracks.slice();
      if (list.length > 0) {
        const shuffled = list.sort(() => Math.random() - 0.5);
        Player.shuffle = true;
        const source = (action === 'shuffle-all')
          ? { type: 'all', name: 'All Music' }
          : this._getViewSource();
        Player.play(shuffled[0], shuffled, source);
        this.showNowPlaying();
      }
      return;
    }
    if (action === 'delete-playlist') {
      const playlistId = Store.viewData.playlistId;
      if (!playlistId) return;
      Api.deletePlaylist(playlistId).then(() => {
        Store.refreshPlaylists();
        this.navigateBack();
        this.showToast('Playlist deleted');
      }).catch(() => {
        this.showToast('Failed to delete playlist');
      });
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
      return { type: 'favorites', name: 'Liked Songs' };
    }
    if (view === 'all-music') {
      return { type: 'all', name: 'All Music' };
    }
    if (view === 'search') {
      return { type: 'search', name: 'Search Results' };
    }
    return null;
  },

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
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

      glow.style.background =
        'radial-gradient(ellipse at 50% 50%, ' +
        'rgba(' + r + ',' + g + ',' + b + ',0.35) 0%, ' +
        'rgba(' + r + ',' + g + ',' + b + ',0.1) 60%, ' +
        'transparent 100%)';
      glow.classList.add('active');
    };
    img.onerror = () => {
      glow.classList.remove('active');
    };
    img.src = Api.coverUrl(track.albumID);
  },

  _updateVolumeBar() {
    const pct = (Player.volume * 100) + '%';
    const icon = Player.volume === 0 ? Icons.volumeMute() : Icons.volume();
    this.els.volumeFill.style.width = pct;
    this.els.volumeBtn.innerHTML = icon;
    if (this.els.queueVolumeFill) this.els.queueVolumeFill.style.width = pct;
    if (this.els.queueVolumeBtn) this.els.queueVolumeBtn.innerHTML = icon;
  }
};

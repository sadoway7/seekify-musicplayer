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
      seekBar: document.querySelector('.np-seek-bar'),
      seekFill: document.querySelector('.np-seek-fill'),
      seekThumb: document.querySelector('.np-seek-thumb'),
      volumeBar: document.querySelector('.np-volume-bar'),
      volumeFill: document.querySelector('.np-volume-fill'),
      volumeBtn: document.querySelector('.np-volume button'),
      queuePanel: document.getElementById('queue-panel'),
      queueList: document.getElementById('queue-list'),
      playlistModal: document.getElementById('playlist-modal'),
      playlistModalList: document.getElementById('playlist-modal-list'),
      createPlaylistBtn: document.getElementById('create-playlist-btn'),
      contextMenu: document.getElementById('context-menu'),
      contextMenuItems: document.getElementById('context-menu-items'),
      queueColList: document.getElementById('np-queue-col-list'),
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
        Store.currentTab = tab.dataset.tab;
        Store.currentView = tab.dataset.tab;
        Store.viewData = {};
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
  },

  _bindSeekBar() {
    const bar = this.els.seekBar;
    if (!bar) return;

    const getFraction = (e) => {
      const rect = bar.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };

    const onStart = (e) => {
      this.seeking = true;
      const f = getFraction(e);
      this.els.seekFill.style.width = (f * 100) + '%';
      if (this.els.topProgressFill) this.els.topProgressFill.style.width = (f * 100) + '%';
    };

    const onMove = (e) => {
      if (!this.seeking) return;
      const f = getFraction(e);
      this.els.seekFill.style.width = (f * 100) + '%';
      if (this.els.topProgressFill) this.els.topProgressFill.style.width = (f * 100) + '%';
    };

    const onEnd = (e) => {
      if (!this.seeking) return;
      this.seeking = false;
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
      if (this.els.seekFill) this.els.seekFill.style.width = (f * 100) + '%';
    };

    const onMove = (e) => {
      if (!this.topSeeking) return;
      const f = getFraction(e);
      if (this.els.topProgressFill) this.els.topProgressFill.style.width = (f * 100) + '%';
      if (this.els.seekFill) this.els.seekFill.style.width = (f * 100) + '%';
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
    const bar = this.els.volumeBar;
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
  },

  _bindQueuePanel() {
    document.querySelector('.queue-close').addEventListener('click', () => {
      this.hideQueue();
    });

    this.els.queueList.addEventListener('click', (e) => {
      const item = e.target.closest('.queue-item');
      if (!item) return;
      const index = parseInt(item.dataset.queueIndex);
      if (isNaN(index)) return;
      const track = Player.queue[index];
      if (track) {
        Player.play(track, Player.queue);
      }
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

      const trow = e.target.closest('.track-row');
      if (trow) {
        const trackId = trow.dataset.trackId;
        const track = Store.getTrack(trackId);
        if (track) {
          const list = this._viewTrackList.length > 0 ? this._viewTrackList : [track];
          Player.play(track, list);
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
          Player.play(this._viewTrackList[0], this._viewTrackList);
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
                  if (tracks.length > 0) Player.play(tracks[0], tracks);
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
      default: this.renderHome();
    }
  },

  renderHome() {
    this._viewTrackList = [];
    const greeting = this._getGreeting();
    let html = '<div class="greeting">' + greeting + '</div>';

    const recentTracks = Store.recent.map(id => Store.getTrack(id)).filter(Boolean);
    const currentTrack = Player.getCurrentTrack();

    const recentCards = [];
    const seenAlbums = new Set();
    recentTracks.forEach(t => {
      if (t.album && t.album !== '') {
        if (!seenAlbums.has(t.albumID)) {
          seenAlbums.add(t.albumID);
          recentCards.push({ type: 'album', name: t.album, id: t.albumID });
        }
      } else {
        recentCards.push({ type: 'track', name: t.title, id: t.id, albumID: t.albumID });
      }
    });

    html += '<div class="section-header"><h2>Recently Played</h2></div>';

    if (recentCards.length > 0 || currentTrack) {
      html += '<div class="quick-play-grid">';

      html += '<div class="quick-play-card" data-navigate="all-music">'
        + '<div class="quick-play-art" style="background:var(--l3);display:flex;align-items:center;justify-content:center;color:var(--text2)"><span style="font-size:18px;font-weight:700">All</span></div>'
        + '<div class="quick-play-title">All Music</div>'
        + '</div>';

      if (currentTrack) {
        const hasCover = Store.albumHasCover(currentTrack.albumID);
        const artInner = hasCover
          ? '<img src="' + Api.coverUrl(currentTrack.albumID) + '" alt="">'
          : '';
        html += '<div class="quick-play-card quick-play-card-now" data-album-id="' + currentTrack.albumID + '">'
          + '<div class="quick-play-art">' + artInner
          + '<div class="quick-play-playing"><div class="eq"><div class="eqb" style="height:5px"></div><div class="eqb" style="height:11px"></div><div class="eqb" style="height:7px"></div></div></div></div>'
          + '<div class="quick-play-title">' + this._esc(currentTrack.title) + '</div>'
          + '</div>';
      }

      recentCards.slice(0, 5).forEach(c => {
        if (currentTrack && c.id === currentTrack.albumID) return;
        const hasCover = Store.albumHasCover(c.albumID || c.id);
        const artInner = hasCover
          ? '<img src="' + Api.coverUrl(c.albumID || c.id) + '" alt="">'
          : '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--text3)">' + Icons.music() + '</div>';
        html += '<div class="quick-play-card" data-album-id="' + (c.albumID || c.id) + '">'
          + '<div class="quick-play-art">' + artInner + '</div>'
          + '<div class="quick-play-title">' + this._esc(c.name) + '</div>'
          + '</div>';
      });

      html += '<div class="quick-play-card" data-action="shuffle-all">'
        + '<div class="quick-play-art" style="background:var(--accent);display:flex;align-items:center;justify-content:center;color:#0A0A0A">' + Icons.shuffle() + '</div>'
        + '<div class="quick-play-title">Shuffle</div>'
        + '</div>';

      html += '</div>';
    } else {
      html += '<div class="empty-state" style="padding:16px"><div class="empty-state-text" style="color:var(--text3)">Play some music to see your history</div></div>';
    }

    const allTracks = Store.library.tracks.slice();
    const newTracks = allTracks.filter(t => t.artist && t.artist !== '').sort((a, b) => (b.modTime || 0) - (a.modTime || 0)).slice(0, 6);
    if (newTracks.length > 0) {
      html += '<div class="section-header"><h2>New Songs</h2></div>';
      html += this.renderTrackList(newTracks, { showArt: true });
    }

    const namedArtists = Store.library.artists.filter(a => a.name && a.name !== '' && a.name !== 'Unknown');
    const newArtists = namedArtists.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0)).slice(0, 6);
    html += '<div class="section-header"><h2>Artists</h2></div>';
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
    html += '<div class="section-header"><h2>Albums</h2></div>';
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
      html += '<div class="section-header"><h2>Playlists</h2></div>';
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
      html += '<div class="section-header"><h2>Liked Songs</h2></div>';
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
      + '<span class="page-header-title" style="font-size:24px;font-weight:700;letter-spacing:-0.04em">Search</span></div>'
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
      const results = Store.library.tracks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
      );
      this._viewTrackList = results;
      if (results.length === 0) {
        container.innerHTML = this._emptyState('No results', 'Try different keywords', Icons.search());
      } else {
        container.innerHTML = this.renderTrackList(results, { showArt: true });
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
    const genres = [
      { name: 'Pop', color: '#8b5cf6' },
      { name: 'Rock', color: '#ef4444' },
      { name: 'Hip-Hop', color: '#f59e0b' },
      { name: 'Electronic', color: '#06b6d4' },
      { name: 'Jazz', color: '#22c55e' },
      { name: 'Classical', color: '#a855f7' },
      { name: 'R&B', color: '#ec4899' },
      { name: 'Country', color: '#f97316' },
      { name: 'Metal', color: '#64748b' },
      { name: 'Indie', color: '#14b8a6' },
      { name: 'Folk', color: '#84cc16' },
      { name: 'Latin', color: '#eab308' }
    ];
    return '<div class="browse-grid">' + genres.map(g =>
      '<div class="category-card" data-genre="' + g.name + '" style="background:' + g.color + '">' + g.name + '</div>'
    ).join('') + '</div>';
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
      + '<div class="hero-section">'
      + '<div class="hero-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
      + Icons.music() + '</div>'
      + '<div class="hero-title">All Music</div>'
      + '<div class="hero-subtitle">' + tracks.length + ' tracks</div></div>'
      + '<div class="action-row">'
      + '<button class="play-all-btn">' + Icons.play() + '</button>'
      + '<div class="action-btns">'
      + '<button class="action-btn" data-action="shuffle">' + Icons.shuffle() + '</button>'
      + '</div></div>';

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
      + '<div class="detail-hero-art"><img src="' + Api.coverUrl(albumId) + '" alt=""></div>'
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

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Artist</span></div>'
      + '<div class="hero-section">'
      + '<div class="hero-art round" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">'
      + Icons.music() + '</div>'
      + '<div class="hero-title">' + this._esc(name) + '</div>'
      + '<div class="hero-subtitle">' + albums.length + ' albums, ' + tracks.length + ' tracks</div></div>'
      + '<div class="action-row">'
      + '<button class="play-all-btn">' + Icons.play() + '</button>'
      + '<div class="action-btns">'
      + '<button class="action-btn" data-action="shuffle">' + Icons.shuffle() + '</button>'
      + '</div></div>';

    if (albums.length > 0) {
      html += '<div class="sh"><div class="sh-t">Albums</div></div><div class="scroll-row">';
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

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Playlist</span></div>'
      + '<div class="detail-hero">'
      + '<div class="detail-hero-art"><div class="detail-hero-art-icon">' + Icons.music() + '</div></div>'
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

    let html = '<div class="page-header">'
      + '<button class="back-btn">' + Icons.chevronLeft() + '</button>'
      + '<span class="page-header-title">Favorites</span></div>'
      + '<div class="detail-hero">'
      + '<div class="detail-hero-art detail-hero-art-accent"><div class="detail-hero-art-icon">' + Icons.heartFilled() + '</div></div>'
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

  renderTrackList(tracks, options) {
    const opts = options || {};
    const showArt = !!opts.showArt;
    const currentTrack = Player.getCurrentTrack();

    return '<div class="track-list">' + tracks.map((track) => {
      const isCurrent = currentTrack && currentTrack.id === track.id;
      const hasCover = Store.albumHasCover(track.albumID);
      const artHtml = (showArt && hasCover)
        ? '<div class="track-art" style="background-image:url(' + Api.coverUrl(track.albumID) + ')"></div>'
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
  },

  updateSeekBar() {
    const progress = Player.getProgress();
    if (this.seeking || this.topSeeking) return;
    const pct = (progress.fraction * 100) + '%';
    this.els.seekFill.style.width = pct;
    if (this.els.seekThumb) this.els.seekThumb.style.left = pct;
    this.els.npTimeCurrent.textContent = this._formatTime(progress.current);
    this.els.npTimeTotal.textContent = this._formatTime(progress.duration);
    this.els.miniProgress.style.setProperty('--progress', pct);
  },

  showNowPlaying() {
    this.updateNowPlaying();
    this.updateSeekBar();
    this._renderQueue();
    this.els.nowPlaying.classList.remove('hidden');
    this._applyNowPlayingBg();
  },

  hideNowPlaying() {
    this.els.nowPlaying.classList.add('hidden');
    this.els.nowPlaying.style.background = '';
    this._lastColorAlbumId = null;
  },

  showQueue() {
    this._renderQueue();
    this.els.queuePanel.classList.remove('hidden');
  },

  hideQueue() {
    this.els.queuePanel.classList.add('hidden');
  },

  _renderQueue() {
    const renderItems = (container) => {
      if (!container) return;
      if (Player.queue.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Queue is empty</div><div class="empty-state-text">Add tracks to your queue</div></div>';
        return;
      }
      container.innerHTML = Player.queue.map((track, i) => {
        const isCurrent = i === Player.currentIndex;
        return '<div class="queue-item' + (isCurrent ? ' active' : '') + '" data-queue-index="' + i + '">'
          + '<div class="queue-item-art"><img src="' + Api.coverUrl(track.albumID) + '" alt=""></div>'
          + '<div class="queue-item-info">'
          + '<div class="queue-item-title">' + this._esc(track.title) + '</div>'
          + '<div class="queue-item-artist">' + this._esc(track.artist) + '</div>'
          + '</div></div>';
      }).join('');
    };
    renderItems(this.els.queueList);
    renderItems(this.els.queueColList);
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

  _handleAction(action) {
    if (!action) return;
    if (action === 'shuffle' || action === 'shuffle-all') {
      const list = Store.library.tracks.slice();
      if (list.length > 0) {
        const shuffled = list.sort(() => Math.random() - 0.5);
        Player.shuffle = true;
        Player.play(shuffled[0], shuffled);
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

  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
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
    this.els.volumeFill.style.width = (Player.volume * 100) + '%';
    this.els.volumeBtn.innerHTML = Player.volume === 0 ? Icons.volumeMute() : Icons.volume();
  }
};

// ============================================
// ui-library.js — extracted from ui.js
// ============================================
Object.assign(UI, {

  renderLibrary() {
    this._viewTrackList = [];
    if (Store.isGuest && this.libFilter === 'playlists') this.libFilter = 'albums';
    let html = '<div class="lib-sticky-header">'
      + '<div class="lib-tabs">'
      + (Store.isGuest ? '' : '<button class="lib-tab' + (this.libFilter === 'playlists' ? ' active' : '') + '" data-filter="playlists">Playlists</button>')
      + '<button class="lib-tab' + (this.libFilter === 'albums' ? ' active' : '') + '" data-filter="albums">Albums</button>'
      + '<button class="lib-tab' + (this.libFilter === 'artists' ? ' active' : '') + '" data-filter="artists">Artists</button>'
      + '</div>'
      + '<div class="lib-search-row">'
      + '<div class="search-container">'
      + '<span class="search-icon">' + Icons.search() + '</span>'
      + '<input class="search-input lib-search-input" type="search" enterkeyhint="search" placeholder="">'
      + '</div>'
      + (Store.isAdmin ? '<button class="lib-upload-btn" id="lib-upload-btn" aria-label="Upload music">' + Icons.upload() + '</button>' : '')
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
    if (!Store.isGuest) Store.refreshPlaylists().then(() => {
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

    if (Store.isAdmin) {
      const reviewCount = Store.reviewCounts.needs_review || 0;
      html += '<div class="list-item" data-action="needs-review" style="cursor:pointer">'
        + '<div class="list-item-art" style="background:rgba(255,107,107,.1);display:flex;align-items:center;justify-content:center;color:#ff6b6b">'
        + Icons.warning() + '</div>'
        + '<div class="list-item-info"><div class="list-item-title" style="color:#ff6b6b">Needs Review</div>'
        + '<div class="list-item-subtitle">' + reviewCount + ' tracks flagged</div></div></div>';
    }

    if (!Store.isGuest) {
      html += '<div class="list-item" data-action="create-playlist" style="cursor:pointer">'
        + '<div class="list-item-art" style="background:var(--l2);display:flex;align-items:center;justify-content:center;color:var(--accent)">'
        + Icons.plus() + '</div>'
        + '<div class="list-item-info"><div class="list-item-title" style="color:var(--accent)">Create Playlist</div></div></div>';
    }

    if (Store.playlists.length === 0) {
      html += this._emptyState('No playlists yet', Store.isGuest ? 'Log in to create and save playlists' : 'Create a playlist to organize your music', Icons.library());
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
    if (!Store.isAdmin) { this.navigateTo('albums'); return; }
    this._viewTrackList = [];
    this._reviewOffset = 0;
    this._reviewTotal = 0;
    this._reviewUnfilteredTotal = 0;
    this.els.content.innerHTML = '<div class="loading-spinner"></div>';

    const flags = this._reviewFlags || [];
    let data;
    try {
      data = await Api.getReviewTracks(0, 200, flags);
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
      + '<button class="detail-action-btn" id="review-recheck-btn">' + Icons.refresh() + '<span>Recheck</span></button>'
      + '<button class="detail-action-btn" id="review-enrich-btn">' + Icons.search() + '<span>Rescan Meta &amp; Art</span></button>'
      + (tracks.length > 0 || flags.length > 0 ? '<button class="detail-action-btn" data-action="approve-review-shown">' + Icons.check() + '<span>Approve Shown</span></button>' : '')
      + (tracks.length > 0 || flags.length > 0 ? '<button class="detail-action-btn detail-action-btn-danger" data-action="delete-review-shown">' + Icons.trash() + '<span>Delete Shown</span></button>' : '')
      + '</div>'
      + '</div>';

    html += this._renderReviewFilters(flags);

    if (tracks.length === 0) {
      html += this._emptyState('All clear', flags.length > 0 ? 'No tracks match the selected filters' : 'No tracks need review right now', Icons.checkCircle());
    } else {
      html += '<div id="review-track-list-container">' + this._renderReviewTrackList(tracks) + '</div>';
      if (this._reviewOffset < this._reviewTotal) {
        html += '<div class="review-load-more" id="review-load-trigger" style="text-align:center;padding:24px;color:var(--text-muted)">Scroll for more...</div>';
      }
    }

    this.els.content.innerHTML = html;
    this._fadeIn(this.els.content);
    this._setupReviewScrollLoader();
    this._setupReviewFilters();

    const enrichBtn = document.getElementById('review-enrich-btn');
    if (enrichBtn) enrichBtn.addEventListener('click', async () => {
      enrichBtn.disabled = true;
      enrichBtn.querySelector('span').textContent = 'Fetching...';
      try {
        await Api.reviewEnrich();
        var self = this;
        var pollCount = 0;
        var poll = async function() {
          pollCount++;
          try {
            var p = await Api.getReviewProgress();
            if (p && p.active) {
              if (p.total) {
                enrichBtn.querySelector('span').textContent = (p.checked || 0) + '/' + p.total;
              }
              if (pollCount < 600) { setTimeout(poll, 1500); return; }
            }
          } catch (e) {}
          self._showToast('Rescan complete — refreshing list');
          self.navigateTo('needs-review');
          enrichBtn.disabled = false;
          enrichBtn.querySelector('span').textContent = 'Rescan Meta & Art';
        };
        setTimeout(poll, 1000);
      } catch (e) {
        this._showToast('Rescan failed');
        enrichBtn.disabled = false;
        enrichBtn.querySelector('span').textContent = 'Rescan Meta & Art';
      }
    });

    const recheckBtn = document.getElementById('review-recheck-btn');
    if (recheckBtn) recheckBtn.addEventListener('click', async () => {
      recheckBtn.disabled = true;
      recheckBtn.querySelector('span').textContent = 'Rechecking...';
      try {
        await Api.reviewRecheckAll();
        var self = this;
        var pollCount = 0;
        var poll = async function() {
          pollCount++;
          try {
            var p = await Api.getReviewProgress();
            if (p && p.active) {
              if (p.total) {
                recheckBtn.querySelector('span').textContent = 'Rechecking ' + (p.done || 0) + '/' + p.total + '...';
              }
              if (pollCount < 300) { setTimeout(poll, 1500); return; }
            }
          } catch (e) {}
          self.navigateTo('needs-review');
        };
        setTimeout(poll, 1000);
      } catch (e) {
        this._showToast('Recheck failed');
        recheckBtn.disabled = false;
        recheckBtn.querySelector('span').textContent = 'Recheck';
      }
    });
  },

  _renderReviewFilters(activeFlags) {
    const active = activeFlags || [];
    const flags = [
      'missing_title', 'missing_artist', 'missing_album', 'missing_track_number',
      'missing_genre', 'no_cover', 'suspicious_title', 'suspicious_video',
      'suspicious_cover', 'filename_derived', 'artist_equals_title',
      'very_short_title', 'very_long_title', 'no_duration', 'short_duration', 'long_duration',
      'potential_duplicate'
    ];
    let html = '<div class="review-filter-chips">';
    const allActive = active.length === 0;
    html += '<button class="review-filter-chip' + (allActive ? ' active' : '') + '" data-flag="">All</button>';
    for (const f of flags) {
      const isOn = active.indexOf(f) !== -1;
      html += '<button class="review-filter-chip' + (isOn ? ' active' : '') + '" data-flag="' + f + '">' + ReviewUI.flagLabel(f) + '</button>';
    }
    html += '</div>';
    return html;
  },

  _setupReviewFilters() {
    const container = this.els.content.querySelector('.review-filter-chips');
    if (!container) return;
    container.addEventListener('click', (e) => {
      const chip = e.target.closest('.review-filter-chip');
      if (!chip) return;
      const flag = chip.getAttribute('data-flag');
      if (!flag) {
        this._reviewFlags = [];
      } else if ((this._reviewFlags || [])[0] === flag) {
        this._reviewFlags = []; // toggle off → All
      } else {
        this._reviewFlags = [flag]; // single-select
      }
      this.renderNeedsReview();
    });
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
      data = await Api.getReviewTracks(this._reviewOffset, 200, this._reviewFlags || []);
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
    this._setupReviewFilters();
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
    if (modal) this._closeSheetModal(modal);
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

  _setUploadFiles(fileList) {
    const audioExts = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus', 'wma'];
    const files = [];
    for (const f of fileList) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (audioExts.indexOf(ext) !== -1) files.push(f);
    }
    this._uploadSelected = files;
    const list = document.getElementById('upload-file-list');
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
    const preview = document.getElementById('upload-preview-area');
    if (preview) preview.innerHTML = '';
    this._updateUploadButton();
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
    const ready = (this._uploadSelected || []).length > 0;
    btn.disabled = !ready;
    btn.textContent = 'Upload';
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
      const ready = (this._uploadSelected || []).length > 0;
      area.innerHTML = '<button class="edit-meta-cancel" onclick="UI.closeUploadModal()">Cancel</button>'
        + '<button class="edit-meta-save" id="upload-modal-do" onclick="UI.doUpload()"' + (ready ? '' : ' disabled') + '>Upload</button>';
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
    if (files.length === 0) {
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
      this.closeUploadModal();
      await Store.refreshLibrary();
      this.showToast(tracks.length + ' track' + (tracks.length !== 1 ? 's' : '') + ' added');
      if (tracks.length > 0 && typeof ReviewUI !== 'undefined' && ReviewUI.showEditMetaModal) {
        ReviewUI.showEditMetaModal(tracks[0].id);
      }
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

});

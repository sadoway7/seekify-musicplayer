const Store = {
  library: { tracks: [], albums: [], artists: [] },
  _trackMap: new Map(),
  _albumMap: new Map(),
  playlists: [],
  favorites: [],
  recent: [],
  currentTab: 'home',
  currentView: 'home',
  viewData: {},
  loading: false,
  downloadsEnabled: true,
  waveformStyle: 'rounded',
  reviewCounts: { unchecked: 0, needs_review: 0, reviewed_ok: 0 },

  defaultHomeLayout: [
    { id: 'needs-review', title: 'Needs Review', enabled: false },
    { id: 'recent', title: 'Recently Played', enabled: true },
    { id: 'favorites', title: 'Favorites', enabled: true },
    { id: 'artists', title: 'Artists', enabled: true },
    { id: 'albums', title: 'Albums', enabled: true },
    { id: 'playlists', title: 'Playlists', enabled: true },
    { id: 'new-songs', title: 'New Songs', enabled: true }
  ],

  getHomeLayout() {
    try {
      const raw = localStorage.getItem('home_layout');
      if (raw) {
        const saved = JSON.parse(raw);
        const defaults = this.defaultHomeLayout;
        const savedIds = new Set(saved.map(s => s.id));
        const merged = saved.map(s => {
          const def = defaults.find(d => d.id === s.id);
          return { ...def, ...s };
        });
        defaults.forEach(d => {
          if (!savedIds.has(d.id)) merged.push({ ...d });
        });
        return merged;
      }
    } catch(e) {}
    return this.defaultHomeLayout.map(s => ({ ...s }));
  },

  saveHomeLayout(layout) {
    localStorage.setItem('home_layout', JSON.stringify(layout));
  },

  async init() {
    this.loading = true;
    try {
      const [library, playlists, favorites, recent] = await Promise.all([
        Api.getLibrary(),
        Api.getPlaylists(),
        Api.getFavorites(),
        Api.getRecent()
      ]);
      this.library = library;
      this.playlists = playlists;
      this.favorites = favorites;
      this.recent = recent;
      this._rebuildMaps();
      try {
        const settings = await Api.getSettings();
        this.downloadsEnabled = settings.downloads_enabled !== 'false';
        this.waveformStyle = settings.waveform_style || 'rounded';
      } catch(e) {}
      try {
        this.reviewCounts = await Api.getReviewCounts();
      } catch(e) {}
    } catch (err) {
      UI.showToast('Failed to load library');
      UI.els.content.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;color:#aaa">'
        + '<div style="font-size:48px;margin-bottom:16px">&#9835;</div>'
        + '<div style="font-size:16px;margin-bottom:16px;color:#fff">Could not load your library</div>'
        + '<button onclick="App.init()" style="padding:10px 24px;border-radius:8px;border:1px solid #444;background:#222;color:#fff;font-size:14px;cursor:pointer">Retry</button>'
        + '</div>';
    }
    this.loading = false;
  },

  async refreshLibrary() {
    try {
      this.library = await Api.getLibrary();
      this._rebuildMaps();
    } catch (err) {
      UI.showToast('Failed to refresh library');
    }
  },

  async refreshPlaylists() {
    try {
      this.playlists = await Api.getPlaylists();
    } catch (err) {
      UI.showToast('Failed to refresh playlists');
    }
  },

  async refreshFavorites() {
    try {
      this.favorites = await Api.getFavorites();
    } catch (err) {
      UI.showToast('Failed to refresh favorites');
    }
  },

  async refreshRecent() {
    try {
      this.recent = await Api.getRecent();
    } catch (err) {
      UI.showToast('Failed to refresh recent');
    }
  },

  _rebuildMaps() {
    this._trackMap = new Map(this.library.tracks.map(t => [t.id, t]));
    this._albumMap = new Map(this.library.albums.map(a => [a.id, a]));
  },

  getTrack(id) {
    return this._trackMap.get(id) || null;
  },

  getAlbum(id) {
    return this._albumMap.get(id) || null;
  },

  albumHasCover(albumId) {
    const album = this.getAlbum(albumId);
    return album && album.hasCover;
  },

  getArtistTracks(name) {
    return this.library.tracks.filter(t =>
      t.artist === name || t.albumArtist === name
    );
  },

  getArtistAlbums(name) {
    return this.library.albums.filter(a => a.artist === name);
  },

  getAlbumTracks(albumId) {
    return this.library.tracks
      .filter(t => t.albumID === albumId)
      .sort((a, b) => a.trackNumber - b.trackNumber);
  },

  isFavorite(trackId) {
    return this.favorites.includes(trackId);
  },

  _rotationIds: null,

  async _ensureRotation() {
    if (this._rotationIds) return;
    if (!this.playlists.length) await this.refreshPlaylists();
    let rot = this.playlists.find(p => p.name === 'Rotation');
    if (!rot) {
      rot = await Api.createPlaylist('Rotation');
      this.playlists.push(rot);
    }
    this._rotationIds = new Set(rot.trackIds || []);
  },

  isInRotation(trackId) {
    return this._rotationIds && this._rotationIds.has(trackId);
  },

  async toggleRotation(trackId) {
    await this._ensureRotation();
    const rot = this.playlists.find(p => p.name === 'Rotation');
    if (!rot) return;
    if (this._rotationIds.has(trackId)) {
      this._rotationIds.delete(trackId);
      rot.trackIds = (rot.trackIds || []).filter(id => id !== trackId);
    } else {
      this._rotationIds.add(trackId);
      rot.trackIds = [...(rot.trackIds || []), trackId];
    }
    await Api.updatePlaylist(rot.id, { name: 'Rotation', trackIds: rot.trackIds });
  },

  getPlaylist(id) {
    return this.playlists.find(p => p.id === id) || null;
  }
};

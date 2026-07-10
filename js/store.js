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
  defaultNowPlayingView: 'album_art',
  reviewCounts: { unchecked: 0, needs_review: 0, reviewed_ok: 0 },
  user: null,
  registrationMode: 'off',

  get isGuest() { return !this.user || this.user.guest; },
  get isAdmin() { return !!this.user && this.user.role === 'admin'; },

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
      // Resolve current user first (guest returns {guest:true}).
      try { this.user = await Api.getMe(); } catch(e) { this.user = { guest: true }; }
      // Public: whether self-registration is enabled (drives the Register button).
      try { this.registrationMode = ((await Api.getRegistrationMode()) || {}).mode || 'off'; } catch(e) {}
      const library = await Api.getLibrary();
      this.library = library;
      // Personal collections only when logged in; guests 401 on these.
      if (this.user && !this.user.guest) {
        const [playlists, favorites, recent] = await Promise.all([
          Api.getPlaylists().catch(() => []),
          Api.getFavorites().catch(() => []),
          Api.getRecent().catch(() => [])
        ]);
        this.playlists = playlists || [];
        this.favorites = favorites || [];
        this.recent = recent || [];
      } else {
        this.playlists = [];
        this.favorites = [];
        this.recent = [];
      }
      this._rebuildMaps();
      // Global display settings (admin-configured) must reach every client, so
      // fetch the public subset for all users — no auth, no 401/403 noise.
      try {
        const ps = await Api.getPublicSettings();
        this.downloadsEnabled = ps.downloads_enabled !== 'false';
        this.waveformStyle = ps.waveform_style || 'rounded';
        this.defaultNowPlayingView = ps.default_now_playing_view || 'album_art';
      } catch(e) {}
      if (!this.isGuest) {
        try { this.reviewCounts = await Api.getReviewCounts(); } catch(e) {}
      }
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
    ).sort((a, b) => {
      const albumCmp = (a.album || '').localeCompare(b.album || '');
      if (albumCmp !== 0) return albumCmp;
      return (a.trackNumber || 0) - (b.trackNumber || 0);
    });
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

  getPlaylist(id) {
    return this.playlists.find(p => p.id === id) || null;
  }
};

const Store = {
  library: { tracks: [], albums: [], artists: [] },
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
    }
    this.loading = false;
  },

  async refreshLibrary() {
    try {
      this.library = await Api.getLibrary();
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

  getTrack(id) {
    return this.library.tracks.find(t => t.id === id) || null;
  },

  getAlbum(id) {
    return this.library.albums.find(a => a.id === id) || null;
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

  getPlaylist(id) {
    return this.playlists.find(p => p.id === id) || null;
  }
};

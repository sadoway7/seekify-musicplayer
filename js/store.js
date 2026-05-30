const Store = {
  library: { tracks: [], albums: [], artists: [] },
  playlists: [],
  favorites: [],
  recent: [],
  currentTab: 'home',
  currentView: 'home',
  viewData: {},
  loading: false,

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

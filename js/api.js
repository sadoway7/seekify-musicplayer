const Api = {
  async getLibrary() {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error('Failed to load library');
    return res.json();
  },

  streamUrl(trackId) {
    return '/api/stream/' + trackId;
  },

  downloadUrl(trackId) {
    return '/api/download/' + trackId;
  },

  coverUrl(albumId) {
    return '/api/cover/' + albumId;
  },

  artistArtUrl(artistName) {
    return '/api/artist-art/' + encodeURIComponent(artistName);
  },

  async scan() {
    const res = await fetch('/api/scan', { method: 'POST' });
    if (!res.ok) throw new Error('Scan failed');
    return res.json();
  },

  async getPlaylists() {
    const res = await fetch('/api/playlists');
    if (!res.ok) throw new Error('Failed to load playlists');
    return res.json();
  },

  async createPlaylist(name) {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error('Failed to create playlist');
    return res.json();
  },

  async updatePlaylist(id, data) {
    const res = await fetch('/api/playlists/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update playlist');
    return res.json();
  },

  async removeTrackFromPlaylist(playlistId, trackId) {
    const playlist = await this.getPlaylists().then(ps => ps.find(p => p.id === playlistId));
    if (!playlist) throw new Error('Playlist not found');
    const newTrackIds = playlist.trackIds.filter(id => id !== trackId);
    return this.updatePlaylist(playlistId, { name: playlist.name, trackIds: newTrackIds });
  },

  async deletePlaylist(id) {
    const res = await fetch('/api/playlists/' + id, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete playlist');
    return res.json();
  },

  async getFavorites() {
    const res = await fetch('/api/favorites');
    if (!res.ok) throw new Error('Failed to load favorites');
    return res.json();
  },

  async toggleFavorite(trackId) {
    const res = await fetch('/api/favorites/' + trackId, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to toggle favorite');
    return res.json();
  },

  async getRecent() {
    const res = await fetch('/api/recent');
    if (!res.ok) throw new Error('Failed to load recent');
    return res.json();
  },

  async addRecent(trackId) {
    const res = await fetch('/api/recent/' + trackId, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Failed to add recent');
    return res.json();
  },

  async getFiles(path) {
    const res = await fetch('/api/admin/files' + (path ? '?path=' + encodeURIComponent(path) : ''));
    if (!res.ok) throw new Error('Failed to get files');
    return res.json();
  },

  async uploadFiles(files, path) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    const res = await fetch('/api/admin/upload' + (path ? '?path=' + encodeURIComponent(path) : ''), {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Failed to upload files');
    return res.json();
  },

  async deleteFile(path) {
    const res = await fetch('/api/admin/files', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    if (!res.ok) throw new Error('Failed to delete file');
    return res.json();
  },

  async createFolder(path, name) {
    const res = await fetch('/api/admin/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name })
    });
    if (!res.ok) throw new Error('Failed to create folder');
    return res.json();
  },

  async metadataScan() {
    const res = await fetch('/api/metadata/scan', { method: 'POST' });
    if (!res.ok) throw new Error('Scan request failed');
    return res.json();
  },

  async metadataScanProgress() {
    try {
      const res = await fetch('/api/metadata/scan-progress');
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataPending() {
    try {
      const res = await fetch('/api/metadata/pending');
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  },

  async metadataAll() {
    try {
      const res = await fetch('/api/metadata/all');
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  },

  async metadataApprove(id) {
    try {
      const res = await fetch('/api/metadata/approve/' + id, { method: 'POST' });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataReject(id) {
    try {
      const res = await fetch('/api/metadata/reject/' + id, { method: 'POST' });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataApproveAll() {
    try {
      const res = await fetch('/api/metadata/approve-all', { method: 'POST' });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataClear() {
    try {
      const res = await fetch('/api/metadata/clear', { method: 'POST' });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataRescanTrack(trackId) {
    try {
      const res = await fetch('/api/metadata/rescan/' + trackId, { method: 'POST' });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataRescanSync(trackId) {
    try {
      const res = await fetch('/api/metadata/rescan-sync/' + trackId, { method: 'POST' });
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  },

  async metadataUpdateTrack(trackId, data) {
    try {
      const res = await fetch('/api/metadata/update-track/' + trackId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataCounts() {
    try {
      const res = await fetch('/api/metadata/counts');
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async metadataUndo(id) {
    const res = await fetch('/api/metadata/undo/' + id, { method: 'POST' });
    if (!res.ok) throw new Error('Undo failed');
    return res.json();
  },

  async getDownloadable() {
    try {
      const res = await fetch('/api/admin/downloads');
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  },

  async toggleDownload(trackId) {
    try {
      const res = await fetch('/api/admin/download-toggle/' + trackId, { method: 'POST' });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async reportDuration(trackId, duration) {
    try {
      await fetch('/api/track-duration/' + trackId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration })
      });
    } catch {}
  },

  finderCoverUrl(mbid) {
    return '/api/finder/cover/' + mbid;
  },

  async finderSearch(query, type) {
    const res = await fetch('/api/finder/search?q=' + encodeURIComponent(query) + '&type=' + (type || 'recording'));
    if (!res.ok) throw new Error('Finder search failed');
    return res.json();
  },

  async finderArtistReleases(mbid) {
    const res = await fetch('/api/finder/artist/' + mbid + '/releases');
    if (!res.ok) throw new Error('Failed to load artist releases');
    return res.json();
  },

  async finderReleaseTracks(mbid) {
    const res = await fetch('/api/finder/release/' + mbid + '/tracks');
    if (!res.ok) throw new Error('Failed to load release tracks');
    return res.json();
  },

  async queueAdd(track) {
    const res = await fetch('/api/queue/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(track)
    });
    if (!res.ok) throw new Error('Failed to add to queue');
    return res.json();
  },

  async queueAddBatch(tracks, overrideDir) {
    const res = await fetch('/api/queue/add-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks, overrideDir })
    });
    if (!res.ok) throw new Error('Failed to add batch to queue');
    return res.json();
  },

  async getQueue(limit) {
    const res = await fetch('/api/queue?limit=' + (limit || 100));
    if (!res.ok) throw new Error('Failed to load queue');
    return res.json();
  },

  async retryJob(id) {
    const res = await fetch('/api/queue/' + id + '/retry', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to retry job');
    return res.json();
  },

  async deleteJob(id) {
    const res = await fetch('/api/queue/' + id + '/delete', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to delete job');
    return res.json();
  }
};

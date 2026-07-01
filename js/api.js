const Api = {
  async getLibrary() {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error('Failed to load library');
    const data = await res.json();
    this._libVersion = data.version;
    return data;
  },

  streamUrl(trackId) {
    return '/api/stream/' + trackId;
  },

  downloadUrl(trackId) {
    return '/api/download/' + trackId;
  },

  coverUrl(albumId) {
    const v = (this._coverVer && this._coverVer[albumId]) || this._libVersion;
    return '/api/cover/' + albumId + (v ? '?v=' + v : '');
  },

  bustCover(albumId) {
    this._coverVer = this._coverVer || {};
    this._coverVer[albumId] = Date.now();
  },

  artistArtUrl(artistName) {
    return '/api/artist-art/' + encodeURIComponent(artistName);
  },

  async scan() {
    const res = await fetch('/api/scan', { method: 'POST' });
    if (!res.ok) throw new Error('Scan failed');
    return res.json();
  },

  async getStats() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  metadataPreview(files, onProgress) {
    return new Promise((resolve, reject) => {
      const audioExts = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus', 'wma'];
      const form = new FormData();
      let count = 0;
      for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (audioExts.indexOf(ext) === -1) continue;
        const rel = file.webkitRelativePath || file.name;
        form.append('files', file, rel);
        count++;
      }
      if (count === 0) { resolve({ tracks: [] }); return; }
      // XMLHttpRequest used for upload progress tracking (fetch does not expose upload progress)
      const xhr = new XMLHttpRequest();
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        });
      }
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Preview failed')); }
        } else { reject(new Error('Preview failed')); }
      });
      xhr.addEventListener('error', () => reject(new Error('Preview failed')));
      xhr.open('POST', '/api/metadata-preview');
      xhr.send(form);
    });
  },

  libraryUploadProgress(files, onProgress) {
    return new Promise((resolve, reject) => {
      const audioExts = ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus', 'wma'];
      const form = new FormData();
      let count = 0;
      for (const file of files) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (audioExts.indexOf(ext) === -1) continue;
        const rel = file.webkitRelativePath || file.name;
        form.append('files', file, rel);
        count++;
      }
      if (count === 0) { resolve({ uploaded: [], errors: ['No audio files selected'] }); return; }
      // XMLHttpRequest used for upload progress tracking (fetch does not expose upload progress)
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Upload failed')); }
        } else { reject(new Error('Upload failed')); }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.open('POST', '/api/library-upload');
      xhr.send(form);
    });
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

  async metadataSearch(query) {
    const res = await fetch('/api/metadata/search?q=' + encodeURIComponent(query));
    if (!res.ok) return [];
    return res.json();
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

  async enableAllDownloads() {
    const res = await fetch('/api/admin/downloads-enable-all', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async getWaveform(trackId, retries = 3) {
    try {
      const res = await fetch('/api/waveform/' + trackId);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.pending && retries > 0) {
        await new Promise(r => setTimeout(r, 1500));
        return this.getWaveform(trackId, retries - 1);
      }
      return data;
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

  async finderYouTubeSearch(query) {
    const res = await fetch('/api/finder/youtube?q=' + encodeURIComponent(query));
    if (!res.ok) throw new Error('YouTube search failed');
    return res.json();
  },

  async finderArtistReleases(mbid) {
    const res = await fetch('/api/finder/artist/' + mbid + '/releases');
    if (!res.ok) throw new Error('Failed to load artist releases');
    return res.json();
  },

  async finderArtistTracks(mbid, artistName, offset) {
    const params = 'artist=' + encodeURIComponent(artistName) + '&offset=' + (offset || 0) + '&limit=100';
    const res = await fetch('/api/finder/artist/' + mbid + '/tracks?' + params);
    if (!res.ok) throw new Error('Failed to load artist tracks');
    return res.json();
  },

  async artistTrackProgress() {
    const res = await fetch('/api/finder/artist-track-progress');
    if (!res.ok) throw new Error('Failed to load progress');
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
    if (!res.ok) {
      let msg = 'Failed to add to queue';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
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
  },

  async selectVideo(jobId, videoId) {
    const res = await fetch('/api/queue/' + jobId + '/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId })
    });
    if (!res.ok) throw new Error('Failed to select video');
    return res.json();
  },

  async clearCompletedJobs() {
    const res = await fetch('/api/queue/clear-completed', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to clear jobs');
    return res.json();
  },

  async getQueueCounts() {
    const res = await fetch('/api/queue/counts');
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async testSlskConnect(payload) {
    try {
      const res = await fetch('/api/soulseek/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        let msg = 'Connection test failed';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        return { error: msg };
      }
      return res.json();
    } catch (e) {
      return { error: 'Network error: ' + e.message };
    }
  },

  async bulkImport(lines) {
    const res = await fetch('/api/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines })
    });
    if (!res.ok) throw new Error('Bulk import failed');
    return res.json();
  },

  async getSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async saveSettings(settings) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async uploadCookies(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/cookies/upload', { method: 'POST', body: form });
    if (!res.ok) {
      let msg = 'Upload failed';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  async clearCookies() {
    const res = await fetch('/api/cookies/clear', { method: 'POST' });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async extractCookies(browser) {
    const res = await fetch('/api/cookies/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser })
    });
    if (!res.ok) {
      let msg = 'Extraction failed';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  async getCookiesStatus() {
    try {
      const res = await fetch('/api/cookies/status');
      if (!res.ok) return { active: false };
      return res.json();
    } catch { return { active: false }; }
  },

  async importPlaylist(url) {
    const res = await fetch('/api/playlist-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res.ok) {
      let msg = 'Import failed';
      try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  async getWatched() {
    const res = await fetch('/api/watch');
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async watchPlaylist(url) {
    const res = await fetch('/api/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async refreshWatch(id) {
    const res = await fetch('/api/watch/' + id + '/refresh');
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async deleteWatch(id) {
    const res = await fetch('/api/watch/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async toggleWatch(id, watching) {
    const res = await fetch('/api/watch/' + id + '/toggle', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watching })
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async previewUrl(videoId) {
    const res = await fetch('/api/preview/' + videoId);
    if (!res.ok) throw new Error('Preview failed');
    return res.json();
  },

  downloadJobUrl(jobId) {
    return '/api/download-job/' + jobId;
  },

  async shareQueue(trackIds) {
    const res = await fetch('/api/shared-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackIds })
    });
    if (!res.ok) throw new Error('Failed to share queue');
    return res.json();
  },

  async getSharedQueue(id) {
    const res = await fetch('/api/shared-queue/' + id);
    if (!res.ok) throw new Error('Failed to load shared queue');
    return res.json();
  },

  async getReviewTracks(offset = 0, limit = 200, flags = []) {
    try {
      let url = '/api/review/tracks?offset=' + offset + '&limit=' + limit;
      for (const f of flags) { url += '&flag=' + encodeURIComponent(f); }
      const res = await fetch(url);
      if (!res.ok) return { tracks: [], total: 0 };
      const data = await res.json();
      if (!data || !Array.isArray(data.tracks)) return { tracks: [], total: 0 };
      return data;
    } catch { return { tracks: [], total: 0 }; }
  },

  async getReviewCounts() {
    try {
      const res = await fetch('/api/review/counts');
      if (!res.ok) return { unchecked: 0, needs_review: 0, reviewed_ok: 0 };
      return res.json();
    } catch { return { unchecked: 0, needs_review: 0, reviewed_ok: 0 }; }
  },

  async reviewMarkOk(trackId) {
    const res = await fetch('/api/review/mark-ok', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId })
    });
    if (!res.ok) throw new Error('Failed to mark ok');
    return res.json();
  },

  async reviewEditMeta(trackId, fields) {
    const res = await fetch('/api/review/edit-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId, fields })
    });
    if (!res.ok) throw new Error('Failed to edit metadata');
    return res.json();
  },

  async uploadCustomCover(trackId, file) {
    const form = new FormData();
    form.append('trackId', trackId);
    form.append('cover', file);
    const res = await fetch('/api/review/upload-cover', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Failed to upload cover');
    const data = await res.json();
    if (data.albumId) this.bustCover(data.albumId);
    return data;
  },

  async clearCustomCover(trackId) {
    const res = await fetch('/api/review/clear-cover?trackId=' + encodeURIComponent(trackId), { method: 'POST' });
    if (!res.ok) throw new Error('Failed to clear cover');
    const data = await res.json();
    if (data.cleared) {
      const track = Store.getTrack(trackId);
      if (track) this.bustCover(track.albumID);
    }
    return data;
  },

  async reviewDelete(trackId) {
    const res = await fetch('/api/review/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId })
    });
    if (!res.ok) throw new Error('Failed to delete');
    return res.json();
  },

  async reviewDeleteAll() {
    const res = await fetch('/api/review/delete-all', { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    return res.json();
  },

  async reviewBulkDelete(flags = []) {
    const res = await fetch('/api/review/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flags })
    });
    if (!res.ok) throw new Error('Failed to delete');
    return res.json();
  },

  async reviewBulkApprove(flags = []) {
    const res = await fetch('/api/review/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flags })
    });
    if (!res.ok) throw new Error('Failed to approve');
    return res.json();
  },

  async reviewRecheckAll() {
    const res = await fetch('/api/review/recheck-all', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to recheck');
    return res.json();
  },

  async getReviewProgress() {
    try {
      const res = await fetch('/api/review/progress');
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  },

  async getReviewLog() {
    try {
      const res = await fetch('/api/review/log');
      if (!res.ok) return '';
      return res.text();
    } catch { return ''; }
  },

  async toggleDownloadPause() {
    const res = await fetch('/api/queue/toggle-pause', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to toggle pause');
    return res.json();
  },

  async getWorkers() {
    const res = await fetch('/api/workers', { credentials: 'include' });
    if (!res.ok) return [];
    return res.json();
  },

  async runWorker(name) {
    const res = await fetch('/api/workers/run?name=' + encodeURIComponent(name), { method: 'POST', credentials: 'include' });
    return res.json();
  }
};

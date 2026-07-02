const Api = {
  // Centralized fetch helper. method defaults to GET. body auto-serialized to JSON
  // unless it's FormData. fallback !== undefined suppresses throwing and returns
  // fallback on HTTP error or network failure. errMsg is the default thrown message;
  // server-sent j.error is preferred when present (only when throwing).
  async _req(url, opts = {}) {
    const { method = 'GET', body, fallback, errMsg, credentials } = opts;
    try {
      const fetchOpts = { method };
      if (credentials) fetchOpts.credentials = 'include';
      if (body !== undefined) {
        if (body instanceof FormData) { fetchOpts.body = body; }
        else { fetchOpts.headers = { 'Content-Type': 'application/json' }; fetchOpts.body = JSON.stringify(body); }
      }
      const res = await fetch(url, fetchOpts);
      if (!res.ok) {
        if (fallback !== undefined) return fallback;
        let msg = errMsg || 'Request failed';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      return res.json();
    } catch (e) {
      if (fallback !== undefined) return fallback;
      throw e;
    }
  },

  // ── URL builders ──
  streamUrl(id) { return '/api/stream/' + id; },
  downloadUrl(id) { return '/api/download/' + id; },
  coverUrl(albumId) {
    const v = (this._coverVer && this._coverVer[albumId]) || this._libVersion;
    return '/api/cover/' + albumId + (v ? '?v=' + v : '');
  },
  bustCover(albumId) {
    this._coverVer = this._coverVer || {};
    this._coverVer[albumId] = Date.now();
  },
  artistArtUrl(name) { return '/api/artist-art/' + encodeURIComponent(name); },
  finderCoverUrl(mbid) { return '/api/finder/cover/' + mbid; },
  downloadJobUrl(id) { return '/api/download-job/' + id; },

  // ── GET (throw on error) ──
  getLibrary() {
    return this._req('/api/library', { errMsg: 'Failed to load library' }).then(d => { this._libVersion = d.version; return d; });
  },
  getPlaylists() { return this._req('/api/playlists', { errMsg: 'Failed to load playlists' }); },
  getFavorites() { return this._req('/api/favorites', { errMsg: 'Failed to load favorites' }); },
  getRecent() { return this._req('/api/recent', { errMsg: 'Failed to load recent' }); },
  getFiles(path) { return this._req('/api/admin/files' + (path ? '?path=' + encodeURIComponent(path) : ''), { errMsg: 'Failed to get files' }); },
  metadataUndo(id) { return this._req('/api/metadata/undo/' + id, { method: 'POST', errMsg: 'Undo failed' }); },
  finderSearch(q, type) { return this._req('/api/finder/search?q=' + encodeURIComponent(q) + '&type=' + (type || 'recording'), { errMsg: 'Finder search failed' }); },
  finderYouTubeSearch(q) { return this._req('/api/finder/youtube?q=' + encodeURIComponent(q), { errMsg: 'YouTube search failed' }); },
  finderArtistReleases(mbid) { return this._req('/api/finder/artist/' + mbid + '/releases', { errMsg: 'Failed to load artist releases' }); },
  finderArtistTracks(mbid, artist, offset) {
    const p = 'artist=' + encodeURIComponent(artist) + '&offset=' + (offset || 0) + '&limit=100';
    return this._req('/api/finder/artist/' + mbid + '/tracks?' + p, { errMsg: 'Failed to load artist tracks' });
  },
  finderReleaseTracks(mbid) { return this._req('/api/finder/release/' + mbid + '/tracks', { errMsg: 'Failed to load release tracks' }); },
  artistTrackProgress() { return this._req('/api/finder/artist-track-progress', { errMsg: 'Failed to load progress' }); },
  getQueue(limit) { return this._req('/api/queue?limit=' + (limit || 100), { errMsg: 'Failed to load queue' }); },
  getWatched() { return this._req('/api/watch', { errMsg: 'Failed' }); },
  getSharedQueue(id) { return this._req('/api/shared-queue/' + id, { errMsg: 'Failed to load shared queue' }); },
  previewUrl(videoId) { return this._req('/api/preview/' + videoId, { errMsg: 'Preview failed' }); },
  getQueueCounts() { return this._req('/api/queue/counts', { errMsg: 'Failed' }); },
  getSettings() { return this._req('/api/settings', { errMsg: 'Failed' }); },

  // ── GET (fallback on error) ──
  getStats() { return this._req('/api/stats', { fallback: null }); },
  metadataScanProgress() { return this._req('/api/metadata/scan-progress', { fallback: null }); },
  metadataPending() { return this._req('/api/metadata/pending', { fallback: [] }); },
  metadataAll() { return this._req('/api/metadata/all', { fallback: [] }); },
  metadataCounts() { return this._req('/api/metadata/counts', { fallback: null }); },
  getDownloadable() { return this._req('/api/admin/downloads', { fallback: [] }); },
  getCookiesStatus() { return this._req('/api/cookies/status', { fallback: { active: false } }); },
  getReviewProgress() { return this._req('/api/review/progress', { fallback: null }); },
  getWorkers() { return this._req('/api/workers', { fallback: [], credentials: 'include' }); },
  getReviewCounts() { return this._req('/api/review/counts', { fallback: { unchecked: 0, needs_review: 0, reviewed_ok: 0 } }); },
  getReviewTracks(offset = 0, limit = 200, flags = []) {
    let url = '/api/review/tracks?offset=' + offset + '&limit=' + limit;
    for (const f of flags) url += '&flag=' + encodeURIComponent(f);
    return this._req(url, { fallback: { tracks: [], total: 0 } }).then(d => {
      if (!d || !Array.isArray(d.tracks)) return { tracks: [], total: 0 };
      return d;
    });
  },
  metadataSearch(query) { return this._req('/api/metadata/search?q=' + encodeURIComponent(query), { fallback: [] }); },

  // ── POST/PUT/DELETE (throw on error) ──
  scan() { return this._req('/api/scan', { method: 'POST', errMsg: 'Scan failed' }); },
  createPlaylist(name) { return this._req('/api/playlists', { method: 'POST', body: { name }, errMsg: 'Failed to create playlist' }); },
  updatePlaylist(id, data) { return this._req('/api/playlists/' + id, { method: 'PUT', body: data, errMsg: 'Failed to update playlist' }); },
  deletePlaylist(id) { return this._req('/api/playlists/' + id, { method: 'DELETE', errMsg: 'Failed to delete playlist' }); },
  toggleFavorite(id) { return this._req('/api/favorites/' + id, { method: 'POST', errMsg: 'Failed to toggle favorite' }); },
  addRecent(id) { return this._req('/api/recent/' + id, { method: 'POST', errMsg: 'Failed to add recent' }); },
  deleteFile(path) { return this._req('/api/admin/files', { method: 'DELETE', body: { path }, errMsg: 'Failed to delete file' }); },
  createFolder(path, name) { return this._req('/api/admin/folders', { method: 'POST', body: { path, name }, errMsg: 'Failed to create folder' }); },
  metadataScan() { return this._req('/api/metadata/scan', { method: 'POST', errMsg: 'Scan request failed' }); },
  queueAddBatch(tracks, overrideDir) { return this._req('/api/queue/add-batch', { method: 'POST', body: { tracks, overrideDir }, errMsg: 'Failed to add batch to queue' }); },
  selectVideo(jobId, videoId) { return this._req('/api/queue/' + jobId + '/select', { method: 'POST', body: { videoId }, errMsg: 'Failed to select video' }); },
  retryJob(id) { return this._req('/api/queue/' + id + '/retry', { method: 'POST', errMsg: 'Failed to retry job' }); },
  deleteJob(id) { return this._req('/api/queue/' + id + '/delete', { method: 'POST', errMsg: 'Failed to delete job' }); },
  clearCompletedJobs() { return this._req('/api/queue/clear-completed', { method: 'POST', errMsg: 'Failed to clear jobs' }); },
  toggleDownloadPause() { return this._req('/api/queue/toggle-pause', { method: 'POST', errMsg: 'Failed to toggle pause' }); },
  enableAllDownloads() { return this._req('/api/admin/downloads-enable-all', { method: 'POST', errMsg: 'Failed' }); },
  bulkImport(lines) { return this._req('/api/bulk-import', { method: 'POST', body: { lines }, errMsg: 'Bulk import failed' }); },
  saveSettings(s) { return this._req('/api/settings', { method: 'POST', body: s, errMsg: 'Failed' }); },
  shareQueue(trackIds) { return this._req('/api/shared-queue', { method: 'POST', body: { trackIds }, errMsg: 'Failed to share queue' }); },
  watchPlaylist(url) { return this._req('/api/watch', { method: 'POST', body: { url }, errMsg: 'Failed' }); },
  refreshWatch(id) { return this._req('/api/watch/' + id + '/refresh', { errMsg: 'Failed' }); },
  deleteWatch(id) { return this._req('/api/watch/' + id, { method: 'DELETE', errMsg: 'Failed' }); },
  toggleWatch(id, watching) { return this._req('/api/watch/' + id + '/toggle', { method: 'PUT', body: { watching }, errMsg: 'Failed' }); },
  reviewMarkOk(trackId) { return this._req('/api/review/mark-ok', { method: 'POST', body: { trackId }, errMsg: 'Failed to mark ok' }); },
  reviewEditMeta(trackId, fields) { return this._req('/api/review/edit-meta', { method: 'POST', body: { trackId, fields }, errMsg: 'Failed to edit metadata' }); },
  reviewDelete(trackId) { return this._req('/api/review/delete', { method: 'DELETE', body: { trackId }, errMsg: 'Failed to delete' }); },
  reviewDeleteAll() { return this._req('/api/review/delete-all', { method: 'DELETE', errMsg: 'Failed to delete' }); },
  reviewBulkDelete(flags = []) { return this._req('/api/review/bulk-delete', { method: 'POST', body: { flags }, errMsg: 'Failed to delete' }); },
  reviewBulkApprove(flags = []) { return this._req('/api/review/bulk-approve', { method: 'POST', body: { flags }, errMsg: 'Failed to approve' }); },
  reviewRecheckAll() { return this._req('/api/review/recheck-all', { method: 'POST', errMsg: 'Failed to recheck' }); },
  clearCookies() { return this._req('/api/cookies/clear', { method: 'POST', errMsg: 'Failed' }); },

  // POST that extracts server error (errMsg default, j.error preferred)
  queueAdd(track) { return this._req('/api/queue/add', { method: 'POST', body: track, errMsg: 'Failed to add to queue' }); },
  uploadCookies(file) {
    const form = new FormData(); form.append('file', file);
    return this._req('/api/cookies/upload', { method: 'POST', body: form, errMsg: 'Upload failed' });
  },
  extractCookies(browser) { return this._req('/api/cookies/extract', { method: 'POST', body: { browser }, errMsg: 'Extraction failed' }); },
  importPlaylist(url) { return this._req('/api/playlist-import', { method: 'POST', body: { url }, errMsg: 'Import failed' }); },

  // ── POST (fallback on error) ──
  metadataApprove(id) { return this._req('/api/metadata/approve/' + id, { method: 'POST', fallback: null }); },
  metadataReject(id) { return this._req('/api/metadata/reject/' + id, { method: 'POST', fallback: null }); },
  metadataApproveAll() { return this._req('/api/metadata/approve-all', { method: 'POST', fallback: null }); },
  metadataClear() { return this._req('/api/metadata/clear', { method: 'POST', fallback: null }); },
  metadataRescanTrack(id) { return this._req('/api/metadata/rescan/' + id, { method: 'POST', fallback: null }); },
  metadataRescanSync(id) { return this._req('/api/metadata/rescan-sync/' + id, { method: 'POST', fallback: [] }); },
  metadataUpdateTrack(id, data) { return this._req('/api/metadata/update-track/' + id, { method: 'POST', body: data, fallback: null }); },
  toggleDownload(id) { return this._req('/api/admin/download-toggle/' + id, { method: 'POST', fallback: null }); },
  reportDuration(id, duration) { return this._req('/api/track-duration/' + id, { method: 'POST', body: { duration }, fallback: null }); },
  uploadFiles(files, path) {
    const form = new FormData();
    for (let i = 0; i < files.length; i++) form.append('files', files[i]);
    return this._req('/api/admin/upload' + (path ? '?path=' + encodeURIComponent(path) : ''), { method: 'POST', body: form, errMsg: 'Failed to upload files' });
  },
  uploadCustomCover(trackId, file) {
    const form = new FormData();
    form.append('trackId', trackId); form.append('cover', file);
    return this._req('/api/review/upload-cover', { method: 'POST', body: form, errMsg: 'Failed to upload cover' }).then(d => { if (d.albumId) this.bustCover(d.albumId); return d; });
  },

  // ── Custom (not _req-compatible) ──
  async removeTrackFromPlaylist(playlistId, trackId) {
    const playlist = await this.getPlaylists().then(ps => ps.find(p => p.id === playlistId));
    if (!playlist) throw new Error('Playlist not found');
    const newTrackIds = playlist.trackIds.filter(id => id !== trackId);
    return this.updatePlaylist(playlistId, { name: playlist.name, trackIds: newTrackIds });
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

  async getReviewLog() {
    try {
      const res = await fetch('/api/review/log');
      if (!res.ok) return '';
      return res.text();
    } catch { return ''; }
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

  async runWorker(name) {
    const res = await fetch('/api/workers/run?name=' + encodeURIComponent(name), { method: 'POST', credentials: 'include' });
    return res.json();
  },

  // XHR-based (upload progress not available via fetch)
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
  }
};
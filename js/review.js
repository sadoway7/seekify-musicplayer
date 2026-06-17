const ReviewUI = {
  overlay: null,
  dropdown: null,
  currentTrackId: null,

  init() {
    this.overlay = document.getElementById('np-review-overlay');
    this.dropdown = document.getElementById('np-review-dropdown');
    if (!this.overlay) return;

    document.addEventListener('click', (e) => {
      if (!this.dropdown) return;
      if (this.dropdown.contains(e.target)) return;
      if (this.overlay && this.overlay.contains(e.target)) return;
      if (this._dropdownTrigger && this._dropdownTrigger.contains(e.target)) return;
      this.hideDropdown();
    });

    const coverInput = document.getElementById('edit-meta-cover-input');
    if (coverInput) {
      coverInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        const modal = document.getElementById('edit-meta-modal');
        const preview = document.getElementById('edit-meta-cover-preview');
        const hint = document.getElementById('edit-meta-cover-hint');
        if (file && modal) {
          modal._coverFile = file;
          if (preview) preview.src = URL.createObjectURL(file);
          if (hint) hint.textContent = file.name;
        }
      });
    }
  },

  updateForTrack(track) {
    if (!this.overlay) return;
    const fresh = track ? Store.getTrack(track.id) : null;
    if (fresh && fresh.reviewStatus === 'needs_review') {
      this.currentTrackId = fresh.id;
      this.onActionDone = null;
      this._dropdownTrigger = null;
      this.overlay.classList.add('visible');
    } else {
      this.currentTrackId = null;
      this.overlay.classList.remove('visible');
      this.hideDropdown();
    }
  },

  toggleDropdown() {
    if (!this.dropdown) return;
    this.onActionDone = null;
    this._dropdownTrigger = null;
    try {
      if (!this.dropdown.classList.contains('visible') && this.currentTrackId) {
        const track = Store.getTrack(this.currentTrackId);
        this._renderFlags(track ? (track.reviewFlags || []) : []);
      }
    } catch (e) {}
    this.dropdown.classList.toggle('visible');
  },

  showDropdownForTrack(trackId, triggerEl, onDone) {
    if (!this.dropdown || !trackId) return;
    this.currentTrackId = trackId;
    this.onActionDone = onDone || null;
    this._dropdownTrigger = triggerEl || null;
    const track = Store.getTrack(trackId);
    this._renderFlags(track ? (track.reviewFlags || []) : []);
    this.dropdown.classList.add('visible');
  },

  hideDropdown() {
    if (this.dropdown) {
      this.dropdown.classList.remove('visible');
    }
  },

  _renderFlags(flags) {
    const container = document.getElementById('np-review-flags');
    if (!container) return;
    if (!flags || flags.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';
    const descriptions = {
      missing_title: 'Title tag is empty or generic',
      missing_artist: 'Artist tag is empty or "Unknown"',
      missing_album: 'Album tag is empty or "Unknown"',
      missing_track_number: 'No track number set',
      missing_genre: 'No genre tag',
      no_cover: 'No cover art embedded',
      suspicious_title: 'Title contains suspicious keywords',
      suspicious_video: 'Title suggests video content',
      suspicious_cover: 'Title suggests karaoke or tribute',
      filename_derived: 'Title appears copied from filename',
      artist_equals_title: 'Artist and title are identical',
      very_short_title: 'Title is fewer than 3 characters',
      very_long_title: 'Title exceeds 200 characters',
      short_duration: 'Track is under 30 seconds',
      long_duration: 'Track exceeds 9 minutes (with other flags)',
      potential_duplicate: 'Similar title found from same artist'
    };
    let html = '<div class="np-review-flags-title">Flagged for review:</div>';
    flags.forEach(f => {
      html += '<div class="np-review-flag-item">'
        + '<span class="np-review-flag-label">' + this.flagLabel(f) + '</span>'
        + '<span class="np-review-flag-desc">' + (descriptions[f] || f) + '</span>'
        + '</div>';
    });
    container.innerHTML = html;
  },

  rescrapMetadata(trackId) {
    this.hideDropdown();
    if (trackId) {
      UI._showRescanModal(trackId);
    }
  },

  async markOk(trackId) {
    try {
      await Api.reviewMarkOk(trackId);
      this.hideDropdown();
      Store.reviewCounts.needs_review = Math.max(0, (Store.reviewCounts.needs_review || 0) - 1);
      Store.reviewCounts.reviewed_ok = (Store.reviewCounts.reviewed_ok || 0) + 1;
      if (trackId === this.currentTrackId) {
        this.overlay.classList.remove('visible');
        this.currentTrackId = null;
      }
      const track = Store.getTrack(trackId);
      if (track) {
        track.reviewStatus = 'reviewed_ok';
        track.reviewFlags = [];
      }
      UI.showToast('Marked as reviewed');
      if (this.onActionDone) { const cb = this.onActionDone; this.onActionDone = null; cb(); }
    } catch (e) {
      UI.showToast('Failed to mark as reviewed');
    }
  },

  showEditMetaModal(trackId) {
    this.hideDropdown();
    const track = Store.getTrack(trackId);
    if (!track) return;

    const modal = document.getElementById('edit-meta-modal');
    if (!modal) return;

    const fields = modal.querySelectorAll('.edit-meta-field input');
    fields.forEach(input => {
      const field = input.dataset.field;
      if (field === 'trackNumber') input.value = track.trackNumber || '';
      else if (field === 'year') input.value = track.year || '';
      else if (track[field] !== undefined) input.value = track[field] || '';
    });

    const preview = document.getElementById('edit-meta-cover-preview');
    const coverInput = document.getElementById('edit-meta-cover-input');
    const coverHint = document.getElementById('edit-meta-cover-hint');
    if (preview) {
      preview.src = track.albumID ? Api.coverUrl(track.albumID) : '';
    }
    if (coverInput) coverInput.value = '';
    if (coverHint) coverHint.textContent = '';
    modal._coverFile = null;

    modal.classList.remove('hidden');
    modal._trackId = trackId;
  },

  closeEditMetaModal() {
    const modal = document.getElementById('edit-meta-modal');
    if (modal) {
      UI._closeSheetModal(modal);
      modal._trackId = null;
    }
  },

  deleteFromEditMeta() {
    const modal = document.getElementById('edit-meta-modal');
    if (!modal || !modal._trackId) return;
    const trackId = modal._trackId;
    this.closeEditMetaModal();
    this.deleteTrack(trackId, true);
  },

  async clearCover() {
    const modal = document.getElementById('edit-meta-modal');
    if (!modal || !modal._trackId) return;
    const trackId = modal._trackId;
    try {
      const data = await Api.clearCustomCover(trackId);
      if (!data.cleared) {
        UI.showToast('No custom cover set');
        return;
      }
      await Store.refreshLibrary();
      const preview = document.getElementById('edit-meta-cover-preview');
      if (preview && Store.getTrack(trackId)) {
        preview.src = Api.coverUrl(Store.getTrack(trackId).albumID);
      }
      const cur = Player.getCurrentTrack();
      if (cur && cur.id === trackId) {
        const fresh = Store.getTrack(trackId);
        if (fresh) {
          Object.assign(cur, fresh);
          UI.updateMiniPlayer();
          UI.updateNowPlaying();
        }
      }
      UI.renderPage();
      UI.showToast('Cover reset');
    } catch (e) {
      UI.showToast('Failed to clear cover');
    }
  },

  async saveEditMeta() {
    const modal = document.getElementById('edit-meta-modal');
    if (!modal || !modal._trackId) return;

    const fields = {};
    modal.querySelectorAll('.edit-meta-field input').forEach(input => {
      const field = input.dataset.field;
      let val = input.value.trim();
      if (field === 'trackNumber' || field === 'year') {
        const num = parseInt(val, 10);
        if (!isNaN(num) && num > 0) fields[field] = num;
      } else if (val) {
        fields[field] = val;
      }
    });

    try {
      const trackId = modal._trackId;
      await Api.reviewEditMeta(trackId, fields);
      if (modal._coverFile) {
        await Api.uploadCustomCover(trackId, modal._coverFile);
      }
      this.closeEditMetaModal();
      await Store.refreshLibrary();
      if (trackId === this.currentTrackId) {
        this.overlay.classList.remove('visible');
        this.currentTrackId = null;
      }
      const cur = Player.getCurrentTrack();
      if (cur && cur.id === trackId) {
        const fresh = Store.getTrack(trackId);
        if (fresh) {
          Object.assign(cur, fresh);
          UI.updateMiniPlayer();
          UI.updateNowPlaying();
        }
      }
      UI.renderPage();
      UI.showToast('Metadata updated');
    } catch (e) {
      UI.showToast('Failed to update metadata');
    }
  },

  async deleteTrack(trackId, skip) {
    this.hideDropdown();
    this._showDeleteConfirm(trackId, skip !== false);
  },

  _showDeleteConfirm(trackId, skip) {
    const existing = document.getElementById('review-delete-confirm');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'review-delete-confirm';
    el.innerHTML = '<div class="review-confirm-overlay">'
      + '<div class="review-confirm-box">'
      + '<div class="review-confirm-title">Delete File</div>'
      + '<div class="review-confirm-desc">This will permanently delete the file from disk. This cannot be undone.</div>'
      + '<div class="review-confirm-actions">'
      + '<button class="review-confirm-cancel" id="review-delete-cancel">Cancel</button>'
      + '<button class="review-confirm-delete" id="review-delete-confirm-btn">Delete</button>'
      + '</div></div></div>';
    document.body.appendChild(el);

    document.getElementById('review-delete-cancel').addEventListener('click', () => el.remove());
    document.getElementById('review-delete-confirm-btn').addEventListener('click', async () => {
      el.querySelector('.review-confirm-box').innerHTML = '<div class="loading-spinner" style="margin:24px auto"></div>';
      try {
        await Api.reviewDelete(trackId);
        Store.reviewCounts.needs_review = Math.max(0, (Store.reviewCounts.needs_review || 0) - 1);
        if (trackId === this.currentTrackId) {
          this.overlay.classList.remove('visible');
          this.currentTrackId = null;
        }
        await Store.refreshLibrary();
        el.remove();
        UI.showToast('File deleted');
        const playing = Player.getCurrentTrack();
        if (skip && playing && playing.id === trackId) Player.next();
        if (this.onActionDone) { const cb = this.onActionDone; this.onActionDone = null; cb(); }
      } catch (e) {
        el.remove();
        UI.showToast('Failed to delete file');
      }
    });
  },

  deleteAllFlagged(onDone) {
    const existing = document.getElementById('review-delete-confirm');
    if (existing) existing.remove();

    const count = (UI._reviewTotal || Store.reviewCounts.needs_review || 0);
    const el = document.createElement('div');
    el.id = 'review-delete-confirm';
    el.innerHTML = '<div class="review-confirm-overlay">'
      + '<div class="review-confirm-box">'
      + '<div class="review-confirm-title">Delete All Flagged Tracks</div>'
      + '<div class="review-confirm-desc">This will permanently delete every track currently flagged for review (' + count + '). This cannot be undone.</div>'
      + '<div class="review-confirm-actions">'
      + '<button class="review-confirm-cancel" id="review-delete-cancel">Cancel</button>'
      + '<button class="review-confirm-delete" id="review-delete-confirm-btn">Delete All</button>'
      + '</div></div></div>';
    document.body.appendChild(el);

    document.getElementById('review-delete-cancel').addEventListener('click', () => el.remove());
    document.getElementById('review-delete-confirm-btn').addEventListener('click', async () => {
      el.querySelector('.review-confirm-box').innerHTML = '<div class="loading-spinner" style="margin:24px auto"></div>';
      try {
        const data = await Api.reviewDeleteAll();
        Store.reviewCounts.needs_review = 0;
        this.overlay.classList.remove('visible');
        this.currentTrackId = null;
        await Store.refreshLibrary();
        el.remove();
        UI.showToast((data && data.deleted != null ? data.deleted : 0) + ' files deleted');
        if (typeof onDone === 'function') onDone();
      } catch (e) {
        el.remove();
        UI.showToast('Failed to delete files');
      }
    });
  },

  flagLabel(flag) {
    const labels = {
      missing_title: 'Missing Title',
      missing_artist: 'Missing Artist',
      missing_album: 'Missing Album',
      missing_track_number: 'No Track #',
      missing_genre: 'No Genre',
      no_cover: 'No Cover Art',
      suspicious_title: 'Suspicious Title',
      suspicious_video: 'Video Content',
      suspicious_cover: 'Cover Version',
      filename_derived: 'Filename as Title',
      artist_equals_title: 'Artist = Title',
      very_short_title: 'Very Short Title',
      very_long_title: 'Very Long Title',
      short_duration: 'Short Duration',
      long_duration: 'Long Duration',
      potential_duplicate: 'Possible Duplicate'
    };
    return labels[flag] || flag;
  }
};

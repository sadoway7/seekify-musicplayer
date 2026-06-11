const ReviewUI = {
  overlay: null,
  dropdown: null,
  currentTrackId: null,

  init() {
    this.overlay = document.getElementById('np-review-overlay');
    this.dropdown = document.getElementById('np-review-dropdown');
    if (!this.overlay) return;

    document.addEventListener('click', (e) => {
      if (this.dropdown && !this.dropdown.contains(e.target) && !this.overlay.contains(e.target)) {
        this.hideDropdown();
      }
    });
  },

  updateForTrack(track) {
    if (!this.overlay) return;
    const fresh = track ? Store.getTrack(track.id) : null;
    if (fresh && fresh.reviewStatus === 'needs_review') {
      this.currentTrackId = fresh.id;
      this.overlay.classList.add('visible');
    } else {
      this.currentTrackId = null;
      this.overlay.classList.remove('visible');
      this.hideDropdown();
    }
  },

  toggleDropdown() {
    if (!this.dropdown) return;
    try {
      if (!this.dropdown.classList.contains('visible') && this.currentTrackId) {
        const track = Store.getTrack(this.currentTrackId);
        this._renderFlags(track ? (track.reviewFlags || []) : []);
      }
    } catch (e) {}
    this.dropdown.classList.toggle('visible');
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
      Player.next();
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

    modal.classList.remove('hidden');
    modal._trackId = trackId;
  },

  closeEditMetaModal() {
    const modal = document.getElementById('edit-meta-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal._trackId = null;
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
      await Api.reviewEditMeta(modal._trackId, fields);
      this.closeEditMetaModal();
      await Store.refreshLibrary();
      if (modal._trackId === this.currentTrackId) {
        this.overlay.classList.remove('visible');
        this.currentTrackId = null;
      }
      UI.showToast('Metadata updated');
      Player.next();
    } catch (e) {
      UI.showToast('Failed to update metadata');
    }
  },

  async deleteTrack(trackId) {
    this.hideDropdown();
    this._showDeleteConfirm(trackId);
  },

  _showDeleteConfirm(trackId) {
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
        Player.next();
      } catch (e) {
        el.remove();
        UI.showToast('Failed to delete file');
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

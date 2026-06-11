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
    if (track && track.reviewStatus === 'needs_review') {
      this.currentTrackId = track.id;
      this.overlay.classList.add('visible');
    } else {
      this.currentTrackId = null;
      this.overlay.classList.remove('visible');
      this.hideDropdown();
    }
  },

  toggleDropdown() {
    if (!this.dropdown) return;
    this.dropdown.classList.toggle('visible');
  },

  hideDropdown() {
    if (this.dropdown) {
      this.dropdown.classList.remove('visible');
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
    } catch (e) {
      UI.showToast('Failed to update metadata');
    }
  },

  async deleteTrack(trackId) {
    this.hideDropdown();
    if (!confirm('Delete this file permanently? This cannot be undone.')) return;

    try {
      await Api.reviewDelete(trackId);
      Store.reviewCounts.needs_review = Math.max(0, (Store.reviewCounts.needs_review || 0) - 1);
      if (trackId === this.currentTrackId) {
        this.overlay.classList.remove('visible');
        this.currentTrackId = null;
      }
      await Store.refreshLibrary();
      UI.showToast('File deleted');
    } catch (e) {
      UI.showToast('Failed to delete file');
    }
  },

  flagLabel(flag) {
    const labels = {
      missing_title: 'Missing Title',
      missing_artist: 'Missing Artist',
      missing_album: 'Missing Album',
      missing_track_number: 'No Track #',
      missing_year: 'No Year',
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

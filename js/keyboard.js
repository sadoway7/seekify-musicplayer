// keyboard.js — global keyboard shortcuts (playback + navigation).
// Loaded before app.js; Keyboard.init() attaches the listener once UI is ready.
const Keyboard = {
  init() {
    document.addEventListener('keydown', (e) => this._onKey(e));
  },

  _isTyping(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  },

  _isInteractive(t) {
    return !!(t && t.closest && t.closest('input, textarea, select, button, a[href], summary, [role="button"], [contenteditable="true"]'));
  },

  _onKey(e) {
    const typing = this._isTyping(e.target);

    if (e.key === 'Escape') {
      // In a field, Esc just blurs; otherwise close the topmost overlay.
      if (typing) { e.target.blur(); return; }
      this._closeTopmost();
      return;
    }
    if (typing) return;
    if (this._isInteractive(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;  // don't shadow browser/OS shortcuts

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (Player.getCurrentTrack()) Player.togglePlay();
        break;
      case 'j': Player.next(); break;
      case 'k': Player.prev(); break;
      case 'm': this._toggleMute(); break;
      case 'f': this._toggleFavorite(); break;
      case '/': e.preventDefault(); this._focusSearch(); break;
      case 'ArrowLeft':  e.preventDefault(); this._seekBy(e.shiftKey ? -30 : -5); break;
      case 'ArrowRight': e.preventDefault(); this._seekBy(e.shiftKey ? 30 : 5); break;
      case 'ArrowUp':    e.preventDefault(); this._bumpVolume(0.1); break;
      case 'ArrowDown':  e.preventDefault(); this._bumpVolume(-0.1); break;
    }
  },

  _seekBy(deltaSec) {
    const a = Player.audio;
    if (!a || !a.duration || !isFinite(a.duration)) return;
    const t = Math.min(Math.max(a.currentTime + deltaSec, 0), a.duration);
    Player.seek(t / a.duration);  // seek(fraction) also syncs iOS position state
  },

  _bumpVolume(delta) {
    Player.setVolume(Player.volume + delta);
  },

  _toggleMute() {
    Player.toggleMute();
  },

  _toggleFavorite() {
    if (!Player.getCurrentTrack()) return;
    const btn = document.getElementById('np-like-btn');
    if (btn) btn.click();
  },

  _focusSearch() {
    const inputs = Array.from(document.querySelectorAll('.search-input'));
    const visible = inputs.find(i => i.offsetParent !== null) || inputs[0];
    if (visible) { visible.focus(); visible.select(); }
  },

  _closeTopmost() {
    const openDialog = document.querySelector('dialog[open]');
    if (openDialog) { openDialog.close(); return; }
    if (typeof ReviewUI !== 'undefined') {
      if (ReviewUI.dropdown && ReviewUI.dropdown.classList.contains('visible')) { ReviewUI.hideDropdown(); return; }
      if (ReviewUI.overlay && ReviewUI.overlay.classList.contains('visible')) { ReviewUI.overlay.classList.remove('visible'); return; }
    }
    const cand = document.querySelector('.candidate-modal-overlay.show');
    if (cand) { UI._fadeOutRemove(cand, 200); return; }
    const pm = UI.els && UI.els.playlistModal;
    if (pm && !pm.classList.contains('hidden')) { pm.classList.add('hidden'); return; }
    const cm = UI.els && UI.els.contextMenu;
    if (cm && !cm.classList.contains('hidden')) { UI.hideContextMenu(); return; }
    const q = UI.els && UI.els.queuePanel;
    if (q && !q.classList.contains('hidden')) { UI.hideQueue(); return; }
    const np = UI.els && UI.els.nowPlaying;
    if (np && !np.classList.contains('hidden')) { UI.hideNowPlaying(); return; }
  }
};

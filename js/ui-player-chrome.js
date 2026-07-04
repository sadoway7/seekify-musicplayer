// ============================================
// ui-player-chrome.js — extracted from ui.js
// ============================================
Object.assign(UI, {

  updateMiniPlayer() {
    const track = Player.getCurrentTrack();
    if (!track) {
      if (!this.els.miniPlayer.classList.contains('hidden')) {
        this.els.miniPlayer.style.animation = 'miniPlayerSlideDown 0.3s cubic-bezier(0.55, 0.06, 0.68, 0.19) forwards';
        clearTimeout(this._miniAnimTimer);
        this._miniAnimTimer = setTimeout(() => {
          this.els.miniPlayer.classList.add('hidden');
          this.els.miniPlayer.style.animation = '';
        }, 300);
      }
      this.els.miniPlayer.style.background = '';
      document.body.classList.remove('mini-player-visible');
      this._applyThemeColor(14, 14, 14);
      return;
    }

    const wasHidden = this.els.miniPlayer.classList.contains('hidden');
    clearTimeout(this._miniAnimTimer);
    this.els.miniPlayer.classList.remove('hidden');
    if (wasHidden) {
      this.els.miniPlayer.style.animation = 'miniPlayerSlideUp 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
      this._miniAnimTimer = setTimeout(() => {
        this.els.miniPlayer.style.animation = '';
      }, 300);
    }
    document.body.classList.add('mini-player-visible');

    this.els.miniArt.style.backgroundImage = 'url(' + Api.coverUrl(track.albumID) + ')';
    this.els.miniTitle.textContent = track.title;
    this.els.miniArtist.textContent = track.artist;

    const playingChanged = this._miniWasPlaying !== undefined && this._miniWasPlaying !== Player.playing;
    this._miniWasPlaying = Player.playing;
    this.els.miniPlayBtn.innerHTML = Player.playing ? Icons.pause() : Icons.play();
    if (playingChanged) this._popIcon(this.els.miniPlayBtn);

    const progress = Player.getProgress();
    this.els.miniProgress.style.setProperty('--progress', (progress.fraction * 100) + '%');
    this._applyMiniPlayerColor();
  },

  updateNowPlaying() {
    const track = Player.getCurrentTrack();
    if (!track) return;

    const newSrc = Api.coverUrl(track.albumID);
    const artChanged = !this._lastArtTrackId || this._lastArtTrackId !== track.id || this._lastArtAlbumId !== track.albumID || this._lastArtSrc !== newSrc;
    if (artChanged) {
      this._lastArtTrackId = track.id;
      this._lastArtAlbumId = track.albumID;
      this._lastArtSrc = newSrc;
      const art = this.els.npArt;
      const bg = this.els.npArtBg;
      if (!this.els.nowPlaying.classList.contains('hidden') && art.src && !art.src.endsWith('/') && art.src !== newSrc) {
        const preload = new Image();
        preload.src = newSrc;
        bg.src = art.src;
        bg.style.opacity = '1';
        art.style.opacity = '0';
        const doSwap = () => {
          art.src = newSrc;
          art.style.opacity = '0';
          bg.style.zIndex = '2';
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              art.style.opacity = '1';
              bg.style.opacity = '0';
              setTimeout(() => { bg.style.zIndex = '0'; }, 1000);
            });
          });
        };
        if (preload.complete) {
          setTimeout(doSwap, 400);
        } else {
          preload.onload = () => setTimeout(doSwap, 400);
          preload.onerror = () => setTimeout(doSwap, 400);
        }
      } else {
        art.src = newSrc;
      }
    }
    this.els.npTitle.textContent = track.title;
    this.els.npArtist.textContent = track.artist;

    const isFav = Store.isFavorite(track.id);
    const favChanged = this._npWasFav !== undefined && this._npWasFav !== isFav;
    this._npWasFav = isFav;
    this.els.npLikeBtn.innerHTML = isFav ? Icons.heartFilled() : Icons.heart();
    this.els.npLikeBtn.classList.toggle('active', isFav);
    if (favChanged) this._popIcon(this.els.npLikeBtn);

    const canDownload = Store.downloadsEnabled;
    if (this.els.npDownloadBtn) this.els.npDownloadBtn.style.display = canDownload ? '' : 'none';

    const playingChanged = this._npWasPlaying !== undefined && this._npWasPlaying !== Player.playing;
    this._npWasPlaying = Player.playing;
    this.els.npPlay.innerHTML = Player.playing ? Icons.pause() : Icons.play();
    if (playingChanged) this._popIcon(this.els.npPlay);
    this.els.npShuffle.classList.toggle('active', Player.shuffle);
    this.els.npRepeat.classList.toggle('active', Player.repeat !== 'off');
    this.els.npRepeat.innerHTML = Player.repeat === 'one' ? Icons.repeatOne() : Icons.repeat();

    // Grey out prev/next when no track available in that direction
    const hasNext = Player.repeat !== 'off' || Player.currentIndex < Player.queue.length - 1;
    const hasPrev = Player.currentIndex > 0;
    this.els.npNext.style.opacity = hasNext ? '' : '0.3';
    this.els.npNext.style.pointerEvents = hasNext ? '' : 'none';
    // Prev always active — restarts current song if at start

    this.els.nowPlaying.classList.toggle('playing', Player.playing);

    if (this.els.npHeaderText) {
      const sourceName = Player.getSourceName();
      this.els.npHeaderText.textContent = sourceName || '';
    }

    this._applyNowPlayingBg();
    this._checkTitleOverflow();

    if (artChanged) {
      this._currentWaveformTrackId = track.id;
      this._loadWaveform(track);
    }

    if (typeof ReviewUI !== 'undefined') {
      ReviewUI.updateForTrack(track);
    }
  },

  _checkTitleOverflow() {
    const el = this.els.npTitle;
    if (!el) return;
    el.classList.remove('scrolling');
    el.style.removeProperty('--marquee-dur');
    el.style.removeProperty('--marquee-dist');
    if (el.scrollWidth > el.clientWidth + 4) {
      const dur = Math.max(6, el.scrollWidth / 60);
      const dist = el.scrollWidth - el.clientWidth;
      el.style.setProperty('--marquee-dur', dur + 's');
      el.style.setProperty('--marquee-dist', '-' + dist + 'px');
      el.classList.add('scrolling');
    }
  },

  updateSeekBar() {
    const progress = Player.getProgress();
    if (this.seeking) return;
    const fraction = progress.fraction;
    this._waveformProgress = fraction;
    if (!this._waveformRafPending) {
      this._waveformRafPending = true;
      requestAnimationFrame(() => {
        this._waveformRafPending = false;
        this._paintWaveform(this._waveformProgress);
      });
    }
    this.els.npTimeCurrent.textContent = this._formatTime(progress.current);
    this.els.npTimeTotal.textContent = this._formatTime(progress.duration);
    const pct = (fraction * 100) + '%';
    this.els.miniProgress.style.setProperty('--progress', pct);
  },

  showNowPlaying() {
    this.updateNowPlaying();
    const track = Player.getCurrentTrack();
    this._loadWaveform(track);
    this.updateSeekBar();
    this._renderQueue();
    this.els.nowPlaying.style.animation = '';
    this.els.nowPlaying.classList.remove('hidden');
    this.els.miniPlayer.classList.add('hidden');
    this._applyNowPlayingBg();
    document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
    if (window.innerWidth >= 768) {
      this.els.queuePanel.classList.remove('hidden');
    }
  },

  hideNowPlaying() {
    const np = this.els.nowPlaying;
    np.style.animation = 'nowPlayingSlideDown 0.35s cubic-bezier(0.55, 0.06, 0.68, 0.19) forwards';
    np.addEventListener('animationend', () => {
      np.classList.add('hidden');
      np.style.animation = '';
      np.style.background = '';
    this._lastColorAlbumId = null;
    this._albumColor = null;
      document.documentElement.style.setProperty('--waveform-played', '#D4F040');
      document.documentElement.style.setProperty('--waveform-hover', 'rgba(212, 240, 64, 0.8)');
    }, { once: true });
    if (Player.getCurrentTrack()) {
      this.els.miniPlayer.classList.remove('hidden');
    }
    // Hide queue
    this.els.queuePanel.classList.add('hidden');
    // Restore active tab highlight
    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === Store.currentTab);
    });
  },

  showQueue() {
    this._renderQueue();
    this.els.queuePanel.classList.remove('hidden');
  },

  hideQueue() {
    const panel = this.els.queuePanel;
    panel.style.animation = 'panelSlideDownFade 0.25s cubic-bezier(0.4, 0, 1, 1) forwards';
    setTimeout(() => {
      panel.classList.add('hidden');
      panel.style.animation = '';
    }, 250);
  },

  updateQueueIfVisible() {
    this._renderQueue();
  },

  _renderQueue() {
    if (Player.queue.length === 0) {
      this.els.queueList.innerHTML = '<div class="empty-state"><div class="empty-state-title">Queue is empty</div><div class="empty-state-text">Play something to see it here</div></div>';
      return;
    }

    const sourceName = Player.getSourceName();
    const headerTitle = this.els.queuePanel.querySelector('.queue-header h2');
    if (headerTitle) headerTitle.textContent = sourceName || 'Playlist';

    this.els.queueList.innerHTML = Player.queue.map((track, i) => {
      const isCurrent = i === Player.currentIndex;
      const section = i < Player.currentIndex ? 'history' : 'upnext';
      return '<div class="queue-item queue-item-' + section + (isCurrent ? ' active' : '') + '" data-queue-index="' + i + '">'
        + (section !== 'history' ? '<div class="queue-item-drag" aria-label="Drag to reorder">' + Icons.grip() + '</div>' : '')
        + '<div class="queue-item-art"><img src="' + Api.coverUrl(track.albumID) + '" alt=""></div>'
        + '<div class="queue-item-info">'
        + '<div class="queue-item-title">' + this._esc(track.title) + '</div>'
        + '<div class="queue-item-artist">' + this._esc(track.artist) + '</div>'
        + '</div>'
        + '<button class="queue-item-more" aria-label="More">' + Icons.more() + '</button>'
        + '</div>';
    }).join('');

    const historyItems = this.els.queueList.querySelectorAll('.queue-item-history');
    if (historyItems.length > 0) {
      const wrapper = document.createElement('div');
      wrapper.className = 'queue-history';
      const header = document.createElement('div');
      header.className = 'queue-history-header';
      header.innerHTML = '<span class="queue-history-label">' + Icons.clock() + ' History</span><span class="queue-history-badge">' + historyItems.length + '</span>' + Icons.chevronDown();
      wrapper.appendChild(header);
      const body = document.createElement('div');
      body.className = 'queue-history-body';
      historyItems.forEach(el => body.appendChild(el));
      wrapper.appendChild(body);
      this.els.queueList.insertBefore(wrapper, this.els.queueList.firstChild);

      header.addEventListener('click', () => {
        wrapper.classList.toggle('open');
      });
    }
  },

  showPlaylistModal(trackId) {
    this.playlistModalTrackId = trackId || null;
    if (trackId && Store.playlists.length > 0) {
      this.els.playlistModalList.innerHTML = Store.playlists.map(p =>
        '<div class="modal-list-item" data-playlist-id="' + p.id + '">'
        + Icons.queue()
        + '<span>' + this._esc(p.name) + '</span>'
        + '<span style="color:var(--text-muted);margin-left:auto;font-size:12px">' + p.trackIds.length + ' tracks</span></div>'
      ).join('');
    } else {
      this.els.playlistModalList.innerHTML = '';
    }
    this.els.createPlaylistBtn.style.display = '';
    const existingForm = this.els.playlistModal.querySelector('.modal-create-form');
    if (existingForm) existingForm.remove();
    this.els.playlistModal.classList.remove('hidden');
  },

  hidePlaylistModal() {
    this._closeSheetModal(this.els.playlistModal);
    this.playlistModalTrackId = null;
  },

  _closeSheetModal(modalEl) {
    if (!modalEl || modalEl.classList.contains('hidden')) return;
    const sheet = modalEl.querySelector('.modal-sheet');
    if (sheet) sheet.style.animation = 'sheetSlideOutDown 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
    modalEl.style.animation = 'modalFadeOut 0.25s ease forwards';
    setTimeout(() => {
      modalEl.classList.add('hidden');
      modalEl.style.animation = '';
      if (sheet) sheet.style.animation = '';
    }, 250);
  },

  _popIcon(el) {
    if (!el) return;
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = 'popScale 0.3s ease';
    setTimeout(() => { el.style.animation = ''; }, 310);
  },

  _fadeIn(el) {
    if (!el) return;
    if (this._useViewTransitions) return;
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = 'pageFadeIn 0.22s var(--ease-out) forwards';
  },

  _fadeOutRemove(el, ms) {
    if (!el) return;
    el.style.animation = 'modalFadeOut ' + (ms || 200) + 'ms ease forwards';
    setTimeout(() => el.remove(), ms || 200);
  },

  showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    clearTimeout(this._toastTimer);
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    this._toastTimer = setTimeout(() => {
      toast.classList.add('removing');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  },

  showConfirm(message, onConfirm) {
    const existing = document.querySelector('.confirm-overlay');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'confirm-overlay';
    el.innerHTML = '<div class="confirm-box">'
      + '<div class="confirm-title">' + this._esc(message) + '</div>'
      + '<div class="confirm-actions">'
      + '<button class="confirm-cancel">Cancel</button>'
      + '<button class="confirm-ok">OK</button>'
      + '</div></div>';
    document.body.appendChild(el);
    el.querySelector('.confirm-cancel').addEventListener('click', () => this._fadeOutRemove(el, 200));
    el.querySelector('.confirm-ok').addEventListener('click', () => {
      this._fadeOutRemove(el, 200);
      if (onConfirm) setTimeout(() => onConfirm(), 200);
    });
    el.addEventListener('click', (e) => { if (e.target === el) this._fadeOutRemove(el, 200); });
  },

  updateTrackHighlights() {
    const current = Player.getCurrentTrack();
    if (!current) return;
    if (this._lastHighlightedId === current.id) return;
    if (this._lastHighlightedId) {
      document.querySelectorAll('.track-row[data-track-id="' + this._lastHighlightedId + '"]').forEach(row => {
        const titleEl = row.querySelector('.track-title');
        const eqEl = row.querySelector('.eq');
        const durationEl = row.querySelector('.track-duration');
        if (titleEl) titleEl.classList.remove('on');
        if (eqEl) {
          eqEl.remove();
          if (!durationEl) {
            const dur = document.createElement('div');
            dur.className = 'track-duration';
            const track = Store.getTrack(row.dataset.trackId);
            dur.textContent = this._formatTime(track ? track.duration : 0);
            row.appendChild(dur);
          }
        }
      });
    }
    this._lastHighlightedId = current.id;
    document.querySelectorAll('.track-row[data-track-id="' + current.id + '"]').forEach(row => {
      const titleEl = row.querySelector('.track-title');
      const eqEl = row.querySelector('.eq');
      const durationEl = row.querySelector('.track-duration');
      if (titleEl) titleEl.classList.add('on');
      if (!eqEl && durationEl) {
        durationEl.remove();
        const eq = document.createElement('div');
        eq.className = 'eq';
        eq.innerHTML = '<div class="eqb" style="height:5px"></div><div class="eqb" style="height:11px"></div><div class="eqb" style="height:7px"></div>';
        row.appendChild(eq);
      }
    });
    document.querySelectorAll('.queue-item').forEach(item => {
      const idx = parseInt(item.dataset.queueIndex);
      item.classList.toggle('active', idx === Player.currentIndex);
    });
  },

  _applyMiniPlayerColor() {
    if (!this.els.miniPlayer || !this._albumColor) return;
    const { h, s, l } = this._albumColor;
    const vibS = Math.min(100, s + 35);
    const vibL = Math.min(65, Math.max(45, l + 10));
    const playedColor = 'hsl(' + h + ',' + vibS + '%,' + vibL + '%)';
    this.els.miniProgress.style.setProperty('--mini-progress-color', playedColor);
    this.els.miniPlayer.style.background = 'linear-gradient(135deg, hsl(' + h + ',' + Math.round(vibS * 0.4) + '%,' + Math.max(12, vibL * 0.18) + '%), hsl(' + h + ',' + Math.round(vibS * 0.2) + '%,' + Math.max(8, vibL * 0.1) + '%))';
    this.els.miniPlayer.style.setProperty('--mini-art-glow', playedColor);
  },

  _applyThemeColor(r, g, b) {
    const darkR = Math.round(r * 0.15);
    const darkG = Math.round(g * 0.15);
    const darkB = Math.round(b * 0.15);
    document.querySelector('meta[name="theme-color"]').content = 'rgb(' + darkR + ',' + darkG + ',' + darkB + ')';
  },

  _applyNowPlayingBg() {
    const track = Player.getCurrentTrack();
    const glow = document.getElementById('np-bg-glow');
    if (!track || !glow) {
      if (glow) glow.classList.remove('active');
      return;
    }
    if (track.albumID === this._lastColorAlbumId) return;
    this._lastColorAlbumId = track.albumID;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const ctx = this._colorCtx;
      const size = 10;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;

      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i + 1];
        bSum += data[i + 2];
        count++;
      }
      const r = Math.round(rSum / count);
      const g = Math.round(gSum / count);
      const b = Math.round(bSum / count);

      glow.style.backgroundColor = 'rgba(' + r + ',' + g + ',' + b + ',0.45)';
      glow.classList.add('active');

      const [h, s, l] = this.rgbToHsl(r, g, b);
      const vibS = Math.min(100, s + 35);
      const vibL = Math.min(65, Math.max(45, l + 10));
      document.documentElement.style.setProperty('--waveform-played', 'hsl(' + h + ',' + vibS + '%,' + vibL + '%)');
      document.documentElement.style.setProperty('--waveform-hover', 'hsl(' + h + ',' + vibS + '%,' + Math.min(80, vibL + 15) + '%)');
      document.documentElement.style.setProperty('--waveform-muted', 'hsl(' + h + ',' + Math.round(vibS * 0.35) + '%,' + Math.min(85, vibL + 30) + '%)');

      this._albumColor = { r, g, b, h, s, l };
      this._applyMiniPlayerColor();
      this._applyThemeColor(r, g, b);
    };
    img.onerror = () => {
      glow.classList.remove('active');
      this._albumColor = null;
      this._applyThemeColor(14, 14, 14);
    };
    img.src = Api.coverUrl(track.albumID);
  },

  _updateVolumeBar() {
    const pct = (Player.volume * 100) + '%';
    const icon = Player.volume === 0 ? Icons.volumeMute() : Icons.volume();
    if (this.els.volumeFill) this.els.volumeFill.style.width = pct;
    if (this.els.volumeBtn) this.els.volumeBtn.innerHTML = icon;
    if (this.els.queueVolumeFill) this.els.queueVolumeFill.style.width = pct;
    if (this.els.queueVolumeBtn) this.els.queueVolumeBtn.innerHTML = icon;
    if (this.els.miniVolumeFill) this.els.miniVolumeFill.style.width = pct;
    if (this.els.miniVolumeBtn) this.els.miniVolumeBtn.innerHTML = icon;
  },

});

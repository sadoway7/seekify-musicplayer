const Player = {
  audio: null,
  queue: [],
  _originalQueue: [],
  currentIndex: -1,
  shuffle: false,
  repeat: 'off',
  playing: false,
  volume: 1,
  source: null,
  onStateChange: null,
  onTimeUpdate: null,
  onTrackChange: null,
  onQueueChange: null,
  _consecutiveErrors: 0,
  _errorHandledForCurrent: false,
  _loadTimeout: null,

  init() {
    this.audio = new Audio();
    this.audio.volume = this.volume;
    this.audio.addEventListener('timeupdate', () => {
      if (this.onTimeUpdate) this.onTimeUpdate();
    });
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('loadedmetadata', () => {
      if (this.onTimeUpdate) this.onTimeUpdate();
      this._syncPositionState();
      // Report duration to server if track doesn't have one yet
      const track = this.getCurrentTrack();
      if (track && (!track.duration || track.duration === 0) && this.audio.duration && isFinite(this.audio.duration)) {
        const dur = Math.round(this.audio.duration);
        track.duration = dur;
        Api.reportDuration(track.id, dur);
      }
    });
    this.audio.addEventListener('play', () => {
      this.playing = true;
      this._consecutiveErrors = 0;
      this._clearLoadTimeout();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (this.onStateChange) this.onStateChange();
    });
    this.audio.addEventListener('pause', () => {
      this.playing = false;
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      if (this.onStateChange) this.onStateChange();
    });
    this.audio.addEventListener('error', () => this._onMediaError());

    // iOS only renders prev/next-track buttons (not ±10s skip) when Media Session
    // handlers are (re)registered at playback start; init-time registration does
    // not reliably reach the lock-screen UI. seekforward/seekbackward are never
    // registered: iOS forces a choice between seek-skip and track-skip, and we
    // want track-skip. seekto is kept so the lock-screen scrubber still works.
    this.audio.addEventListener('playing', () => {
      if (!('mediaSession' in navigator)) return;
      navigator.mediaSession.setActionHandler('play', () => { this.audio.play().catch(() => {}); });
      navigator.mediaSession.setActionHandler('pause', () => { this.audio.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prev());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null && this.audio.duration && isFinite(this.audio.duration)) {
          this.audio.currentTime = Math.min(Math.max(details.seekTime, 0), this.audio.duration);
          this._syncPositionState();
        }
      });
    });
  },

  // ponytail: iOS needs finite position state to render prev/next-track buttons
  // instead of ±15s seek buttons. Called on load/play/seek, not timeupdate (the
  // OS advances the scrubber itself using playbackRate).
  _syncPositionState() {
    if (!('mediaSession' in navigator)) return;
    const d = this.audio.duration;
    if (!d || !isFinite(d) || d <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(this.audio.currentTime || 0, d)
      });
    } catch (e) { /* setPositionState throws on bad values; ignore */ }
  },

  _updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || '',
      artist: track.artist || '',
      album: track.album || '',
      artwork: track.albumID ? [{ src: Api.coverUrl(track.albumID), sizes: '512x512', type: 'image/jpeg' }] : []
    });
    // Reset position state for the new track (duration from metadata if known).
    this._syncPositionState();
  },

  play(track, trackList, source) {
    if (this.getCurrentTrack() && this.getCurrentTrack().id === track.id) {
      if (!this.playing) {
        this.audio.play().catch(() => {});
      }
      return;
    }
    if (trackList) {
      this.queue = trackList.slice();
      this.currentIndex = this.queue.findIndex(t => t.id === track.id);
      if (this.currentIndex === -1) this.currentIndex = 0;
      this._originalQueue = this.shuffle ? this.queue.slice() : [];
    } else {
      const existingIndex = this.queue.findIndex(t => t.id === track.id);
      if (existingIndex !== -1) {
        this.currentIndex = existingIndex;
      } else {
        this.queue = [track];
        this.currentIndex = 0;
        this._originalQueue = this.shuffle ? this.queue.slice() : [];
      }
    }
    this.source = source || null;
    this._loadAndPlay(track);
  },

  playInQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const track = this.queue[this.currentIndex];
    this._loadAndPlay(track);
  },

  _loadAndPlay(track) {
    this._clearLoadTimeout();
    this._errorHandledForCurrent = false;
    this.audio.src = Api.streamUrl(track.id);
    this.audio.play().then(() => {
      this.playing = true;
      if (this.onStateChange) this.onStateChange();
    }).catch((e) => { if (e && e.name === 'AbortError') return; this._onMediaError(); });
    this._loadTimeout = setTimeout(() => this._onMediaError(), 10000);
    if (this.onTrackChange) this.onTrackChange(track);
    this._updateMediaSession(track);
  },

  _clearLoadTimeout() {
    if (this._loadTimeout) {
      clearTimeout(this._loadTimeout);
      this._loadTimeout = null;
    }
  },

  _onMediaError() {
    if (this._errorHandledForCurrent) return;
    this._errorHandledForCurrent = true;
    this._clearLoadTimeout();
    this.playing = false;

    if (this.queue.length === 0) {
      if (this.onStateChange) this.onStateChange();
      return;
    }

    this._consecutiveErrors++;
    if (typeof UI !== 'undefined' && UI.showToast) {
      UI.showToast('File unavailable — skipping');
    }

    if (this._consecutiveErrors >= this.queue.length) {
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast('All tracks in queue unavailable — playback stopped');
      }
      if (this.onStateChange) this.onStateChange();
      return;
    }

    const atEnd = this.currentIndex >= this.queue.length - 1;
    if (atEnd && this.repeat !== 'all') {
      if (this.onStateChange) this.onStateChange();
      return;
    }
    this.next();
  },

  pause() {
    this.audio.pause();
  },

  togglePlay() {
    // Branch on the audio element's real paused state, not the `playing` flag,
    // which lags behind during the async play() promise. Using audio.paused
    // keeps the toggle decision in sync with ground truth so rapid clicks and
    // transient stalls don't cause missed/duplicated toggles.
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    } else {
      this.audio.pause();
    }
  },

  next() {
    if (this.queue.length === 0) return;
    let nextIndex = this.currentIndex + 1;
    if (nextIndex >= this.queue.length) {
      if (this.repeat === 'all') {
        nextIndex = 0;
      } else {
        return;
      }
    }
    this.currentIndex = nextIndex;
    const track = this.queue[this.currentIndex];
    this._loadAndPlay(track);
  },

  prev() {
    if (this.queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      if (this.repeat === 'all') {
        prevIndex = this.queue.length - 1;
      } else {
        this.audio.currentTime = 0;
        return;
      }
    }
    this.currentIndex = prevIndex;
    const track = this.queue[this.currentIndex];
    this._loadAndPlay(track);
  },

  seek(fraction) {
    if (this.audio.duration && isFinite(this.audio.duration)) {
      this.audio.currentTime = fraction * this.audio.duration;
      this._syncPositionState();
    }
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this.volume;
  },

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    const currentTrack = this.getCurrentTrack();
    if (this.shuffle) {
      // Always snapshot the unshuffled order, even for a single-track queue,
      // so later addToQueue/playNext mutations keep _originalQueue in sync.
      this._originalQueue = this.queue.slice();
      if (this.queue.length > 1) {
        const remaining = this.queue.filter((t, i) => i !== this.currentIndex);
        for (let i = remaining.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        this.queue = [currentTrack, ...remaining];
        this.currentIndex = 0;
      }
    } else {
      // Restore only if we have a valid snapshot; never blank out the queue.
      if (this._originalQueue.length > 0) {
        this.queue = this._originalQueue.slice();
        this.currentIndex = currentTrack ? this.queue.findIndex(t => t.id === currentTrack.id) : -1;
        if (this.currentIndex === -1) this.currentIndex = 0;
      }
      this._originalQueue = [];
    }
    if (this.onStateChange) this.onStateChange();
    if (this.onQueueChange) this.onQueueChange();
  },

  cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    const idx = modes.indexOf(this.repeat);
    this.repeat = modes[(idx + 1) % modes.length];
    if (this.onStateChange) this.onStateChange();
  },

  getCurrentTrack() {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  },

  getProgress() {
    const current = this.audio.currentTime || 0;
    const duration = this.audio.duration || 0;
    const fraction = duration > 0 ? current / duration : 0;
    return { current, duration, fraction };
  },

  addToQueue(track) {
    this.queue.push(track);
    if (this.shuffle && this._originalQueue.length > 0) {
      this._originalQueue.push(track);
    }
    if (this.onQueueChange) this.onQueueChange();
  },

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    const removedId = this.queue[index].id;
    this.queue.splice(index, 1);
    if (this._originalQueue.length > 0) {
      const origIdx = this._originalQueue.findIndex(t => t.id === removedId);
      if (origIdx !== -1) {
        this._originalQueue.splice(origIdx, 1);
      }
    }
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex) {
      if (this.queue.length === 0) {
        this.currentIndex = -1;
        this.audio.pause();
        this.playing = false;
        if (this.onStateChange) this.onStateChange();
      } else {
        this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
        this._loadAndPlay(this.queue[this.currentIndex]);
      }
    }
    if (this.onQueueChange) this.onQueueChange();
  },

  moveInQueue(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.queue.length) return;
    if (toIndex < 0 || toIndex >= this.queue.length) return;
    const track = this.queue.splice(fromIndex, 1)[0];
    this.queue.splice(toIndex, 0, track);
    if (fromIndex === this.currentIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }
    if (this.onQueueChange) this.onQueueChange();
  },

  playNextInQueue(track) {
    const insertAt = this.currentIndex + 1;
    this.queue.splice(insertAt, 0, track);
    if (this.shuffle && this._originalQueue.length > 0) {
      this._originalQueue.push(track);
    }
    if (this.onQueueChange) this.onQueueChange();
  },

  clearQueue() {
    const current = this.getCurrentTrack();
    if (current) {
      this.queue = [current];
      this._originalQueue = [];
      this.currentIndex = 0;
    } else {
      this.queue = [];
      this._originalQueue = [];
      this.currentIndex = -1;
    }
    if (this.onQueueChange) this.onQueueChange();
  },

  isSingleMode() {
    return this.queue.length <= 1;
  },

  getSourceName() {
    if (!this.source) return '';
    return this.source.name || '';
  },

  _onEnded() {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    if (this.currentIndex < this.queue.length - 1 || this.repeat === 'all') {
      this.next();
    } else {
      this.playing = false;
      if (this.onStateChange) this.onStateChange();
    }
  },

  _randomIndex() {
    if (this.queue.length <= 1) return 0;
    let idx;
    do {
      idx = Math.floor(Math.random() * this.queue.length);
    } while (idx === this.currentIndex);
    return idx;
  }
};

const Player = {
  audio: null,
  queue: [],
  _originalQueue: [],
  currentIndex: -1,
  shuffle: false,
  repeat: 'off',
  playing: false,
  volume: 1,
  _lastNonZeroVolume: 1,
  source: null,
  onStateChange: null,
  onTimeUpdate: null,
  onTrackChange: null,
  onQueueChange: null,
  onVolumeChange: null,
  _consecutiveErrors: 0,
  _errorHandledForCurrent: false,
  _loadTimeout: null,
  _unsupportedExts: null,

  // Probe once: which audio formats can this browser stream? iOS/macOS Safari
  // returns "" for FLAC/Opus/Ogg (it must download the whole file before
  // playing), so tracks in those formats request ?fmt=aac and get a transcoded
  // copy instead. Chrome/Firefox/Android stream FLAC natively — untouched.
  _detectUnsupportedExts() {
    const a = this.audio || new Audio();
    if (typeof a.canPlayType !== 'function') return {};
    const probe = (type) => {
      try { return a.canPlayType(type); } catch (e) { return ''; }
    };
    const set = {};
    if (!probe('audio/flac')) set['.flac'] = true;
    if (!probe('audio/ogg; codecs="opus"') && !probe('audio/opus')) set['.opus'] = true;
    if (!probe('audio/ogg; codecs="vorbis"')) set['.ogg'] = true;
    if (!probe('audio/wav') && !probe('audio/wave')) set['.wav'] = true;
    return set;
  },

  _needsTranscode(track) {
    if (!track || !track.filePath || !this._unsupportedExts) return false;
    const dot = track.filePath.lastIndexOf('.');
    if (dot < 0) return false;
    return !!this._unsupportedExts[track.filePath.slice(dot).toLowerCase()];
  },

  prewarmTranscode(track) {
    if (this._needsTranscode(track) && typeof Api !== 'undefined' && Api.prewarmTranscode) {
      Api.prewarmTranscode(track.id);
    }
  },

  init() {
    // Safari otherwise treats a Web Audio-routed media element as short-lived
    // JavaScript audio and suspends it when iOS locks or backgrounds the page.
    // Declaring long-form playback keeps lock-screen audio eligible to run.
    try {
      if (navigator.audioSession && 'type' in navigator.audioSession) {
        navigator.audioSession.type = 'playback';
      }
    } catch (e) { /* Experimental API: unsupported browsers safely ignore it. */ }
    this._restoreVolume();
    this.audio = new Audio();
    this._unsupportedExts = this._detectUnsupportedExts();
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
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
      if (this.onStateChange) this.onStateChange();
    });
    this.audio.addEventListener('pause', () => {
      this.playing = false;
      // A user pause during a slow load means "stop trying" — clear the
      // pending load timeout or it would fire later, log a bogus
      // load-timeout failure, and force-skip to (and auto-play) the next
      // track the user explicitly paused away from.
      this._clearLoadTimeout();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      if (this.onStateChange) this.onStateChange();
    });
    this.audio.addEventListener('error', (e) => {
      const a = this.audio;
      console.warn('[player] audio error event', {
        error: a.error,
        code: a.error && a.error.code,
        message: a.error && a.error.message,
        src: a.src,
        networkState: a.networkState,
        readyState: a.readyState,
      });
      // Report genuinely unplayable files (decode=3 / unsupported=4) so they
      // surface in Needs Review as playback_error. Network errors (code 2) are
      // transient and ignored by the server — EXCEPT when the message shows a
      // demuxer/seek failure ("demuxer seek failed", PIPELINE_ERROR_READ), which
      // means the file's audio frames are corrupt at the seek position (Chrome
      // reports corrupt FLACs as code 2, not 3). Those are mapped to code 3 so
      // the server flags the file. Dedup per track per page load so a stuck
      // queue doesn't spam the endpoint; the backend upsert is idempotent.
      const code = a.error && a.error.code;
      const msg = (a.error && a.error.message) || '';
      const seekCorrupt = code === 2 && /demuxer|seek failed|PIPELINE_ERROR/i.test(msg);
      const cur = this.getCurrentTrack();
      if (cur && (code === 3 || code === 4 || seekCorrupt)) {
        if (!this._reportedPlaybackErrors) this._reportedPlaybackErrors = new Set();
        if (!this._reportedPlaybackErrors.has(cur.id)) {
          this._reportedPlaybackErrors.add(cur.id);
          if (typeof Api !== 'undefined' && Api.reportPlaybackError) Api.reportPlaybackError(cur.id, seekCorrupt ? 3 : code);
        }
      }
      this._onMediaError('audio-error');
    });

    // iOS only renders prev/next-track buttons (not ±10s skip) when Media Session
    // handlers are (re)registered at playback start; init-time registration does
    // not reliably reach the lock-screen UI. seekforward/seekbackward are never
    // registered: iOS forces a choice between seek-skip and track-skip, and we
    // want track-skip. seekto is kept so the lock-screen scrubber still works.
    this.audio.addEventListener('playing', () => {
      // `play` means playback was requested; `playing` means media data is
      // actually flowing. Only now is the current source known to be healthy.
      this._consecutiveErrors = 0;
      this._clearLoadTimeout();
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
    // User-initiated play: a previous auto-advance failure chain (possibly
    // "all tracks unavailable") must not doom this fresh attempt.
    this._consecutiveErrors = 0;
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
    // Manual pick voids any earlier auto-advance failure streak.
    this._consecutiveErrors = 0;
    this.currentIndex = index;
    const track = this.queue[this.currentIndex];
    this._loadAndPlay(track);
  },

  _loadAndPlay(track, forceTranscode) {
    this._clearLoadTimeout();
    this._errorHandledForCurrent = false;
    // forceTranscode marks a slow-network retry: only allow one per load so a
    // genuinely unplayable track still skips instead of looping.
    this._triedTranscodeFallback = forceTranscode === true;
    const wantTranscode = forceTranscode === true || this._needsTranscode(track);
    this.audio.src = Api.streamUrl(track.id, wantTranscode);
    this.audio.play().then(() => {
      this.playing = true;
      if (this.onStateChange) this.onStateChange();
    }).catch((e) => {
      if (e && e.name === 'AbortError') return;
      if (e && e.name === 'NotAllowedError') {
        // Browser autoplay policy is not a broken file. Keep the selected
        // track queued so a user gesture can start it without skipping ahead.
        this._clearLoadTimeout();
        this.playing = false;
        if (this.onStateChange) this.onStateChange();
        if (typeof UI !== 'undefined' && UI.showToast) UI.showToast('Tap play to start listening');
        return;
      }
      console.warn('[player] play() promise rejected', { name: e && e.name, message: e && e.message, src: this.audio.src });
      this._onMediaError('play-rejected');
    });
    // Cold-cache transcodes (?fmt=aac on Safari) legitimately take longer than
    // raw streams — a whole-file AAC encode of a long FLAC can run 10-30s.
    // The timeout only guards "server never delivers"; 30s for transcoded
    // loads, 10s for everything else.
    const timeoutMs = wantTranscode ? 30000 : 10000;
    let timerId;
    this._loadTimeout = setTimeout(() => {
      // Stale-closure guard: pause, an error handler, or a new track load
      // may have cleared/re-armed the timer after this closure was queued.
      if (this._loadTimeout !== timerId) return;
      this._loadTimeout = null;
      console.warn('[player] load timeout', {
        src: this.audio.src,
        networkState: this.audio.networkState,
        readyState: this.audio.readyState,
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
        paused: this.audio.paused,
      });
      this._onMediaError('load-timeout');
    }, timeoutMs);
    timerId = this._loadTimeout;
    if (this.onTrackChange) this.onTrackChange(track);
    this._updateMediaSession(track);

    // Prime the next track's transcode cache so auto-advance is instant on
    // Safari clients (transcode runs in the background while this song plays).
    const nextTrack = this.queue[this.currentIndex + 1];
    if (nextTrack) this.prewarmTranscode(nextTrack);
  },

  _clearLoadTimeout() {
    if (this._loadTimeout) {
      clearTimeout(this._loadTimeout);
      this._loadTimeout = null;
    }
  },

  // Report this failure (once per track load, via _onMediaError's guard) to
  // the server's weekly playback-failure log: reason, media error code, player
  // state, and whether the load was a transcode request. Never throws.
  _reportFailure(reason) {
    if (typeof Api === 'undefined' || !Api.reportPlaybackFailure) return;
    const t = this.getCurrentTrack();
    if (!t) return;
    const a = this.audio;
    const e = a && a.error;
    Api.reportPlaybackFailure(t.id, {
      code: e && e.code ? e.code : 0,
      message: (e && e.message) || '',
      reason: reason,
      networkState: a ? a.networkState : -1,
      readyState: a ? a.readyState : -1,
      transcode: this._needsTranscode(t)
    });
  },

  _onMediaError(reason) {
    if (this._errorHandledForCurrent) return;
    this._errorHandledForCurrent = true;
    this._clearLoadTimeout();
    this.playing = false;
    console.warn('[player] _onMediaError', { reason, trackId: this.getCurrentTrack() && this.getCurrentTrack().id, consecutiveErrors: this._consecutiveErrors + 1, queueLen: this.queue.length });
    this._reportFailure(reason);

    // Slow-network rescue: a load timeout while the network state is still
    // actively loading means the file is fine but too big for the pipe —
    // typical for 30-100MB FLACs on phones. Skipping here cascades (each
    // skip aborts a partial download and starts another huge one). Instead,
    // retry the SAME track once via the compact AAC stream (~10x smaller).
    if (reason === 'load-timeout' &&
        !this._triedTranscodeFallback &&
        this.audio && this.audio.networkState === 2) {
      const t = this.getCurrentTrack();
      if (t && !this._needsTranscode(t)) {
        console.warn('[player] load timeout on slow network — retrying with transcode', { trackId: t.id });
        this._consecutiveErrors = 0;
        this._loadAndPlay(t, true);
        return;
      }
    }

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
    const value = Number(v);
    if (!isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.volume > 0) this._lastNonZeroVolume = this.volume;
    this.audio.volume = this.volume;
    this._persistVolume();
    if (this.onVolumeChange) this.onVolumeChange(this.volume);
  },

  toggleMute() {
    this.setVolume(this.volume > 0 ? 0 : this._lastNonZeroVolume || 1);
  },

  _restoreVolume() {
    try {
      const savedVolume = Number(localStorage.getItem('player_volume'));
      if (isFinite(savedVolume) && savedVolume > 0 && savedVolume <= 1) {
        this._lastNonZeroVolume = savedVolume;
      }
      this.volume = localStorage.getItem('player_muted') === 'true'
        ? 0
        : this._lastNonZeroVolume;
    } catch (e) {
      this.volume = this._lastNonZeroVolume;
    }
  },

  _persistVolume() {
    try {
      localStorage.setItem('player_volume', String(this._lastNonZeroVolume));
      localStorage.setItem('player_muted', String(this.volume === 0));
    } catch (e) { /* Storage can be unavailable in private browsing. */ }
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
        this._clearPlayback();
      } else {
        this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
        this._loadAndPlay(this.queue[this.currentIndex]);
      }
    }
    if (this.onQueueChange) this.onQueueChange();
  },

  _clearPlayback() {
    this._clearLoadTimeout();
    this.currentIndex = -1;
    this.source = null;
    this.playing = false;
    this._consecutiveErrors = 0;
    this._errorHandledForCurrent = false;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    }
    if (this.onTrackChange) this.onTrackChange(null);
    if (this.onTimeUpdate) this.onTimeUpdate();
    if (this.onStateChange) this.onStateChange();
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

  moveToPlayNext(index) {
    if (index < 0 || index >= this.queue.length) return;
    if (index === this.currentIndex || this.currentIndex < 0) return;

    const track = this.queue[index];
    const current = this.getCurrentTrack();
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    this.queue.splice(this.currentIndex + 1, 0, track);

    // Shuffle keeps an unshuffled snapshot for restoring the queue. Mirror
    // this explicit ordering choice there so disabling shuffle neither loses
    // the selected track nor moves it away from the next position.
    if (this.shuffle && this._originalQueue.length > 0 && current) {
      let originalTrackIndex = this._originalQueue.indexOf(track);
      if (originalTrackIndex === -1) {
        originalTrackIndex = this._originalQueue.findIndex(t => t.id === track.id);
      }
      if (originalTrackIndex !== -1) this._originalQueue.splice(originalTrackIndex, 1);

      let originalCurrentIndex = this._originalQueue.indexOf(current);
      if (originalCurrentIndex === -1) {
        originalCurrentIndex = this._originalQueue.findIndex(t => t.id === current.id);
      }
      const originalInsertAt = originalCurrentIndex === -1
        ? this._originalQueue.length
        : originalCurrentIndex + 1;
      this._originalQueue.splice(originalInsertAt, 0, track);
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

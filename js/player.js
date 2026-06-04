const Player = {
  audio: null,
  queue: [],
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

  init() {
    this.audio = new Audio();
    this.audio.volume = this.volume;
    this.audio.addEventListener('timeupdate', () => {
      if (this.onTimeUpdate) this.onTimeUpdate();
    });
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('loadedmetadata', () => {
      if (this.onTimeUpdate) this.onTimeUpdate();
    });
    this.audio.addEventListener('play', () => {
      this.playing = true;
      if (this.onStateChange) this.onStateChange();
    });
    this.audio.addEventListener('pause', () => {
      this.playing = false;
      if (this.onStateChange) this.onStateChange();
    });
  },

  play(track, trackList, source) {
    if (this.getCurrentTrack() && this.getCurrentTrack().id === track.id) {
      if (!this.playing) {
        this.audio.play().catch(() => {});
        this.playing = true;
        if (this.onStateChange) this.onStateChange();
      }
      return;
    }
    if (trackList) {
      this.queue = trackList.slice();
      this.currentIndex = this.queue.findIndex(t => t.id === track.id);
      if (this.currentIndex === -1) this.currentIndex = 0;
    } else {
      const existingIndex = this.queue.findIndex(t => t.id === track.id);
      if (existingIndex !== -1) {
        this.currentIndex = existingIndex;
      } else {
        this.queue = [track];
        this.currentIndex = 0;
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
    this.audio.src = Api.streamUrl(track.id);
    this.audio.play().catch(() => {
      this.playing = false;
      if (this.onStateChange) this.onStateChange();
    });
    this.playing = true;
    if (this.onTrackChange) this.onTrackChange(track);
    if (this.onStateChange) this.onStateChange();
  },

  pause() {
    this.audio.pause();
  },

  togglePlay() {
    if (this.playing) {
      this.playing = false;
      this.audio.pause();
      if (this.onStateChange) this.onStateChange();
    } else {
      this.playing = true;
      this.audio.play().catch(() => {
        this.playing = false;
        if (this.onStateChange) this.onStateChange();
      });
      if (this.onStateChange) this.onStateChange();
    }
  },

  next() {
    if (this.queue.length === 0) return;
    let nextIndex;
    if (this.shuffle) {
      nextIndex = this._randomIndex();
    } else {
      nextIndex = this.currentIndex + 1;
      if (nextIndex >= this.queue.length) {
        if (this.repeat === 'all') {
          nextIndex = 0;
        } else {
          return;
        }
      }
    }
    this.currentIndex = nextIndex;
    const track = this.queue[this.currentIndex];
    this.audio.src = Api.streamUrl(track.id);
    this.audio.play().catch(() => {});
    this.playing = true;
    if (this.onTrackChange) this.onTrackChange(track);
    if (this.onStateChange) this.onStateChange();
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
    this.audio.src = Api.streamUrl(track.id);
    this.audio.play().catch(() => {});
    this.playing = true;
    if (this.onTrackChange) this.onTrackChange(track);
    if (this.onStateChange) this.onStateChange();
  },

  seek(fraction) {
    if (this.audio.duration && isFinite(this.audio.duration)) {
      this.audio.currentTime = fraction * this.audio.duration;
    }
  },

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.audio.volume = this.volume;
  },

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.onStateChange) this.onStateChange();
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
    if (this.onQueueChange) this.onQueueChange();
  },

  clearQueue() {
    const current = this.getCurrentTrack();
    if (current) {
      this.queue = [current];
      this.currentIndex = 0;
    } else {
      this.queue = [];
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

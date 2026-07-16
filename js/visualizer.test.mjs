import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./visualizer.js', import.meta.url), 'utf8')
  .replace('const Visualizer = {', 'globalThis.Visualizer = {');

function loadVisualizer({ captureStream = null } = {}) {
  const connections = [];

  class FakeNode {
    connect(target) { connections.push([this, target]); return target; }
    disconnect() { this.disconnected = true; }
  }

  class FakeAnalyser extends FakeNode {
    constructor() {
      super();
      this.fftSize = 2048;
      this.frequencyBinCount = 512;
    }
    getByteFrequencyData() {}
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.destination = new FakeNode();
      this.mediaElementSources = [];
      this.mediaStreamSources = [];
      contexts.push(this);
    }
    createMediaElementSource(media) {
      this.mediaElementSources.push(media);
      return new FakeNode();
    }
    createMediaStreamSource(stream) {
      this.mediaStreamSources.push(stream);
      return new FakeNode();
    }
    createAnalyser() { return new FakeAnalyser(); }
    createGain() {
      const gain = new FakeNode();
      gain.gain = { value: 1 };
      return gain;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }

  class FakeAudio {
    constructor() {
      this.paused = true;
      this.readyState = 1;
      this.currentTime = 0;
      this.playbackRate = 1;
      this.listeners = new Map();
      mirrors.push(this);
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() { this.paused = true; this.loadCalls = (this.loadCalls || 0) + 1; }
    play() { this.paused = false; this.playCalls = (this.playCalls || 0) + 1; return Promise.resolve(); }
    pause() { this.paused = true; this.pauseCalls = (this.pauseCalls || 0) + 1; }
  }

  const contexts = [];
  const mirrors = [];
  const primary = {
    currentSrc: '/api/stream/track-one',
    src: '/api/stream/track-one',
    currentTime: 42,
    duration: 180,
    playbackRate: 1,
    paused: false
  };
  if (captureStream) primary.captureStream = captureStream;

  const context = vm.createContext({
    Audio: FakeAudio,
    Date,
    Math,
    Uint8Array,
    console,
    isFinite,
    Player: { audio: primary },
    window: { AudioContext: FakeAudioContext },
    document: {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    setTimeout: () => 1
  });
  vm.runInContext(source, context);
  return { Visualizer: context.Visualizer, primary, contexts, mirrors, connections };
}

test('Safari fallback analyzes an isolated mirror and never reroutes Player.audio', async () => {
  const { Visualizer, primary, contexts, mirrors } = loadVisualizer();

  Visualizer._vizVisible = true;
  Visualizer._ensureAudio(true);
  await Promise.resolve();

  assert.equal(Visualizer._audioMode, 'mirror');
  assert.equal(mirrors.length, 1);
  assert.notEqual(mirrors[0], primary);
  assert.deepEqual(contexts[0].mediaElementSources, [mirrors[0]]);
  assert.equal(contexts[0].mediaElementSources.includes(primary), false);
  assert.equal(Visualizer._silentGain.gain.value, 0);
  assert.equal(mirrors[0].src, primary.currentSrc);
  assert.equal(mirrors[0].currentTime, primary.currentTime);
  assert.equal(mirrors[0].playCalls, 1);
  assert.equal(Visualizer._mirrorActivated, true);
});

test('Safari mirror is reused across tracks and suspended when visualization stops', async () => {
  const { Visualizer, primary, contexts, mirrors } = loadVisualizer();
  Visualizer._vizVisible = true;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const mirror = mirrors[0];

  // Browsers may leave currentSrc on the previous resource briefly after the
  // player assigns src for an automatic track change.
  primary.src = '/api/stream/track-two';
  primary.currentTime = 7;
  Visualizer.onTrackChange({ id: 'track-two' });

  assert.equal(mirrors.length, 1);
  assert.equal(Visualizer._mirrorAudio, mirror);
  assert.equal(mirror.src, primary.src);
  assert.equal(mirror.currentTime, 7);

  Visualizer._pauseMirror();
  await Promise.resolve();
  assert.equal(mirror.paused, true);
  assert.equal(contexts[0].state, 'suspended');
});

test('track changes cannot restart the Safari mirror while now-playing is hidden', async () => {
  const { Visualizer, primary, contexts, mirrors } = loadVisualizer();
  Visualizer._vizVisible = true;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const mirror = mirrors[0];

  Visualizer.onHideNowPlaying();
  primary.src = '/api/stream/hidden-track-change';
  primary.currentTime = 3;
  Visualizer.onTrackChange({ id: 'hidden-track-change' });

  assert.equal(Visualizer._vizVisible, false);
  assert.equal(mirror.paused, true);
  assert.equal(contexts[0].state, 'suspended');
  assert.notEqual(mirror.src, primary.src);
});

test('clearing the final track releases and suspends the Safari mirror', async () => {
  const { Visualizer, primary, contexts, mirrors } = loadVisualizer();
  Visualizer._vizVisible = true;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const mirror = mirrors[0];

  primary.paused = true;
  primary.src = '';
  primary.currentSrc = '';
  Visualizer.onTrackChange(null);
  await Promise.resolve();

  assert.equal(mirror.paused, true);
  assert.equal(mirror.src, '');
  assert.equal(Visualizer._mirrorSrc, null);
  assert.equal(contexts[0].state, 'suspended');
});

test('a stale play rejection cannot disable analysis for a newer track', async () => {
  const { Visualizer, primary, mirrors } = loadVisualizer();
  Visualizer._vizVisible = true;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const mirror = mirrors[0];
  const pending = [];
  mirror.play = () => {
    mirror.paused = false;
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };

  primary.src = '/api/stream/track-a';
  Visualizer.onTrackChange({ id: 'track-a' });
  primary.src = '/api/stream/track-b';
  Visualizer.onTrackChange({ id: 'track-b' });
  assert.equal(pending.length, 2);

  pending[1].resolve();
  await Promise.resolve();
  pending[0].reject(new Error('obsolete track failed'));
  await Promise.resolve();

  assert.equal(Visualizer._audioMode, 'mirror');
  assert.equal(Visualizer._audioReady, true);
  assert.equal(Visualizer._mirrorActivated, true);
  assert.equal(mirror.src, primary.src);
});

test('an interrupted Safari AudioContext is resumed while the visualizer is active', async () => {
  const { Visualizer, contexts, mirrors } = loadVisualizer();
  Visualizer._vizVisible = true;
  Visualizer._ensureAudio(true);
  await Promise.resolve();

  contexts[0].state = 'interrupted';
  mirrors[0].pause();
  Visualizer._syncMirror(true);
  await Promise.resolve();

  assert.equal(contexts[0].state, 'running');
  assert.equal(mirrors[0].paused, false);
});

test('captureStream browsers keep the existing capture path', () => {
  const stream = { getAudioTracks: () => [{}] };
  const { Visualizer, contexts, mirrors } = loadVisualizer({ captureStream: () => stream });

  Visualizer._ensureAudio(true);

  assert.equal(Visualizer._audioMode, 'capture');
  assert.equal(mirrors.length, 0);
  assert.deepEqual(contexts[0].mediaStreamSources, [stream]);
  assert.equal(contexts[0].mediaElementSources.length, 0);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./visualizer.js', import.meta.url), 'utf8')
  .replace('const Visualizer = {', 'globalThis.Visualizer = {');

function loadVisualizer({ captureStream = null, analyserError = false, secondaryFails = false } = {}) {
  const connections = [];
  const contexts = [];

  class FakeNode {
    connect(target) { connections.push([this, target]); return target; }
    disconnect() { this.disconnectCalls = (this.disconnectCalls || 0) + 1; }
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
      this.suspendCalls = 0;
      contexts.push(this);
    }
    createMediaElementSource(media) {
      if (secondaryFails) throw new Error('createMediaElementSource unavailable');
      const node = new FakeNode();
      this.mediaElementSources.push({ media, node });
      return node;
    }
    createMediaStreamSource(stream) {
      const node = new FakeNode();
      this.mediaStreamSources.push({ stream, node });
      return node;
    }
    createAnalyser() {
      if (analyserError) throw new Error('analyser setup failed');
      return new FakeAnalyser();
    }
    createGain() {
      const gain = new FakeNode();
      gain.gain = { value: 1 };
      return gain;
    }
    resume() {
      this.resumeCalls = (this.resumeCalls || 0) + 1;
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.suspendCalls++;
      this.state = 'suspended';
      return Promise.resolve();
    }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }

  // Stand-in for a hidden <audio> element created via `new Audio()` (Safari's
  // silent secondary analysis element).
  class FakeAudioEl {
    constructor() {
      this._src = '';
      this.currentSrc = '';
      this.paused = true;
      this.currentTime = 0;
      this.crossOrigin = null;
    }
    get src() { return this._src; }
    set src(v) { this._src = v; this.currentSrc = v; }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }

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
    Date,
    Math,
    Uint8Array,
    console,
    isFinite,
    Audio: FakeAudioEl,
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
  return { Visualizer: context.Visualizer, primary, contexts, connections };
}

test('Safari (no captureStream) analyzes a silent secondary element, never the primary', () => {
  // AirPlay safety contract: the PRIMARY Player.audio element must never be
  // tapped by createMediaElementSource (that reroutes it through Web Audio and
  // kills AirPlay). Safari plays a separate hidden silent <audio> instead.
  const { Visualizer, primary, contexts } = loadVisualizer();

  Visualizer._ensureAudio(true);

  assert.equal(Visualizer._audioMode, 'secondary');
  assert.ok(Visualizer._vizAudio, 'secondary <audio> element created');
  assert.ok(Visualizer._analyser, 'analyser attached');
  const actx = contexts[0];
  assert.equal(actx.mediaElementSources.length, 1);
  assert.equal(actx.mediaElementSources[0].media, Visualizer._vizAudio,
    'MES bound to the secondary element, NOT Player.audio');
  assert.notEqual(actx.mediaElementSources[0].media, primary);
  // Secondary output is silenced (gain 0) so it never doubles the audio.
  assert.equal(Visualizer._vizSilent.gain.value, 0);
});

test('secondary element retargets and mirrors the primary playback state', () => {
  const { Visualizer, primary } = loadVisualizer();
  Visualizer._ensureAudio(true);
  const va = Visualizer._vizAudio;

  // Primary switches track and starts playing.
  primary.currentSrc = '/api/stream/track-two';
  primary.src = primary.currentSrc;
  primary.paused = false;
  Visualizer._syncVizAudio();

  assert.equal(va.currentSrc, '/api/stream/track-two', 'retargeted to new track');
  assert.equal(va.paused, false, 'mirrored play state');
});

test('turning the visualizer off tears down the silent secondary element', () => {
  const { Visualizer } = loadVisualizer();
  Visualizer._ensureAudio(true);
  Visualizer._syncVizAudio();
  assert.ok(Visualizer._vizAudio);

  Visualizer._teardownVizAudio();

  assert.equal(Visualizer._vizAudio, null);
  assert.equal(Visualizer._analyser, null);
});

test('Safari falls back to decorative when the secondary element cannot be set up', () => {
  const { Visualizer } = loadVisualizer({ secondaryFails: true });

  Visualizer._ensureAudio(true);

  assert.equal(Visualizer._audioMode, 'decorative');
  assert.ok(!Visualizer._analyser);
  assert.ok(!Visualizer._vizAudio);
});

test('AirPlay active disables the visualizer and tears down the secondary element', () => {
  const { Visualizer, primary } = loadVisualizer();
  Visualizer.state = 0;
  Visualizer._ensureAudio(true);
  Visualizer._applyVisualState = () => {};  // isolate from DOM
  Visualizer._persist = () => {};
  assert.ok(Visualizer._vizAudio, 'secondary element running before AirPlay');

  primary.webkitCurrentPlaybackTargetIsWireless = true;
  Visualizer._onAirPlayChange();

  assert.equal(Visualizer._airplayDisabled, true);
  assert.equal(Visualizer._wasOnBeforeAirPlay, true);
  assert.equal(Visualizer.state, -1, 'viz turned off during AirPlay');
  assert.equal(Visualizer._vizAudio, null, 'secondary torn down (no wasted fetch)');
});

test('AirPlay disconnect restores the visualizer if it was on before', () => {
  const { Visualizer, primary } = loadVisualizer();
  Visualizer.state = 0;
  Visualizer._ensureAudio(true);
  Visualizer._applyVisualState = () => {};
  Visualizer._persist = () => {};
  primary.webkitCurrentPlaybackTargetIsWireless = true;
  Visualizer._onAirPlayChange();
  assert.equal(Visualizer.state, -1);

  primary.webkitCurrentPlaybackTargetIsWireless = false;
  Visualizer._onAirPlayChange();

  assert.equal(Visualizer._airplayDisabled, false);
  assert.equal(Visualizer.state, 0, 'viz restored to on');
  assert.ok(Visualizer._analyser, 'analysis path rebuilt');
});

test('cycle() is blocked while AirPlay is active', () => {
  const { Visualizer } = loadVisualizer();
  Visualizer._airplayDisabled = true;
  Visualizer.state = -1;
  Visualizer.cycle();  // no UI in harness → guard returns early, no state change
  assert.equal(Visualizer.state, -1, 'did not enable viz during AirPlay');
});

test('captureStream browsers keep native playback outside Web Audio', () => {
  const stream = { getAudioTracks: () => [{}] };
  const { Visualizer, contexts } = loadVisualizer({ captureStream: () => stream });

  Visualizer._ensureAudio(true);

  assert.equal(Visualizer._audioMode, 'capture');
  assert.equal(contexts[0].mediaStreamSources.length, 1);
  assert.equal(contexts[0].mediaStreamSources[0].stream, stream);
  assert.equal(contexts[0].mediaElementSources.length, 0);
  assert.equal(Visualizer._silentGain.gain.value, 0);
});

test('captureStream input is replaced when a song changes', () => {
  const stream = { getAudioTracks: () => [{}] };
  const { Visualizer } = loadVisualizer({ captureStream: () => stream });
  Visualizer._ensureAudio(true);
  const oldSource = Visualizer._audioSource;

  Visualizer.onTrackChange({ id: 'track-two' });

  assert.equal(oldSource.disconnectCalls, 1);
  assert.equal(Visualizer._audioReady, false);
  assert.equal(Visualizer._audioSource, null);
});

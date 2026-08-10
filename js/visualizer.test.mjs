import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./visualizer.js', import.meta.url), 'utf8')
  .replace('const Visualizer = {', 'globalThis.Visualizer = {');

function loadVisualizer({ captureStream = null, analyserError = false } = {}) {
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

test('Safari (no captureStream) runs decorative and never reroutes the media element', () => {
  // Regression guard: createMediaElementSource(Player.audio) permanently
  // reroutes the element through Web Audio and breaks AirPlay/Chromecast for
  // the page lifetime. Safari has no captureStream, so it must fall back to
  // decorative mode (no frequency data) to keep remote playback working.
  const { Visualizer, contexts } = loadVisualizer();

  Visualizer._ensureAudio(true);

  assert.equal(Visualizer._audioMode, 'decorative');
  assert.ok(!Visualizer._analyser);
  assert.equal(contexts.length, 0); // no AudioContext => no createMediaElementSource
});

test('Safari decorative initializes without a user gesture', () => {
  // No AudioContext is created, so no gesture is required. The visualizer can
  // start rendering (album colors + ambient motion) immediately on Safari.
  const { Visualizer, contexts } = loadVisualizer();

  Visualizer._ensureAudio(false);

  assert.equal(Visualizer._audioMode, 'decorative');
  assert.equal(Visualizer._audioReady, true);
  assert.equal(contexts.length, 0);
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

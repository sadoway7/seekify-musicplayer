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

test('Safari fallback analyzes the real Player.audio element', async () => {
  const { Visualizer, primary, contexts, connections } = loadVisualizer();

  Visualizer._ensureAudio(true);
  await Promise.resolve();

  const actx = contexts[0];
  const sourceNode = actx.mediaElementSources[0].node;
  assert.equal(Visualizer._audioMode, 'element');
  assert.equal(actx.mediaElementSources.length, 1);
  assert.equal(actx.mediaElementSources[0].media, primary);
  assert.equal(connections.some(([from, to]) => from === sourceNode && to === Visualizer._analyser), true);
  assert.equal(connections.some(([from, to]) => from === Visualizer._analyser && to === actx.destination), true);
  assert.equal(actx.state, 'running');
});

test('Safari waits for a user gesture before rerouting the player', () => {
  const { Visualizer, contexts } = loadVisualizer();

  Visualizer._ensureAudio(false);

  assert.equal(contexts.length, 0);
  assert.notEqual(Visualizer._audioReady, true);
});

test('Safari source is reused when Player.audio changes songs', async () => {
  const { Visualizer, primary, contexts } = loadVisualizer();
  Visualizer.state = 0;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const actx = contexts[0];
  const sourceNode = Visualizer._audioSource;

  primary.src = '/api/stream/track-two';
  primary.currentSrc = primary.src;
  primary.currentTime = 7;
  Visualizer.onTrackChange({ id: 'track-two' });
  Visualizer._ensureAudio(true);

  assert.equal(contexts.length, 1);
  assert.equal(actx.mediaElementSources.length, 1);
  assert.equal(Visualizer._audioSource, sourceNode);
  assert.equal(sourceNode.disconnectCalls || 0, 0);
});

test('hiding now playing does not suspend the audible Safari graph', async () => {
  const { Visualizer, contexts } = loadVisualizer();
  Visualizer._ensureAudio(true);
  await Promise.resolve();

  Visualizer.onHideNowPlaying();

  assert.equal(contexts[0].state, 'running');
  assert.equal(contexts[0].suspendCalls, 0);
});

test('analyser setup failure preserves Safari audio across track changes', async () => {
  const { Visualizer, contexts, connections } = loadVisualizer({ analyserError: true });
  Visualizer.state = 0;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const actx = contexts[0];
  const sourceNode = Visualizer._audioSource;

  assert.equal(Visualizer._audioMode, 'element-bypass');
  assert.equal(connections.some(([from, to]) => from === sourceNode && to === actx.destination), true);
  assert.equal(actx.state, 'running');

  Visualizer.onTrackChange({ id: 'track-two' });
  assert.equal(Visualizer._audioMode, 'element-bypass');
  assert.equal(Visualizer._audioSource, sourceNode);
});

test('an interrupted Safari AudioContext is resumed without rebuilding it', async () => {
  const { Visualizer, contexts } = loadVisualizer();
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  await Promise.resolve();
  const actx = contexts[0];
  const sourceNode = Visualizer._audioSource;

  actx.state = 'interrupted';
  Visualizer._resumeAudioContext();
  await Promise.resolve();

  assert.equal(actx.state, 'running');
  assert.equal(contexts.length, 1);
  assert.equal(Visualizer._audioSource, sourceNode);
});

test('a foreground resume still pending cannot block the next user gesture', async () => {
  const { Visualizer, contexts } = loadVisualizer();
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  await Promise.resolve();
  const actx = contexts[0];
  let resolveForeground;
  actx.state = 'interrupted';
  actx.resume = () => new Promise((resolve) => { resolveForeground = resolve; });
  Visualizer._resumeAudioContext(false);
  assert.equal(Visualizer._audioResumePending, true);

  actx.resume = () => {
    actx.state = 'running';
    return Promise.resolve();
  };
  Visualizer._resumeAudioContext(true);
  await Promise.resolve();

  assert.equal(actx.state, 'running');
  resolveForeground();
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

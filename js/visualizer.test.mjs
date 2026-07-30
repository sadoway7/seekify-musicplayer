import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./visualizer.js', import.meta.url), 'utf8')
  .replace('const Visualizer = {', 'globalThis.Visualizer = {');

// Shared window so the Player stub's ensureAudioGraph (module scope) and the
// visualizer code (vm context scope) resolve the same AudioContext constructor.
const sharedWindow = {};

function loadVisualizer({ analyserError = false } = {}) {
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
      this.suspendCalls = 0;
      contexts.push(this);
    }
    createMediaElementSource(media) {
      const node = new FakeNode();
      this.mediaElementSources.push({ media, node });
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

  // Player owns the shared Web Audio graph (mirrors js/player.js ensureAudioGraph).
  // The visualizer taps graph.gain post-gain instead of creating its own source.
  const player = {
    audio: primary,
    audioGraph: null,
    ensureAudioGraph() {
      if (this.audioGraph) return this.audioGraph;
      if (!this.audio) return null;
      const Ctx = sharedWindow.AudioContext || sharedWindow.webkitAudioContext;
      if (!Ctx) return null;
      try {
        const actx = new Ctx();
        const src = actx.createMediaElementSource(this.audio);
        const gain = actx.createGain();
        gain.gain.value = 1.0;
        src.connect(gain);
        gain.connect(actx.destination);
        this.audioGraph = { actx, src, gain };
        return this.audioGraph;
      } catch (e) {
        return null;
      }
    }
  };

  const context = vm.createContext({
    Date,
    Math,
    Uint8Array,
    console,
    isFinite,
    Player: player,
    window: sharedWindow,
    document: {},
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: () => 1,
    setTimeout: () => 1
  });
  vm.runInContext(source, context);
  sharedWindow.AudioContext = FakeAudioContext;
  return { Visualizer: context.Visualizer, player, primary, contexts, connections };
}

test('visualizer taps the player graph (MediaElementSource) for analysis', async () => {
  const { Visualizer, player, primary, contexts, connections } = loadVisualizer();

  Visualizer._ensureAudio(true);
  await Promise.resolve();

  const actx = contexts[0];
  const graph = player.audioGraph;
  assert.equal(Visualizer._audioMode, 'element');
  assert.equal(actx.mediaElementSources.length, 1);
  assert.equal(actx.mediaElementSources[0].media, primary);
  assert.equal(Visualizer._audioSource, graph.src);
  assert.equal(Visualizer._actx, actx);
  // Player wires src -> gain -> destination; visualizer taps gain -> analyser.
  assert.equal(connections.some(([from, to]) => from === graph.src && to === graph.gain), true);
  assert.equal(connections.some(([from, to]) => from === graph.gain && to === actx.destination), true);
  assert.equal(connections.some(([from, to]) => from === graph.gain && to === Visualizer._analyser), true);
  assert.equal(actx.state, 'running');
});

test('visualizer waits for a user gesture before tapping the player graph', () => {
  const { Visualizer, contexts } = loadVisualizer();

  Visualizer._ensureAudio(false);

  assert.equal(contexts.length, 0);
  assert.notEqual(Visualizer._audioReady, true);
});

test('the player graph source is reused when Player.audio changes songs', async () => {
  const { Visualizer, player, primary, contexts } = loadVisualizer();
  Visualizer.state = 0;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const actx = contexts[0];
  const sourceNode = Visualizer._audioSource;
  const graph = player.audioGraph;

  primary.src = '/api/stream/track-two';
  primary.currentSrc = primary.src;
  primary.currentTime = 7;
  Visualizer.onTrackChange({ id: 'track-two' });
  Visualizer._ensureAudio(true);

  assert.equal(contexts.length, 1);
  assert.equal(actx.mediaElementSources.length, 1);
  assert.equal(Visualizer._audioSource, sourceNode);
  assert.equal(player.audioGraph, graph);
  assert.equal(sourceNode.disconnectCalls || 0, 0);
});

test('hiding now playing does not suspend the audible player graph', async () => {
  const { Visualizer, contexts } = loadVisualizer();
  Visualizer._ensureAudio(true);
  await Promise.resolve();

  Visualizer.onHideNowPlaying();

  assert.equal(contexts[0].state, 'running');
  assert.equal(contexts[0].suspendCalls, 0);
});

test('analyser setup failure preserves player-graph audio across track changes', async () => {
  const { Visualizer, player, contexts, connections } = loadVisualizer({ analyserError: true });
  Visualizer.state = 0;
  Visualizer._ensureAudio(true);
  await Promise.resolve();
  const actx = contexts[0];
  const sourceNode = Visualizer._audioSource;
  const graph = player.audioGraph;

  assert.equal(Visualizer._audioMode, 'element-bypass');
  assert.equal(connections.some(([from, to]) => from === graph.src && to === graph.gain), true);
  assert.equal(connections.some(([from, to]) => from === graph.gain && to === actx.destination), true);
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
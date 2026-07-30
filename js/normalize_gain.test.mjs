import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./player.js', import.meta.url), 'utf8')
  .replace('const Player = {', 'globalThis.Player = {');

// Shared window so the module-scope Player stub and vm-context code see the
// same AudioContext constructor (mirrors visualizer.test.mjs harness).
const sharedWindow = {};

function loadPlayer({ gainError = false } = {}) {
  const createdGraphs = [];

  class FakeNode {
    connect(target) { return target; }
    disconnect() {}
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.destination = new FakeNode();
      this.mediaElementSources = [];
      this.resumeCalls = 0;
    }
    createMediaElementSource(media) {
      const node = new FakeNode();
      this.mediaElementSources.push({ media, node });
      return node;
    }
    createAnalyser() { return new FakeNode(); }
    createGain() {
      if (gainError) throw new Error('gain unavailable');
      const gain = new FakeNode();
      gain.gain = { value: 1 };
      return gain;
    }
    resume() { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }

  const audio = { volume: 1 };

  const context = vm.createContext({
    Math,
    Number,
    console,
    isFinite,
    navigator: {},
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    window: sharedWindow
  });
  vm.runInContext(source, context);
  sharedWindow.AudioContext = FakeAudioContext;
  return { Player: context.Player, audio, createdGraphs, FakeAudioContext };
}

test('ensureAudioGraph builds src -> gain -> destination once and reuses it', () => {
  const { Player, audio } = loadPlayer();
  Player.audio = audio;

  const g1 = Player.ensureAudioGraph();
  assert.equal(g1 != null, true);
  const g2 = Player.ensureAudioGraph();
  assert.equal(g2, g1, 'graph must be cached, not rebuilt');
  assert.equal(Player.audioGraph, g1);
});

test('ensureAudioGraph returns null when no audio element is set', () => {
  const { Player } = loadPlayer();
  Player.audio = null;
  assert.equal(Player.ensureAudioGraph(), null);
  assert.equal(Player.audioGraph, null);
});

test('ensureAudioGraph returns null when AudioContext is unavailable', () => {
  const { Player, audio } = loadPlayer();
  Player.audio = audio;
  sharedWindow.AudioContext = null;
  assert.equal(Player.ensureAudioGraph(), null);
  assert.equal(Player.audioGraph, null);
});

test('ensureAudioGraph swallows createMediaElementSource failure', () => {
  const { Player, audio, FakeAudioContext } = loadPlayer();
  Player.audio = audio;
  FakeAudioContext.prototype.createMediaElementSource = () => { throw new Error('already bound'); };
  assert.equal(Player.ensureAudioGraph(), null);
  assert.equal(Player.audioGraph, null);
});

test('setGainDb applies 10^(db/20) to the gain node', () => {
  const { Player, audio } = loadPlayer();
  Player.audio = audio;

  Player.setGainDb(-6);
  assert.ok(Math.abs(Player.audioGraph.gain.gain.value - Math.pow(10, -6 / 20)) < 1e-9);
  Player.setGainDb(0);
  assert.equal(Player.audioGraph.gain.gain.value, 1);
  Player.setGainDb(6);
  assert.ok(Math.abs(Player.audioGraph.gain.gain.value - Math.pow(10, 6 / 20)) < 1e-9);
});

test('setGainDb treats null db as unity gain (1.0)', () => {
  const { Player, audio } = loadPlayer();
  Player.audio = audio;
  Player.setGainDb(-10);
  Player.setGainDb(null);
  assert.equal(Player.audioGraph.gain.gain.value, 1);
});

test('setGainDb resumes a suspended AudioContext', async () => {
  const { Player, audio } = loadPlayer();
  Player.audio = audio;
  Player.ensureAudioGraph();
  const actx = Player.audioGraph.actx;
  assert.equal(actx.state, 'suspended');

  Player.setGainDb(-3);
  assert.equal(actx.resumeCalls, 1);
});

test('setGainDb is a no-op when the graph cannot be built', () => {
  const { Player, audio } = loadPlayer({ gainError: true });
  Player.audio = audio;
  // createGain throws -> ensureAudioGraph catches and returns null
  assert.equal(Player.ensureAudioGraph(), null);
  // setGainDb must not throw when the graph is unavailable
  assert.doesNotThrow(() => Player.setGainDb(-6));
});
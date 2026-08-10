import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./visualizer.js', import.meta.url), 'utf8')
  .replace('const Visualizer = {', 'globalThis.Visualizer = {');

function loadVisualizer({ captureStream = null, analyserError = false, api = null } = {}) {
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
    Api: api,
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

test('Safari (no captureStream) uses precomputed mode, never reroutes the media element', () => {
  // AirPlay safety: createMediaElementSource kills AirPlay on iOS, so Safari
  // uses NO live audio tap. The visualizer is driven by a precomputed band
  // timeline instead (no AudioContext at all).
  const { Visualizer, contexts } = loadVisualizer();

  Visualizer._ensureAudio(true);

  assert.equal(Visualizer._audioMode, 'precomputed');
  assert.ok(!Visualizer._analyser);
  assert.equal(contexts.length, 0); // no AudioContext => no createMediaElementSource
});

test('Safari precomputed initializes without a user gesture', () => {
  // No AudioContext is created, so no gesture is required. The visualizer
  // renders ambient until the band timeline loads, then pulses.
  const { Visualizer, contexts } = loadVisualizer();

  Visualizer._ensureAudio(false);

  assert.equal(Visualizer._audioMode, 'precomputed');
  assert.equal(Visualizer._audioReady, true);
  assert.equal(contexts.length, 0);
});

test('_bandsAt reads and interpolates the precomputed timeline', () => {
  const { Visualizer } = loadVisualizer();
  Visualizer._bandTimeline = [[0, 0, 0, 0], [1, 0.5, 0.25, 0], [0, 0, 0, 1]];
  const at0 = Visualizer._bandsAt(0);
  assert.equal(at0[0], 0); assert.equal(at0[3], 0);
  const at1 = Visualizer._bandsAt(1);
  assert.equal(at1[0], 0); assert.equal(at1[3], 1);
  // f=0.25 -> idx 0.5 between buckets 0 and 1
  const mid = Visualizer._bandsAt(0.25);
  assert.equal(mid[0], 0.5);
  assert.equal(mid[1], 0.25);
  assert.equal(mid[2], 0.125);
  assert.equal(mid[3], 0);
});

test('_bandsAt returns silence when no timeline is loaded', () => {
  const { Visualizer } = loadVisualizer();
  const v = Visualizer._bandsAt(0.5);
  assert.equal(v[0], 0); assert.equal(v[1], 0); assert.equal(v[2], 0); assert.equal(v[3], 0);
});

test('_loadBands clears the prior timeline on a new track (pending until loaded)', () => {
  const api = { getBands: () => new Promise(() => {}) };  // never resolves
  const { Visualizer } = loadVisualizer({ api });
  Visualizer._bandTimeline = [[1, 2, 3, 4]];  // pretend prior track's data
  Visualizer._loadBands({ id: 'track-b' });
  assert.equal(Visualizer._bandTrackId, 'track-b');
  assert.equal(Visualizer._bandTimeline, null, 'prior timeline cleared on new track');
});

test('_loadBands stores the timeline once the fetch resolves', async () => {
  const api = { getBands: () => Promise.resolve({ bands: [[0.1, 0.2, 0.3, 0.4], [0.5, 0.5, 0.5, 0.5]], rate: 20 }) };
  const { Visualizer } = loadVisualizer({ api });
  Visualizer._loadBands({ id: 'track-c' });
  await new Promise(r => r());  // flush microtask queue
  await new Promise(r => r());
  assert.equal(Visualizer._bandTrackId, 'track-c');
  assert.ok(Visualizer._bandTimeline && Visualizer._bandTimeline.length === 2, 'timeline stored');
  const at1 = Visualizer._bandsAt(1);
  assert.equal(at1[0], 0.5); assert.equal(at1[1], 0.5); assert.equal(at1[2], 0.5); assert.equal(at1[3], 0.5);
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

test('AirPlay active forces the visualizer off and marks the toggle disabled', () => {
  const { Visualizer, primary } = loadVisualizer();
  Visualizer.state = 0;                  // viz on (decorative)
  Visualizer._applyVisualState = () => {};  // isolate from DOM
  Visualizer._persist = () => {};

  primary.webkitCurrentPlaybackTargetIsWireless = true;
  Visualizer._onAirPlayChange();

  assert.equal(Visualizer._airplayDisabled, true);
  assert.equal(Visualizer._wasOnBeforeAirPlay, true);
  assert.equal(Visualizer.state, -1, 'forced back to album art');
});

test('AirPlay disconnect restores the visualizer if it was on before', () => {
  const { Visualizer, primary } = loadVisualizer();
  Visualizer.state = 0;
  Visualizer._applyVisualState = () => {};
  Visualizer._persist = () => {};
  primary.webkitCurrentPlaybackTargetIsWireless = true;
  Visualizer._onAirPlayChange();
  assert.equal(Visualizer.state, -1);

  primary.webkitCurrentPlaybackTargetIsWireless = false;
  Visualizer._onAirPlayChange();

  assert.equal(Visualizer._airplayDisabled, false);
  assert.equal(Visualizer.state, 0, 'viz restored on disconnect');
});

test('cycle() is blocked while AirPlay is active', () => {
  const { Visualizer } = loadVisualizer();
  Visualizer._airplayDisabled = true;
  Visualizer.state = -1;
  Visualizer.cycle();   // no UI in harness -> guard returns early, no state change
  assert.equal(Visualizer.state, -1, 'did not enable viz during AirPlay');
});

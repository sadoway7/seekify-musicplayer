import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./player.js', import.meta.url), 'utf8')
  .replace('const Player = {', 'globalThis.Player = {');

function loadPlayer(navigator, order = [], canPlay = {}, api = null) {
  const createdAudio = [];
  const timeouts = [];

  class FakeAudio {
    constructor() {
      this.volume = 1;
      this.listeners = new Map();
      this.error = null;
      this.networkState = 0;
      this.readyState = 0;
      order.push('audio');
      createdAudio.push(this);
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    canPlayType(type) { return canPlay[type] || ''; }
    play() { return Promise.resolve(); }
    pause() {}
  }

  const context = vm.createContext({
    Audio: FakeAudio,
    Math,
    Number,
    console,
    isFinite,
    navigator,
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    Api: api || {
      reportPlaybackError: () => {},
      streamUrl: (id, transcode) => '/api/stream/' + id + (transcode ? '?fmt=aac' : '')
    }
  });
  vm.runInContext(source, context);
  return { Player: context.Player, createdAudio, timeouts };
}

test('player declares long-form playback before creating Safari audio', () => {
  const order = [];
  const audioSession = {
    _type: 'auto',
    get type() { return this._type; },
    set type(value) { order.push('session:' + value); this._type = value; }
  };
  const { Player } = loadPlayer({ audioSession }, order);

  Player.init();

  assert.equal(audioSession.type, 'playback');
  assert.deepEqual(order, ['session:playback', 'audio']);
});

test('player initialization remains compatible without AudioSession', () => {
  const { Player, createdAudio } = loadPlayer({});

  assert.doesNotThrow(() => Player.init());
  assert.equal(createdAudio.length, 1);
});

test('a rejected AudioSession assignment cannot prevent playback setup', () => {
  const audioSession = {};
  Object.defineProperty(audioSession, 'type', {
    get: () => 'auto',
    set: () => { throw new Error('blocked'); }
  });
  const { Player, createdAudio } = loadPlayer({ audioSession });

  assert.doesNotThrow(() => Player.init());
  assert.equal(createdAudio.length, 1);
});

test('player requests transcoded AAC when it cannot stream FLAC', () => {
  const { Player } = loadPlayer({});
  Player.init();

  assert.equal(JSON.stringify(Player._unsupportedExts), JSON.stringify({ '.flac': true, '.opus': true, '.ogg': true, '.wav': true }));
  assert.equal(Player._needsTranscode({ id: 'a', filePath: 'Album/01 - Song.flac' }), true);
  assert.equal(Player._needsTranscode({ id: 'b', filePath: 'Album/02 - Song.mp3' }), false);
  assert.equal(Player._needsTranscode({ id: 'c', filePath: 'Album/03 - Song.m4a' }), false);
  assert.equal(Player._needsTranscode({ id: 'd', filePath: 'Album/04 - Song.OPUS' }), true);
});

test('player streams original FLAC when the browser supports it', () => {
  const canPlay = {
    'audio/flac': 'maybe',
    'audio/ogg; codecs="opus"': 'probably',
    'audio/ogg; codecs="vorbis"': 'probably',
    'audio/wav': 'probably'
  };
  const { Player } = loadPlayer({}, [], canPlay);
  Player.init();

  assert.equal(JSON.stringify(Player._unsupportedExts), '{}');
  assert.equal(Player._needsTranscode({ id: 'a', filePath: 'Album/01 - Song.flac' }), false);
  assert.equal(Player._needsTranscode({ id: 'b', filePath: 'Album/02 - Song.opus' }), false);
  assert.equal(Player._needsTranscode({ id: 'c', filePath: 'Album/03 - Song.ogg' }), false);
});

test('transcoded loads arm an extended load timeout', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({});
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01 - Song.flac' });

  assert.ok(createdAudio[0].src.includes('fmt=aac'));
  assert.ok(timeouts.some(t => t.ms === 30000));
});

test('native-format loads keep the 10s timeout', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], {
    'audio/flac': 'maybe',
    'audio/wav': 'probably'
  });
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01 - Song.flac' });

  assert.ok(!createdAudio[0].src.includes('fmt=aac'));
  assert.ok(timeouts.some(t => t.ms === 10000));
});

test('load timeout reports failure context to the server', async () => {
  const failures = [];
  const { Player, timeouts } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    reportPlaybackFailure: (id, info) => failures.push({ id, info })
  });
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01 - Song.flac' });

  const timeout = timeouts.find(t => t.ms === 30000);
  timeout.fn();

  assert.equal(failures.length, 1);
  assert.equal(failures[0].id, 'a');
  assert.equal(failures[0].info.reason, 'load-timeout');
  assert.equal(failures[0].info.transcode, true);
  assert.equal(failures[0].info.code, 0);
});

test('rejected play() reports a play-rejected failure', async () => {
  const failures = [];
  const { Player } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    reportPlaybackFailure: (id, info) => failures.push({ id, info })
  });
  // Replace audio.play with a rejecting promise to simulate a generic failure.
  Player.init();
  Player.audio.play = () => Promise.reject(new Error('boom'));
  Player.play({ id: 'a', filePath: 'Album/01 - Song.mp3' });
  await new Promise(r => setImmediate(r));

  assert.equal(failures.length, 1);
  assert.equal(failures[0].info.reason, 'play-rejected');
  assert.equal(failures[0].info.transcode, false);
});

test('pause during a slow load clears the load timeout (no force-skip)', () => {
  const failures = [];
  const { Player, timeouts, createdAudio } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    reportPlaybackError: () => {},
    reportPlaybackFailure: (id, info) => failures.push({ id, info })
  });
  Player.init();
  const skips = [];
  Player.next = () => skips.push('called');

  // Slow transcode load: 30s timer armed, 'playing' never fires.
  Player.play({ id: 'a', filePath: 'Album/01 - Song.flac' });
  const loadTimer = timeouts.find(t => t.ms === 30000);
  assert.ok(loadTimer, '30s transcode load timeout armed');

  // User hits pause before any data flows, then the stale timer elapses.
  createdAudio[0].listeners.get('pause')();
  loadTimer.fn();

  assert.equal(skips.length, 0, 'paused load must not skip to the next track');
  assert.equal(failures.length, 0, 'paused load must not log a playback failure');
});

test('load timeout on slow network retries same track via transcode instead of skipping', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], {
    'audio/flac': 'maybe'
  });
  Player.init();
  const queue = [
    { id: 'slow', filePath: 'Album/01 - Big.flac' },
    { id: 'next', filePath: 'Album/02 - Song.flac' }
  ];
  Player.play(queue[0], queue, { type: 'album' });
  assert.ok(!createdAudio[0].src.includes('fmt=aac'), 'first load is native');

  // Simulate: still actively downloading when the 10s timeout fires.
  Player.audio.networkState = 2;
  const timeout = timeouts.find(t => t.ms === 10000);
  timeout.fn();

  assert.ok(Player.audio.src.includes('fmt=aac'), 'retried with compact stream');
  assert.equal(Player.currentIndex, 0, 'same track, not skipped');
  assert.equal(Player._consecutiveErrors, 0, 'slow network is not a broken file');
  assert.ok(timeouts.some(t => t.ms === 30000), 'retry arms the transcode timeout');
});

test('second timeout after transcode retry skips the track (no loop)', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], {
    'audio/flac': 'maybe'
  });
  Player.init();
  const queue = [
    { id: 'slow', filePath: 'Album/01 - Big.flac' },
    { id: 'next', filePath: 'Album/02 - Song.flac' }
  ];
  Player.play(queue[0], queue, { type: 'album' });
  Player.audio.networkState = 2;
  timeouts.find(t => t.ms === 10000).fn();   // retry with aac
  timeouts.find(t => t.ms === 30000).fn();   // still fails

  assert.equal(Player.currentIndex, 1, 'advanced to next track');
});

test('user-initiated play resets the consecutive-error streak', () => {
  const { Player } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  Player._consecutiveErrors = 99;
  Player.play({ id: 'fresh', filePath: 'Album/01 - Song.flac' }, [{ id: 'fresh', filePath: 'Album/01 - Song.flac' }]);
  assert.equal(Player._consecutiveErrors, 0);

  Player._consecutiveErrors = 5;
  Player.playInQueue(0);
  assert.equal(Player._consecutiveErrors, 0, 'manual queue pick also resets');
});

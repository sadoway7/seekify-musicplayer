import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./player.js', import.meta.url), 'utf8')
  .replace('const Player = {', 'globalThis.Player = {');

function loadPlayer(navigator, order = [], canPlay = {}, api = null, storage = null) {
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
    localStorage: storage || { getItem: () => null, setItem: () => {} },
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

const apiSource = readFileSync(new URL('./api.js', import.meta.url), 'utf8')
  .replace('const Api = {', 'globalThis.Api = {');

function loadApi(storage = { getItem: () => null, setItem: () => {} }, fetchCalls = []) {
  const context = vm.createContext({
    localStorage: storage,
    fetch: (url, opts) => { fetchCalls.push({ url, opts }); return Promise.resolve({ ok: true }); }
  });
  vm.runInContext(apiSource, context);
  return context.Api;
}

function saverStorage() {
  return { getItem: (k) => (k === 'musicapp:data_saver' ? '1' : null), setItem: () => {} };
}

test('Api.streamUrl: native, unsupported-format, and data-saver combos', () => {
  const off = loadApi();
  assert.equal(off.dataSaver(), false);
  assert.equal(off.streamUrl('x', false), '/api/stream/x');
  assert.equal(off.streamUrl('x', true), '/api/stream/x?fmt=aac');

  const on = loadApi(saverStorage());
  assert.equal(on.dataSaver(), true);
  assert.equal(on.streamUrl('x', false), '/api/stream/x?fmt=aac&b=128');
  assert.equal(on.streamUrl('x', true), '/api/stream/x?fmt=aac&b=128');
});

test('Api.prewarmTranscode passes the 128k hint only when data saver is on', () => {
  const calls = [];
  loadApi(saverStorage(), calls).prewarmTranscode('t1');
  loadApi(undefined, calls).prewarmTranscode('t2');
  assert.deepEqual(calls.map(c => c.url), ['/api/transcode-warm/t1?b=128', '/api/transcode-warm/t2']);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[1].opts.method, 'POST');
});

test('localStorage failures read as data saver off', () => {
  const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
  assert.equal(loadApi(throwing).dataSaver(), false);
});

test('Api.transcodeStatus polls the status endpoint, 128k hint only when saver on, null on failure', async () => {
  const calls = [];
  const api = loadApi(saverStorage(), calls);
  // The harness fake body has no .json() — the pinned contract is: odd
  // bodies never throw, they resolve to null (the player treats null as
  // "keep waiting").
  const res = await api.transcodeStatus('t1');
  assert.equal(res, null);
  assert.deepEqual(calls[0], { url: '/api/transcode-status/t1?b=128', opts: undefined });

  const off = loadApi(undefined, calls);
  await off.transcodeStatus('t2');
  assert.equal(calls[1].url, '/api/transcode-status/t2');
});

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

test('network error pauses instead of skipping, and resumes on reconnect', () => {
  const reported = [];
  const { Player, createdAudio } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    reportPlaybackError: (id, code) => reported.push({ id, code })
  });
  Player.init();
  const queue = [
    { id: 'a', filePath: 'Album/01.mp3' },
    { id: 'b', filePath: 'Album/02.mp3' },
    { id: 'c', filePath: 'Album/03.mp3' }
  ];
  Player.play(queue[0], queue);
  const skips = [];
  Player.next = () => skips.push('called');

  Player.audio.error = { code: 2, message: 'network dropped' };
  createdAudio[0].listeners.get('error')();

  assert.equal(Player._networkPaused, true, 'network failure pauses');
  assert.equal(skips.length, 0, 'must not advance the queue');
  assert.equal(Player.currentIndex, 0);
  assert.equal(reported.length, 0, 'transient network errors are not flagged');

  Player._resumeAfterNetwork();
  assert.equal(Player._networkPaused, false, 'resume clears the pause flag');
  assert.equal(Player._errorHandledForCurrent, false, 'fresh load re-arms error handling');
  assert.equal(createdAudio[0].src, '/api/stream/a', 'current track reloaded');
});

test('offline load timeout pauses instead of skipping', () => {
  const { Player } = loadPlayer({ onLine: false }, [], { 'audio/flac': 'maybe' });
  Player.init();
  const queue = [
    { id: 'a', filePath: 'Album/01.mp3' },
    { id: 'b', filePath: 'Album/02.mp3' }
  ];
  Player.play(queue[0], queue);
  const skips = [];
  Player.next = () => skips.push('called');

  Player._onMediaError('load-timeout');

  assert.equal(Player._networkPaused, true);
  assert.equal(skips.length, 0);
  assert.equal(Player.currentIndex, 0);
});

test('seek-corrupt code 2 still skips to the next track', () => {
  const reported = [];
  const { Player, createdAudio } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id,
    reportPlaybackError: (id, code) => reported.push({ id, code })
  });
  Player.init();
  const queue = [
    { id: 'a', filePath: 'Album/01.mp3' },
    { id: 'b', filePath: 'Album/02.mp3' }
  ];
  Player.play(queue[0], queue);
  Player.audio.error = { code: 2, message: 'demuxer seek failed' };
  createdAudio[0].listeners.get('error')();

  assert.equal(Player.currentIndex, 1, 'corrupt file skips');
  assert.deepEqual(reported, [{ id: 'a', code: 3 }], 'corrupt file is flagged as decode error');
});

test('auto-skip cascade stops after three consecutive failures on a long queue', () => {
  const { Player } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  const queue = Array.from({ length: 10 }, (_, i) => ({ id: 't' + i, filePath: 'Album/' + i + '.mp3' }));
  Player.play(queue[0], queue);

  Player._onMediaError('audio-error');   // skip to t1
  Player._onMediaError('audio-error');   // skip to t2
  Player._onMediaError('audio-error');   // third consecutive — stop
  Player._onMediaError('audio-error');   // guarded — no further advance

  assert.equal(Player._consecutiveErrors, 3);
  assert.equal(Player.currentIndex, 2, 'stops after three bad tracks, not ten');
});

test('stall watchdog retries once, then pauses without advancing the queue', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  const queue = [
    { id: 'a', filePath: 'Album/01.mp3' },
    { id: 'b', filePath: 'Album/02.mp3' }
  ];
  Player.play(queue[0], queue);
  const srcAfterLoad = createdAudio[0].src;

  createdAudio[0].listeners.get('waiting')();
  const stallTimers = () => timeouts.filter(t => t.ms === 30000);
  assert.equal(stallTimers().length, 1, 'stall watchdog armed');
  stallTimers()[0].fn();   // first stall — retry same track

  assert.equal(Player._stallRetried, true);
  assert.equal(Player.currentIndex, 0, 'same track');
  assert.equal(createdAudio[0].src, srcAfterLoad, 'fresh load of the same source');

  createdAudio[0].listeners.get('waiting')();
  stallTimers()[stallTimers().length - 1].fn();   // second stall — pause

  assert.equal(Player._networkPaused, true, 'second stall pauses');
  assert.equal(Player.playing, false);
  assert.equal(Player.currentIndex, 0, 'queue not advanced');
});

test('stall watchdog is cleared once data flows again', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01.mp3' });

  createdAudio[0].listeners.get('waiting')();
  const stall = timeouts.find(t => t.ms === 30000);
  createdAudio[0].listeners.get('playing')();

  assert.equal(Player._stallTimeout, null, 'playing clears the watchdog');
  stall.fn();
  assert.equal(Player._networkPaused, false, 'stale watchdog fire is a no-op');
  assert.equal(Player._stallRetried, false, 'no retry happened');
});

test('late error from a replaced source is ignored', () => {
  const reported = [];
  const { Player, createdAudio } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id,
    reportPlaybackError: (id, code) => reported.push({ id, code })
  });
  Player.init();
  const queue = [
    { id: 'a', filePath: 'Album/01.mp3' },
    { id: 'b', filePath: 'Album/02.mp3' }
  ];
  Player.play(queue[0], queue);
  const skips = [];
  Player.next = () => skips.push('called');

  // Simulate a stale error whose source is no longer the active load.
  Player.audio.error = { code: 3, message: 'boom' };
  const savedSrc = Player.audio.src;
  Player.audio.src = '/api/stream/old';
  createdAudio[0].listeners.get('error')();
  Player.audio.src = savedSrc;

  assert.equal(reported.length, 0, 'stale error is not flagged');
  assert.equal(skips.length, 0, 'stale error does not skip');
  assert.equal(Player._errorHandledForCurrent, false);

  // A genuine error for the active load still reports and skips.
  createdAudio[0].listeners.get('error')();
  assert.equal(reported.length, 1);
  assert.equal(skips.length, 1);
});

test('togglePlay with no source loads the queued track (deep-link path)', () => {
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  Player.queue = [{ id: 'dl', filePath: 'Album/01.mp3' }];
  Player.currentIndex = 0;
  createdAudio[0].paused = true;

  assert.ok(!createdAudio[0].src, 'no source primed by the deep link');
  Player.togglePlay();

  assert.equal(createdAudio[0].src, '/api/stream/dl', 'guarded load path used');
  assert.ok(timeouts.some(t => t.ms === 10000), 'load watchdog armed');
});

test('togglePlay after a network pause reloads the current track', () => {
  const { Player, createdAudio } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  const queue = [
    { id: 'a', filePath: 'Album/01.mp3' },
    { id: 'b', filePath: 'Album/02.mp3' }
  ];
  Player.play(queue[0], queue);
  Player._networkPaused = true;
  createdAudio[0].paused = true;
  const loadTimes = [];
  const origLoad = Player._loadAndPlay.bind(Player);
  Player._loadAndPlay = (t, ft) => { loadTimes.push(t.id); return origLoad(t, ft); };
  createdAudio[0].play = () => Promise.resolve();

  Player.togglePlay();

  assert.deepEqual(loadTimes, ['a'], 'reloads the current track through the guarded path');
  assert.equal(Player._networkPaused, false, 'fresh load clears the flag');
});

test('stale loadedmetadata does not report the wrong track duration', () => {
  const durations = [];
  const { Player, createdAudio } = loadPlayer({}, [], {}, {
    streamUrl: (id, t) => '/api/stream/' + id,
    reportDuration: (id, d) => durations.push({ id, d })
  });
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01.mp3' });

  createdAudio[0].duration = 200;
  const savedSrc = createdAudio[0].src;
  createdAudio[0].src = '/api/stream/stale';
  createdAudio[0].listeners.get('loadedmetadata')();
  assert.equal(durations.length, 0, 'stale metadata ignored');

  createdAudio[0].src = savedSrc;
  createdAudio[0].listeners.get('loadedmetadata')();
  assert.deepEqual(durations, [{ id: 'a', d: 200 }], 'active load reports duration');
});

test('data saver ON streams 128k AAC even for natively-playable formats', () => {
  const saverApi = {
    streamUrl: (id, t) => '/api/stream/' + id + (saverApi.dataSaver() ? '?fmt=aac&b=128' : (t ? '?fmt=aac' : '')),
    dataSaver: () => true,
    prewarmTranscode: () => {}
  };
  const { Player, createdAudio, timeouts } = loadPlayer({}, [], { 'audio/flac': 'maybe' }, saverApi);
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01 - Song.flac' });

  assert.ok(createdAudio[0].src.includes('fmt=aac&b=128'), 'saver forces the 128k stream');
  assert.ok(timeouts.some(t => t.ms === 30000), 'transcode load timeout armed');
});

test('prewarm fires for the next track when data saver is on even if the browser plays FLAC', () => {
  const warmed = [];
  const saverApi = {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    dataSaver: () => true,
    prewarmTranscode: (id) => warmed.push(id)
  };
  const { Player } = loadPlayer({}, [], { 'audio/flac': 'maybe' }, saverApi);
  Player.init();
  Player.play(
    { id: 'a', filePath: 'Album/01.mp3' },
    [{ id: 'a', filePath: 'Album/01.mp3' }, { id: 'b', filePath: 'Album/02.flac' }]
  );

  assert.deepEqual(warmed, ['b'], 'next track warmed at 128k despite native FLAC support');
});

test('Api stubs without dataSaver keep the legacy prewarm behavior', () => {
  const warmed = [];
  const legacyApi = {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    prewarmTranscode: (id) => warmed.push(id)
  };
  const { Player } = loadPlayer({}, [], { 'audio/flac': 'maybe' }, legacyApi);
  Player.init();
  Player.play(
    { id: 'a', filePath: 'Album/01.mp3' },
    [{ id: 'a', filePath: 'Album/01.mp3' }, { id: 'b', filePath: 'Album/02.flac' }]
  );

  assert.deepEqual(warmed, [], 'no prewarm for natively-playable formats without a saver flag');
});

test('next track is prefetched into a hidden audio element', () => {
  const { Player, createdAudio } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  Player.play(
    { id: 'a', filePath: 'Album/01.mp3' },
    [{ id: 'a', filePath: 'Album/01.mp3' }, { id: 'b', filePath: 'Album/02.flac' }]
  );

  assert.equal(createdAudio.length, 2, 'hidden prefetch element created');
  assert.equal(createdAudio[1].src, '/api/stream/b', 'prefetch targets the next track');
  assert.equal(createdAudio[1].preload, 'auto', 'prefetch downloads ahead');
});

test('prefetch uses the 128k URL when data saver is on', () => {
  const saverApi = {
    streamUrl: (id, t) => '/api/stream/' + id + (saverApi.dataSaver() ? '?fmt=aac&b=128' : (t ? '?fmt=aac' : '')),
    dataSaver: () => true,
    prewarmTranscode: () => {}
  };
  const { Player, createdAudio } = loadPlayer({}, [], {}, saverApi);
  Player.init();
  Player.play(
    { id: 'a', filePath: 'Album/01.mp3' },
    [{ id: 'a', filePath: 'Album/01.mp3' }, { id: 'b', filePath: 'Album/02.flac' }]
  );

  assert.equal(createdAudio.length, 2);
  assert.ok(createdAudio[1].src.includes('fmt=aac&b=128'), 'prefetch matches the URL playback will request');
});

test('no prefetch without a next track', () => {
  const { Player, createdAudio } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  Player.play({ id: 'a', filePath: 'Album/01.mp3' }, [{ id: 'a', filePath: 'Album/01.mp3' }]);

  assert.equal(createdAudio.length, 1, 'no hidden element for a single-track queue');
});

test('network pause clears the prefetch download', () => {
  const { Player, createdAudio } = loadPlayer({}, [], { 'audio/flac': 'maybe' });
  Player.init();
  Player.play(
    { id: 'a', filePath: 'Album/01.mp3' },
    [{ id: 'a', filePath: 'Album/01.mp3' }, { id: 'b', filePath: 'Album/02.flac' }]
  );
  assert.equal(createdAudio.length, 2);

  Player._pauseForNetwork();

  assert.equal(createdAudio[1].src, '', 'offline pause stops the prefetch download');
});

test('prewarmTranscode(null) with data saver on does not throw', () => {
  const warmed = [];
  const saverApi = {
    streamUrl: (id, t) => '/api/stream/' + id + (t ? '?fmt=aac' : ''),
    dataSaver: () => true,
    prewarmTranscode: (id) => warmed.push(id)
  };
  const { Player } = loadPlayer({}, [], {}, saverApi);
  Player.init();

  assert.doesNotThrow(() => Player.prewarmTranscode(null), 'null track must be a no-op');
  assert.deepEqual(warmed, [], 'nothing warmed for a null track');
});

test('guests default to data saver; logged-in users default off', () => {
  const apiSource = readFileSync(new URL('./api.js', import.meta.url), 'utf8')
    .replace('const Api = {', 'globalThis.Api = {');

  const makeApi = (contextExtras) => {
    const context = vm.createContext(Object.assign({
      localStorage: { getItem: () => null, setItem: () => {} },
      fetch: () => Promise.resolve({ ok: true })
    }, contextExtras));
    vm.runInContext(apiSource, context);
    return context.Api;
  };

  const guest = makeApi({ Store: { isGuest: true } });
  assert.equal(guest.dataSaver(), true, 'guest with no stored preference defaults to saver on');

  const user = makeApi({ Store: { isGuest: false } });
  assert.equal(user.dataSaver(), false, 'logged-in user with no stored preference defaults off');

  const guestOff = makeApi({
    Store: { isGuest: true },
    localStorage: { getItem: (k) => (k === 'musicapp:data_saver' ? '0' : null), setItem: () => {} }
  });
  assert.equal(guestOff.dataSaver(), false, 'a guest who explicitly toggled off keeps it off');
});

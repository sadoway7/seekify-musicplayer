import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./player.js', import.meta.url), 'utf8')
  .replace('const Player = {', 'globalThis.Player = {');

function loadPlayer(navigator, order = [], canPlay = {}, api = null) {
  const createdAudio = [];

  class FakeAudio {
    constructor() {
      this.volume = 1;
      this.listeners = new Map();
      order.push('audio');
      createdAudio.push(this);
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    canPlayType(type) { return canPlay[type] || ''; }
  }

  const context = vm.createContext({
    Audio: FakeAudio,
    Math,
    Number,
    console,
    isFinite,
    navigator,
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    Api: api || { reportPlaybackError: () => {} }
  });
  vm.runInContext(source, context);
  return { Player: context.Player, createdAudio };
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

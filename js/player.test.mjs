import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./player.js', import.meta.url), 'utf8')
  .replace('const Player = {', 'globalThis.Player = {');

function loadPlayer(navigator, order = []) {
  const createdAudio = [];

  class FakeAudio {
    constructor() {
      this.volume = 1;
      this.listeners = new Map();
      order.push('audio');
      createdAudio.push(this);
    }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
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
    clearTimeout: () => {}
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

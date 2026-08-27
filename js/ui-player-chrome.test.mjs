import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./ui-player-chrome.js', import.meta.url), 'utf8');

function loadUI(range, docProps) {
  const ctx = { UI: {}, Object, Math, document: { createRange: () => range, documentElement: { style: { setProperty: (k, v) => { (docProps ||= {})[k] = v; } } } } };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return ctx.UI;
}

function fakeTitle(clientWidth, textWidth) {
  const classes = new Set();
  const props = {};
  return {
    clientWidth,
    classList: { remove: c => classes.delete(c), add: c => classes.add(c), contains: c => classes.has(c) },
    style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: k => { delete props[k]; } },
    classes, props,
    rangeWidth: textWidth
  };
}

test('marqueeDistance: full overflow, never negative', () => {
  const UI = loadUI({});
  assert.equal(UI.marqueeDistance(1000, 500), 500);
  assert.equal(UI.marqueeDistance(400, 500), 0);
  assert.equal(UI.marqueeDistance(600, 500), 100);
});

test('long title anchors left and scrolls the full overflow', () => {
  const UI = loadUI({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 1000 }) });
  const el = fakeTitle(500, 1000);
  UI._checkTitleOverflow.call({ els: { npTitle: el } });
  assert.ok(el.classList.contains('scrolling'), 'should scroll');
  assert.equal(el.props['--marquee-dist'], '-500px', 'scrolls the full overflow');
});

test('short title does not scroll', () => {
  const UI = loadUI({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 400 }) });
  const el = fakeTitle(500, 400);
  UI._checkTitleOverflow.call({ els: { npTitle: el } });
  assert.ok(!el.classList.contains('scrolling'));
  assert.equal(el.props['--marquee-dist'], undefined);
});

test('hiding now-playing keeps the album color while a track plays', () => {
  const docProps = {};
  const UI = loadUI({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: 100 }) }, docProps);
  const classes = new Set();
  const state = {
    els: { nowPlaying: { classList: { add: c => classes.add(c) }, style: {} } },
    _albumColor: { r: 10, g: 20, b: 30, h: 200, s: 50, l: 55 },
    _lastColorAlbumId: 'abc123'
  };
  UI._applyNowPlayingHiddenState.call(state);
  assert.ok(classes.has('hidden'));
  assert.deepEqual(docProps, {}, 'hide must not reset waveform color vars');
  assert.equal(state._albumColor.r, 10, 'album color survives hide');
  assert.equal(state._lastColorAlbumId, 'abc123');
});

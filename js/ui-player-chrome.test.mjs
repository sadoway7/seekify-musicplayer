import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./ui-player-chrome.js', import.meta.url), 'utf8');

function loadUI(range) {
  const ctx = { UI: {}, Object, Math, document: { createRange: () => range } };
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

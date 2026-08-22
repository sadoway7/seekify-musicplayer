// Behavioral regression tests for the 2026-08-22 frontend fixes.
// Run: node scripts/regression_fixes_test.mjs
import { readFileSync } from 'fs';

const reviewSrc = readFileSync(new URL('../js/review.js', import.meta.url), 'utf8');
const uiSrc = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

// ---- minimal DOM stubs -------------------------------------------------

function fakeElement() {
  const el = {
    children: [],
    handlers: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {},
    id: '',
    innerHTML: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
    click(type = 'click') { (this.handlers[type] || []).forEach(fn => fn({})); },
    remove() {},
    contains() { return false; },
    querySelector() { return fakeElement(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 40 }; },
  };
  return el;
}

const elementsById = {};
globalThis.document = {
  body: fakeElement(),
  createElement: () => fakeElement(),
  getElementById: (id) => elementsById[id] || null,
  addEventListener() {},
};

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

let pass = 0;
function check(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
  pass++;
}

// ---- F25: bulk delete skips playback when current track is deleted -----

{
  const ReviewUI = new Function(reviewSrc + '; return ReviewUI;')();
  const calls = { next: 0, seek: 0 };
  const playing = { id: 'dead-track' };
  globalThis.Player = {
    getCurrentTrack: () => playing,
    next: () => { calls.next++; },
  };
  let existing = new Set(['dead-track']);
  let scenario = 'current-deleted';
  globalThis.Store = {
    reviewCounts: { needs_review: 2 },
    refreshLibrary: async () => {
      existing = new Set(scenario === 'current-deleted' ? ['dead-track'] : ['other-only']);
    },
    getTrack: (id) => (existing.has(id) ? undefined : { id }),
  };
  globalThis.UI = { showToast() {} };
  globalThis.Api = { reviewDeleteAll: async () => ({ deleted: 2 }) };

  const confirmBtn = fakeElement();
  elementsById['review-delete-cancel'] = fakeElement();
  elementsById['review-delete-confirm-btn'] = confirmBtn;
  elementsById['review-delete-confirm'] = null;

  ReviewUI.overlay = { classList: { remove() {} } };
  ReviewUI.currentTrackId = 'some-other';

  ReviewUI.deleteAllFlagged();
  await confirmBtn.click();
  await new Promise(r => setTimeout(r, 10));

  check(calls.next === 1, 'F25: Player.next() must fire when the currently-playing track was bulk-deleted');

  // Control: current track survives the bulk delete -> no skip.
  calls.next = 0;
  scenario = 'current-survives';
  elementsById['review-delete-confirm'] = null;
  ReviewUI.deleteAllFlagged();
  await confirmBtn.click();
  await new Promise(r => setTimeout(r, 10));
  check(calls.next === 0, 'F25 control: no skip when current track still exists');
}

// ---- F29: waveform drag across a track change must not seek the new one -

{
  const UI = new Function(uiSrc + '; return UI;')();
  const seeks = [];
  const paints = [];
  let current = { id: 'track-a' };
  globalThis.Player = {
    getCurrentTrack: () => current,
    audio: { duration: 100, currentTime: 42 },
    seek: (f) => seeks.push(f),
  };
  UI._paintWaveform = (f) => paints.push(f);
  const canvas = fakeElement();
  UI.els = { waveformCanvas: canvas };
  UI._bindSeekBar();

  const start = canvas.handlers['mousedown'][0];
  const end = document.handlers ? null : null;
  const docHandlers = {};
  const realDoc = globalThis.document;
  // capture document-level listeners registered by _bindSeekBar
  globalThis.document.addEventListener = (type, fn) => { docHandlers[type] = fn; };
  UI._bindSeekBar();
  const onEnd = docHandlers['mouseup'];

  // drag starts on track-a at x=50 (fraction 0.5)
  start({ clientX: 50 });
  // track auto-advances to track-b while the user still holds the drag
  current = { id: 'track-b' };
  onEnd({ clientX: 60 });
  check(seeks.length === 0, 'F29: Player.seek must NOT fire when the track changed mid-drag');
  check(paints.length > 0 && Math.abs(paints[paints.length - 1] - 0.42) < 1e-9,
    'F29: waveform repaints at the new track current position (42/100), not the stale drag fraction');

  // Control: same-track drag still seeks.
  const start2 = canvas.handlers['mousedown'][canvas.handlers['mousedown'].length - 1];
  start2({ clientX: 30 });
  onEnd({ clientX: 70 });
  check(seeks.length === 1 && Math.abs(seeks[0] - 0.7) < 1e-9,
    'F29 control: same-track drag still seeks to the released position');
}

console.log(pass + ' regression checks passed');

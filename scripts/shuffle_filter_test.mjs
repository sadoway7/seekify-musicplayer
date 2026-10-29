// Shuffle-source filtering for per-user blocked ("never for me") tracks.
// Run: node scripts/shuffle_filter_test.mjs

import { readFileSync } from 'fs';

const storeSrc = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
const Store = new Function(storeSrc + '; return Store;')();

function track(id) {
  return { id, title: id };
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Blocked tracks are dropped from the shuffle source.
Store.blocked = ['b'];
assertDeepEqual(
  Store.shuffleSource([track('a'), track('b'), track('c')]).map(t => t.id),
  ['a', 'c'],
  'blocked track dropped from shuffle source'
);

// An all-blocked source falls back to unfiltered rather than playing nothing.
Store.blocked = ['a', 'b'];
assertDeepEqual(
  Store.shuffleSource([track('a'), track('b')]).map(t => t.id),
  ['a', 'b'],
  'all-blocked source falls back to unfiltered'
);

// Nothing blocked: the list passes through untouched.
Store.blocked = [];
const passthrough = [track('a'), track('b')];
assert(Store.shuffleSource(passthrough) === passthrough, 'no blocked tracks returns the same list');

// The optimistic toggle mirrors favorites: local state flips immediately and
// resolves with the server-confirmed state.
const calls = [];
const fakeApi = {
  toggleBlocked: (id) => { calls.push(id); return Promise.resolve({ added: true }); },
  getBlocked: () => Promise.resolve(Store2.blocked.slice())
};
const Store2 = new Function('Api', storeSrc + '; return Store;')(fakeApi);
const on = await Store2.toggleBlocked('x');
assert(on.added === true, 'first toggle resolves added=true');
assertDeepEqual(Store2.blocked, ['x'], 'blocked list holds the track after toggle');
const off = await Store2.toggleBlocked('x');
assert(off.added === false, 'second toggle resolves added=false');
assertDeepEqual(Store2.blocked, [], 'blocked list empty after untoggle');
assertDeepEqual(calls, ['x', 'x'], 'exactly one API call per toggle');

console.log('5 shuffle filter tests passed');

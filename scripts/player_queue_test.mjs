// Focused characterization tests for Player queue ordering.
// Run: node scripts/player_queue_test.mjs

import { readFileSync } from 'fs';

const playerSrc = readFileSync(new URL('../js/player.js', import.meta.url), 'utf8');
const Player = new Function(playerSrc + '; return Player;')();

function track(id) {
  return { id, title: id };
}

function ids(items) {
  return items.map(item => item.id);
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function reset(queue, currentIndex) {
  Player.queue = queue;
  Player._originalQueue = [];
  Player.currentIndex = currentIndex;
  Player.shuffle = false;
  Player.onQueueChange = null;
}

const a = track('a');
const b = track('b');
const c = track('c');
const d = track('d');
const e = track('e');

reset([a, b, c, d], 2);
Player.moveToPlayNext(0);
assertDeepEqual(ids(Player.queue), ['b', 'c', 'a', 'd'], 'history item becomes next');
assertDeepEqual(Player.currentIndex, 1, 'current index follows the current track');

reset([a, b, c, d, e], 1);
Player.moveToPlayNext(4);
assertDeepEqual(ids(Player.queue), ['a', 'b', 'e', 'c', 'd'], 'future item becomes next');
assertDeepEqual(Player.currentIndex, 1, 'future move keeps current index');

reset([b, d, a, c], 1);
Player.shuffle = true;
Player._originalQueue = [a, b, c, d];
let queueChanges = 0;
Player.onQueueChange = () => { queueChanges++; };
Player.moveToPlayNext(0);
assertDeepEqual(ids(Player.queue), ['d', 'b', 'a', 'c'], 'shuffled history item becomes next');
assertDeepEqual(ids(Player._originalQueue), ['a', 'c', 'd', 'b'], 'unshuffled snapshot preserves the same next choice');
Player.toggleShuffle();
assertDeepEqual(ids(Player.queue), ['a', 'c', 'd', 'b'], 'disabling shuffle restores a coherent queue');
assertDeepEqual(Player.currentIndex, 2, 'disabling shuffle keeps the same current track');
assertDeepEqual(queueChanges, 2, 'each queue change emits once');

console.log('3 player queue tests passed');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/ui-home.js', import.meta.url), 'utf8');
const Store = {
  library: {
    artists: [
      { name: 'Artist With Art' },
      { name: 'Artist Without Art' },
    ],
    albums: [
      { id: 'with-art', name: 'Covered Album', artist: 'Artist With Art', hasCover: true },
      { id: 'without-art', name: 'Bare Album', artist: 'Artist Without Art', hasCover: false },
    ],
  },
};
const UI = {
  _esc: value => String(value),
  _homeDiscoveryScore: () => 0,
};
const Api = {
  artistArtUrl: name => '/artist/' + name,
  coverUrl: id => '/cover/' + id,
};

new Function('UI', 'Store', 'Player', 'Api', 'Icons', 'window', 'requestAnimationFrame', source)(
  UI,
  Store,
  {},
  Api,
  {},
  { innerWidth: 1280 },
  callback => callback(),
);

const artists = UI._homeArtists();
assert.match(artists, /Artist With Art/);
assert.doesNotMatch(artists, /Artist Without Art/);

const albums = UI._homeAlbums();
assert.match(albums, /Covered Album/);
assert.doesNotMatch(albums, /Bare Album/);

console.log('2 home discovery artwork tests passed');

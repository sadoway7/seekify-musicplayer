// api.test.mjs — Characterization test for js/api.js
// Loads the actual Api object, mocks fetch/XHR, exercises every function pattern.
// Run: node --experimental-vm-modules api.test.mjs  (or just node api.test.mjs)
//
// Strategy: mock global fetch + XMLHttpRequest + Store, load api.js source as text,
// eval it to get the Api object, then assert every function's behavior.

import { readFileSync } from 'fs';

// ── Mock infrastructure ──
let _fetchCalls = [];
let _fetchResponses = new Map(); // url-pattern → { status, body, headers }
let _xhrMock = null;

function mockFetch(pattern, response) {
  _fetchResponses.set(pattern, response);
}

function resetMocks() {
  _fetchCalls = [];
  _fetchResponses.clear();
}

global.fetch = async (url, opts = {}) => {
  _fetchCalls.push({ url, ...opts });
  // Prefer exact match, then prefix match (for query strings)
  let resp = _fetchResponses.get(url);
  if (!resp) {
    for (const [pattern, r] of _fetchResponses) {
      if (url === pattern || url.startsWith(pattern)) { resp = r; break; }
    }
  }
  if (!resp) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  const status = resp.status || 200;
  const body = resp.body;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => typeof body === 'string' ? JSON.parse(body) : body,
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
  };
};

// Minimal XHR mock for upload-progress functions
class MockXHR {
  constructor() {
    this.status = 200;
    this.responseText = '{}';
    this.upload = { addEventListener: () => {} };
    this._listeners = {};
  }
  addEventListener(ev, fn) { this._listeners[ev] = fn; }
  open(method, url) { this._method = method; this._url = url; }
  send() {
    // Simulate async load
    setTimeout(() => {
      if (this._listeners.load) this._listeners.load();
    }, 0);
  }
}
global.XMLHttpRequest = MockXHR;

// Stub Store (used by clearCustomCover)
global.Store = {
  getTrack: (id) => ({ id, albumID: 'album123' }),
};

// ── Load Api ──
const apiSrc = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const Api = new Function(apiSrc + '; return Api;')();

// ── Test helpers ──
let _pass = 0, _fail = 0, _tests = [];
function test(name, fn) { _tests.push({ name, fn }); }
async function runAll() {
  for (const t of _tests) {
    try {
      resetMocks();
      await t.fn();
      _pass++;
      console.log('  ✓ ' + t.name);
    } catch (e) {
      _fail++;
      console.log('  ✗ ' + t.name + ' — ' + e.message);
    }
  }
  console.log('\n' + _pass + ' passed, ' + _fail + ' failed, ' + _tests.length + ' total');
  if (_fail > 0) process.exit(1);
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || 'assertEqual') + ': expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
function assertDeepEqual(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error((msg || 'assertDeepEqual') + ': expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a));
}
async function assertRejects(promise, msgFragment) {
  try { await promise; throw new Error('Expected rejection'); }
  catch (e) {
    if (msgFragment && !e.message.includes(msgFragment))
      throw new Error('Expected error containing "' + msgFragment + '" got "' + e.message + '"');
  }
}

// ════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════

// ── URL builders ──
test('streamUrl', () => { assertEqual(Api.streamUrl('t1'), '/api/stream/t1'); });
test('downloadUrl', () => { assertEqual(Api.downloadUrl('t1'), '/api/download/t1'); });
test('coverUrl with version', () => {
  Api._coverVer = { a1: 123 };
  assertEqual(Api.coverUrl('a1'), '/api/cover/a1?v=123');
});
test('coverUrl without version', () => {
  Api._coverVer = {};
  Api._libVersion = 999;
  assertEqual(Api.coverUrl('a2'), '/api/cover/a2?v=999');
});
test('coverUrl bare', () => {
  Api._coverVer = undefined;
  Api._libVersion = undefined;
  assertEqual(Api.coverUrl('a3'), '/api/cover/a3');
});
test('bustCover', () => {
  Api._coverVer = undefined;
  Api.bustCover('a1');
  assertEqual(Api._coverVer.a1 > 0, true);
});
test('artistArtUrl', () => { assertEqual(Api.artistArtUrl('Foo Bar'), '/api/artist-art/Foo%20Bar'); });
test('finderCoverUrl', () => { assertEqual(Api.finderCoverUrl('mb1'), '/api/finder/cover/mb1'); });
test('downloadJobUrl', () => { assertEqual(Api.downloadJobUrl('j1'), '/api/download-job/j1'); });

// ── GET throws on error ──
test('getLibrary success', async () => {
  mockFetch('/api/library', { body: { version: 42, tracks: [] } });
  const data = await Api.getLibrary();
  assertEqual(data.version, 42);
  assertEqual(Api._libVersion, 42, '_libVersion side effect');
});
test('getLibrary throws on 500', async () => {
  mockFetch('/api/library', { status: 500, body: { error: 'db down' } });
  // Current code throws hardcoded msg; refactored will extract j.error.
  // Accept either behavior.
  try { await Api.getLibrary(); throw new Error('Expected rejection'); }
  catch (e) { assertEqual(e.message.length > 0, true, 'should have error message'); }
});
test('getPlaylists success', async () => {
  mockFetch('/api/playlists', { body: [] });
  const data = await Api.getPlaylists();
  assertDeepEqual(data, []);
});
test('getPlaylists throws on error', async () => {
  mockFetch('/api/playlists', { status: 404, body: {} });
  await assertRejects(Api.getPlaylists());
});
test('getFavorites success', async () => {
  mockFetch('/api/favorites', { body: { tracks: ['t1'] } });
  const data = await Api.getFavorites();
  assertDeepEqual(data, { tracks: ['t1'] });
});
test('getRecent success', async () => {
  mockFetch('/api/recent', { body: [] });
  const data = await Api.getRecent();
  assertDeepEqual(data, []);
});
test('getFiles with path', async () => {
  mockFetch('/api/admin/files', { body: { files: [] } });
  await Api.getFiles('Music/Rock');
  assertEqual(_fetchCalls[0].url, '/api/admin/files?path=Music%2FRock');
});
test('getFiles without path', async () => {
  mockFetch('/api/admin/files', { body: { files: [] } });
  await Api.getFiles();
  assertEqual(_fetchCalls[0].url, '/api/admin/files');
});
test('metadataUndo throws on error', async () => {
  mockFetch('/api/metadata/undo/x1', { status: 404, body: {} });
  await assertRejects(Api.metadataUndo('x1'), 'Undo failed');
});
test('finderSearch constructs URL', async () => {
  mockFetch('/api/finder/search', { body: [] });
  await Api.finderSearch('Radiohead', 'recording');
  assertEqual(_fetchCalls[0].url, '/api/finder/search?q=Radiohead&type=recording');
});
test('finderYouTubeSearch', async () => {
  mockFetch('/api/finder/youtube', { body: [] });
  await Api.finderYouTubeSearch('test');
  assertEqual(_fetchCalls[0].url, '/api/finder/youtube?q=test');
});
test('finderArtistReleases', async () => {
  mockFetch('/api/finder/artist/mb1/releases', { body: [] });
  await Api.finderArtistReleases('mb1');
  assertEqual(_fetchCalls[0].url, '/api/finder/artist/mb1/releases');
});
test('finderArtistTracks with params', async () => {
  mockFetch('/api/finder/artist/mb1/tracks', { body: [] });
  await Api.finderArtistTracks('mb1', 'Radiohead', 100);
  assertEqual(_fetchCalls[0].url, '/api/finder/artist/mb1/tracks?artist=Radiohead&offset=100&limit=100');
});
test('finderReleaseTracks', async () => {
  mockFetch('/api/finder/release/mb1/tracks', { body: [] });
  await Api.finderReleaseTracks('mb1');
  assertEqual(_fetchCalls[0].url, '/api/finder/release/mb1/tracks');
});
test('getQueue with limit', async () => {
  mockFetch('/api/queue', { body: [] });
  await Api.getQueue(50);
  assertEqual(_fetchCalls[0].url, '/api/queue?limit=50');
});
test('getQueue default limit', async () => {
  mockFetch('/api/queue', { body: [] });
  await Api.getQueue();
  assertEqual(_fetchCalls[0].url, '/api/queue?limit=100');
});
test('getWatched', async () => {
  mockFetch('/api/watch', { body: [] });
  await Api.getWatched();
  assertEqual(_fetchCalls[0].url, '/api/watch');
});
test('getSharedQueue', async () => {
  mockFetch('/api/shared-queue/abc', { body: {} });
  await Api.getSharedQueue('abc');
  assertEqual(_fetchCalls[0].url, '/api/shared-queue/abc');
});
test('previewUrl', async () => {
  mockFetch('/api/preview/vid1', { body: {} });
  await Api.previewUrl('vid1');
  assertEqual(_fetchCalls[0].url, '/api/preview/vid1');
});

// ── GET with fallback (swallows errors) ──
test('getStats success', async () => {
  mockFetch('/api/stats', { body: { count: 10 } });
  const data = await Api.getStats();
  assertEqual(data.count, 10);
});
test('getStats returns null on error', async () => {
  mockFetch('/api/stats', { status: 500, body: {} });
  const data = await Api.getStats();
  assertEqual(data, null);
});
test('metadataScanProgress returns null on error', async () => {
  mockFetch('/api/metadata/scan-progress', { status: 500, body: {} });
  const data = await Api.metadataScanProgress();
  assertEqual(data, null);
});
test('metadataPending returns [] on error', async () => {
  mockFetch('/api/metadata/pending', { status: 500, body: {} });
  const data = await Api.metadataPending();
  assertDeepEqual(data, []);
});
test('metadataAll returns [] on error', async () => {
  mockFetch('/api/metadata/all', { status: 500, body: {} });
  const data = await Api.metadataAll();
  assertDeepEqual(data, []);
});
test('metadataCounts returns null on error', async () => {
  mockFetch('/api/metadata/counts', { status: 500, body: {} });
  const data = await Api.metadataCounts();
  assertEqual(data, null);
});
test('getDownloadable returns [] on error', async () => {
  mockFetch('/api/admin/downloads', { status: 500, body: {} });
  const data = await Api.getDownloadable();
  assertDeepEqual(data, []);
});
test('getCookiesStatus returns {active:false} on error', async () => {
  mockFetch('/api/cookies/status', { status: 500, body: {} });
  const data = await Api.getCookiesStatus();
  assertDeepEqual(data, { active: false });
});
test('getReviewProgress returns null on error', async () => {
  mockFetch('/api/review/progress', { status: 500, body: {} });
  const data = await Api.getReviewProgress();
  assertEqual(data, null);
});
test('getWorkers returns [] on error', async () => {
  mockFetch('/api/workers', { status: 500, body: {} });
  const data = await Api.getWorkers();
  assertDeepEqual(data, []);
});
test('getWorkers includes credentials', async () => {
  mockFetch('/api/workers', { body: [] });
  await Api.getWorkers();
  assertEqual(_fetchCalls[0].credentials, 'include');
});
test('getReviewCounts returns default on error', async () => {
  mockFetch('/api/review/counts', { status: 500, body: {} });
  const data = await Api.getReviewCounts();
  assertDeepEqual(data, { unchecked: 0, needs_review: 0, reviewed_ok: 0 });
});
test('getReviewTracks returns empty on error', async () => {
  mockFetch('/api/review/tracks', { status: 500, body: {} });
  const data = await Api.getReviewTracks(0, 50, ['missing-title']);
  assertDeepEqual(data, { tracks: [], total: 0 });
});
test('getReviewTracks builds URL with flags', async () => {
  mockFetch('/api/review/tracks', { body: { tracks: [], total: 0 } });
  await Api.getReviewTracks(10, 50, ['flag1', 'flag2']);
  assertEqual(_fetchCalls[0].url, '/api/review/tracks?offset=10&limit=50&flag=flag1&flag=flag2');
});

// ── POST/PUT/DELETE throws ──
test('scan sends POST', async () => {
  mockFetch('/api/scan', { body: { status: 'started' } });
  await Api.scan();
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('createPlaylist sends POST with JSON body', async () => {
  mockFetch('/api/playlists', { body: { id: 'p1' } });
  await Api.createPlaylist('My Playlist');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].headers['Content-Type'], 'application/json');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ name: 'My Playlist' }));
});
test('updatePlaylist sends PUT with body', async () => {
  mockFetch('/api/playlists/p1', { body: { updated: true } });
  await Api.updatePlaylist('p1', { name: 'New', trackIds: ['t1'] });
  assertEqual(_fetchCalls[0].method, 'PUT');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ name: 'New', trackIds: ['t1'] }));
});
test('deletePlaylist sends DELETE', async () => {
  mockFetch('/api/playlists/p1', { body: { ok: true } });
  await Api.deletePlaylist('p1');
  assertEqual(_fetchCalls[0].method, 'DELETE');
});
test('toggleFavorite sends POST', async () => {
  mockFetch('/api/favorites/t1', { body: { ok: true } });
  await Api.toggleFavorite('t1');
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('addRecent sends POST', async () => {
  mockFetch('/api/recent/t1', { body: { ok: true } });
  await Api.addRecent('t1');
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('deleteFile sends DELETE with JSON body', async () => {
  mockFetch('/api/admin/files', { body: { ok: true } });
  await Api.deleteFile('/music/test.mp3');
  assertEqual(_fetchCalls[0].method, 'DELETE');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ path: '/music/test.mp3' }));
});
test('createFolder sends POST with JSON', async () => {
  mockFetch('/api/admin/folders', { body: { ok: true } });
  await Api.createFolder('/music', 'NewFolder');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ path: '/music', name: 'NewFolder' }));
});
test('metadataScan sends POST', async () => {
  mockFetch('/api/metadata/scan', { body: { status: 'started' } });
  await Api.metadataScan();
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('reviewMarkOk sends POST with body', async () => {
  mockFetch('/api/review/mark-ok', { body: { ok: true } });
  await Api.reviewMarkOk('t1');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ trackId: 't1' }));
});
test('reviewDelete sends DELETE with body', async () => {
  mockFetch('/api/review/delete', { body: { ok: true } });
  await Api.reviewDelete('t1');
  assertEqual(_fetchCalls[0].method, 'DELETE');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ trackId: 't1' }));
});
test('reviewDeleteAll sends DELETE', async () => {
  mockFetch('/api/review/delete-all', { body: { ok: true } });
  await Api.reviewDeleteAll();
  assertEqual(_fetchCalls[0].method, 'DELETE');
});
test('toggleDownloadPause sends POST', async () => {
  mockFetch('/api/queue/toggle-pause', { body: { ok: true } });
  await Api.toggleDownloadPause();
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('enableAllDownloads sends POST', async () => {
  mockFetch('/api/admin/downloads-enable-all', { body: { ok: true } });
  await Api.enableAllDownloads();
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('bulkImport sends POST with lines', async () => {
  mockFetch('/api/bulk-import', { body: { queued: 5 } });
  await Api.bulkImport('Artist - Song\nArtist2 - Song2');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ lines: 'Artist - Song\nArtist2 - Song2' }));
});
test('saveSettings sends POST with settings', async () => {
  mockFetch('/api/settings', { body: { ok: true } });
  await Api.saveSettings({ key: 'val' });
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ key: 'val' }));
});
test('getSettings', async () => {
  mockFetch('/api/settings', { body: { key: 'val' } });
  const data = await Api.getSettings();
  assertEqual(data.key, 'val');
});
test('shareQueue sends POST with trackIds', async () => {
  mockFetch('/api/shared-queue', { body: { id: 'sq1' } });
  await Api.shareQueue(['t1', 't2']);
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ trackIds: ['t1', 't2'] }));
});
test('watchPlaylist sends POST', async () => {
  mockFetch('/api/watch', { body: { ok: true } });
  await Api.watchPlaylist('https://youtube.com/...');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ url: 'https://youtube.com/...' }));
});
test('deleteWatch sends DELETE', async () => {
  mockFetch('/api/watch/w1', { body: { ok: true } });
  await Api.deleteWatch('w1');
  assertEqual(_fetchCalls[0].method, 'DELETE');
});
test('toggleWatch sends PUT', async () => {
  mockFetch('/api/watch/w1/toggle', { body: { ok: true } });
  await Api.toggleWatch('w1', true);
  assertEqual(_fetchCalls[0].method, 'PUT');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ watching: true }));
});
test('queueAddBatch sends POST with tracks+overrideDir', async () => {
  mockFetch('/api/queue/add-batch', { body: { queued: 3 } });
  await Api.queueAddBatch([{ artist: 'A', title: 'T' }], '/custom/dir');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ tracks: [{ artist: 'A', title: 'T' }], overrideDir: '/custom/dir' }));
});
test('selectVideo sends POST with videoId', async () => {
  mockFetch('/api/queue/j1/select', { body: { ok: true } });
  await Api.selectVideo('j1', 'vid1');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ videoId: 'vid1' }));
});
test('reviewBulkDelete sends POST with flags', async () => {
  mockFetch('/api/review/bulk-delete', { body: { deleted: 5 } });
  await Api.reviewBulkDelete(['missing-title']);
  assertEqual(_fetchCalls[0].body, JSON.stringify({ flags: ['missing-title'] }));
});
test('reviewBulkApprove sends POST with flags', async () => {
  mockFetch('/api/review/bulk-approve', { body: { approved: 3 } });
  await Api.reviewBulkApprove(['missing-title']);
  assertEqual(_fetchCalls[0].body, JSON.stringify({ flags: ['missing-title'] }));
});
test('reviewRecheckAll sends POST', async () => {
  mockFetch('/api/review/recheck-all', { body: { ok: true } });
  await Api.reviewRecheckAll();
  assertEqual(_fetchCalls[0].method, 'POST');
});

// ── POST with fallback ──
test('metadataApprove returns null on error', async () => {
  mockFetch('/api/metadata/approve/m1', { status: 404, body: {} });
  const data = await Api.metadataApprove('m1');
  assertEqual(data, null);
});
test('metadataApprove returns data on success', async () => {
  mockFetch('/api/metadata/approve/m1', { body: { approved: true } });
  const data = await Api.metadataApprove('m1');
  assertEqual(data.approved, true);
});
test('metadataReject returns null on error', async () => {
  mockFetch('/api/metadata/reject/m1', { status: 404, body: {} });
  const data = await Api.metadataReject('m1');
  assertEqual(data, null);
});
test('metadataApproveAll returns null on error', async () => {
  mockFetch('/api/metadata/approve-all', { status: 500, body: {} });
  const data = await Api.metadataApproveAll();
  assertEqual(data, null);
});
test('metadataClear returns null on error', async () => {
  mockFetch('/api/metadata/clear', { status: 500, body: {} });
  const data = await Api.metadataClear();
  assertEqual(data, null);
});
test('metadataRescanTrack returns null on error', async () => {
  mockFetch('/api/metadata/rescan/t1', { status: 500, body: {} });
  const data = await Api.metadataRescanTrack('t1');
  assertEqual(data, null);
});
test('metadataRescanSync returns [] on error', async () => {
  mockFetch('/api/metadata/rescan-sync/t1', { status: 500, body: {} });
  const data = await Api.metadataRescanSync('t1');
  assertDeepEqual(data, []);
});
test('metadataUpdateTrack returns null on error', async () => {
  mockFetch('/api/metadata/update-track/t1', { status: 500, body: {} });
  const data = await Api.metadataUpdateTrack('t1', { title: 'New' });
  assertEqual(data, null);
});
test('metadataUpdateTrack sends body', async () => {
  mockFetch('/api/metadata/update-track/t1', { body: { updated: true } });
  await Api.metadataUpdateTrack('t1', { title: 'New', artist: 'Art' });
  assertEqual(_fetchCalls[0].body, JSON.stringify({ title: 'New', artist: 'Art' }));
});
test('toggleDownload returns null on error', async () => {
  mockFetch('/api/admin/download-toggle/t1', { status: 500, body: {} });
  const data = await Api.toggleDownload('t1');
  assertEqual(data, null);
});
test('reportDuration swallows errors', async () => {
  mockFetch('/api/track-duration/t1', { status: 500, body: {} });
  const data = await Api.reportDuration('t1', 240);
  // Current returns undefined (void); refactored returns null via fallback.
  assertEqual(data == null, true, 'should be null/undefined, not throw');
});
test('reportDuration sends POST with duration', async () => {
  mockFetch('/api/track-duration/t1', { body: { ok: true } });
  await Api.reportDuration('t1', 240);
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body, JSON.stringify({ duration: 240 }));
});

// ── POST with error-message extraction ──
test('queueAdd throws with server error message', async () => {
  mockFetch('/api/queue/add', { status: 400, body: { error: 'No cookies configured' } });
  await assertRejects(Api.queueAdd({ artist: 'A', title: 'T' }), 'No cookies configured');
});
test('queueAdd throws default on no error field', async () => {
  mockFetch('/api/queue/add', { status: 400, body: {} });
  await assertRejects(Api.queueAdd({}), 'Failed to add to queue');
});
test('importPlaylist throws with server error', async () => {
  mockFetch('/api/playlist-import', { status: 400, body: { error: 'Invalid URL' } });
  await assertRejects(Api.importPlaylist('bad'), 'Invalid URL');
});
test('extractCookies throws with server error', async () => {
  mockFetch('/api/cookies/extract', { status: 400, body: { error: 'Browser not found' } });
  await assertRejects(Api.extractCookies('chrome'), 'Browser not found');
});

// ── FormData functions ──
test('uploadCookies sends FormData', async () => {
  mockFetch('/api/cookies/upload', { body: { ok: true } });
  const fakeFile = { name: 'cookies.txt' };
  await Api.uploadCookies(fakeFile);
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body instanceof FormData, true);
  // FormData should NOT set Content-Type header (browser sets multipart boundary)
  assertEqual(_fetchCalls[0].headers, undefined);
});
test('uploadCookies throws with server error', async () => {
  mockFetch('/api/cookies/upload', { status: 400, body: { error: 'Bad format' } });
  await assertRejects(Api.uploadCookies({}), 'Bad format');
});
test('uploadFiles sends FormData', async () => {
  mockFetch('/api/admin/upload', { body: { ok: true } });
  await Api.uploadFiles([{ name: 'a.mp3' }, { name: 'b.flac' }], '/music');
  assertEqual(_fetchCalls[0].method, 'POST');
  assertEqual(_fetchCalls[0].body instanceof FormData, true);
  assertEqual(_fetchCalls[0].url, '/api/admin/upload?path=%2Fmusic');
});
test('uploadCustomCover sends FormData and busts cover', async () => {
  mockFetch('/api/review/upload-cover', { body: { albumId: 'a1' } });
  Api._coverVer = {};
  const data = await Api.uploadCustomCover('t1', { name: 'cover.jpg' });
  assertEqual(data.albumId, 'a1');
  assertEqual(Api._coverVer.a1 > 0, true, 'bustCover side effect');
});
test('clearCustomCover busts cover on cleared', async () => {
  mockFetch('/api/review/clear-cover', { body: { cleared: true } });
  Api._coverVer = {};
  await Api.clearCustomCover('t1');
  assertEqual(Api._coverVer.album123 > 0, true, 'bustCover via Store.getTrack.albumID');
});
test('clearCustomCover does not bust on not cleared', async () => {
  mockFetch('/api/review/clear-cover', { body: { cleared: false } });
  Api._coverVer = {};
  await Api.clearCustomCover('t1');
  assertEqual(Api._coverVer.album123, undefined, 'no bustCover when not cleared');
});

// ── Custom functions ──
test('getWaveform returns data when not pending', async () => {
  mockFetch('/api/waveform/t1', { body: { peaks: [1, 2, 3], pending: false } });
  const data = await Api.getWaveform('t1');
  assertDeepEqual(data, { peaks: [1, 2, 3], pending: false });
});
test('getWaveform returns null on error', async () => {
  mockFetch('/api/waveform/t1', { status: 500, body: {} });
  const data = await Api.getWaveform('t1');
  assertEqual(data, null);
});
test('getReviewLog returns text', async () => {
  mockFetch('/api/review/log', { body: 'line1\nline2\nline3' });
  const data = await Api.getReviewLog();
  assertEqual(data, 'line1\nline2\nline3');
});
test('getReviewLog returns empty string on error', async () => {
  mockFetch('/api/review/log', { status: 500, body: '' });
  const data = await Api.getReviewLog();
  assertEqual(data, '');
});
test('testSlskConnect returns data on success', async () => {
  mockFetch('/api/soulseek/connect', { body: { ok: true, seeded: 5 } });
  const data = await Api.testSlskConnect({ username: 'u', password: 'p' });
  assertEqual(data.ok, true);
  assertEqual(data.seeded, 5);
});
test('testSlskConnect returns {error} on server error', async () => {
  mockFetch('/api/soulseek/connect', { status: 400, body: { error: 'Bad credentials' } });
  const data = await Api.testSlskConnect({ username: 'u', password: 'p' });
  // Note: _req throws, testSlskConnect catches and returns {error: 'Network error: ...'}
  // This is the original behavior — it wraps the error message
  assertEqual(data.error !== undefined, true, 'should have error property');
});
test('runWorker returns json regardless of status', async () => {
  mockFetch('/api/workers/run', { body: { ok: true } });
  const data = await Api.runWorker('scanner');
  assertEqual(data.ok, true);
});
test('runWorker includes credentials', async () => {
  mockFetch('/api/workers/run', { body: { ok: true } });
  await Api.runWorker('test');
  assertEqual(_fetchCalls[0].credentials, 'include');
});

// ── removeTrackFromPlaylist (multi-step) ──
test('removeTrackFromPlaylist filters and updates', async () => {
  mockFetch('/api/playlists', { body: [{ id: 'p1', name: 'My List', trackIds: ['t1', 't2', 't3'] }] });
  mockFetch('/api/playlists/p1', { body: { updated: true } });
  const data = await Api.removeTrackFromPlaylist('p1', 't2');
  assertEqual(data.updated, true);
  // The second call (updatePlaylist) should have filtered trackIds
  assertEqual(_fetchCalls[1].method, 'PUT');
  assertEqual(_fetchCalls[1].body, JSON.stringify({ name: 'My List', trackIds: ['t1', 't3'] }));
});
test('removeTrackFromPlaylist throws if not found', async () => {
  mockFetch('/api/playlists', { body: [{ id: 'p2', name: 'Other', trackIds: [] }] });
  await assertRejects(Api.removeTrackFromPlaylist('p1', 't1'), 'Playlist not found');
});

// ── metadataSearch (returns [] on error) ──
test('metadataSearch returns [] on HTTP error', async () => {
  mockFetch('/api/metadata/search', { status: 500, body: {} });
  const data = await Api.metadataSearch('test');
  assertDeepEqual(data, []);
});
test('metadataSearch returns data on success', async () => {
  mockFetch('/api/metadata/search', { body: [{ title: 'T', artist: 'A' }] });
  const data = await Api.metadataSearch('test');
  assertEqual(data.length, 1);
});

// ── clearCookies, extractCookies ──
test('clearCookies sends POST', async () => {
  mockFetch('/api/cookies/clear', { body: { ok: true } });
  await Api.clearCookies();
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('refreshWatch', async () => {
  mockFetch('/api/watch/w1/refresh', { body: { ok: true } });
  await Api.refreshWatch('w1');
  assertEqual(_fetchCalls[0].url, '/api/watch/w1/refresh');
});
test('retryJob sends POST', async () => {
  mockFetch('/api/queue/j1/retry', { body: { ok: true } });
  await Api.retryJob('j1');
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('deleteJob sends POST', async () => {
  mockFetch('/api/queue/j1/delete', { body: { ok: true } });
  await Api.deleteJob('j1');
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('clearCompletedJobs sends POST', async () => {
  mockFetch('/api/queue/clear-completed', { body: { ok: true } });
  await Api.clearCompletedJobs();
  assertEqual(_fetchCalls[0].method, 'POST');
});
test('getQueueCounts', async () => {
  mockFetch('/api/queue/counts', { body: { active: 3, completed: 10 } });
  const data = await Api.getQueueCounts();
  assertEqual(data.active, 3);
});
test('reviewEditMeta sends body', async () => {
  mockFetch('/api/review/edit-meta', { body: { ok: true } });
  await Api.reviewEditMeta('t1', { title: 'New Title' });
  assertEqual(_fetchCalls[0].body, JSON.stringify({ trackId: 't1', fields: { title: 'New Title' } }));
});
test('artistTrackProgress', async () => {
  mockFetch('/api/finder/artist-track-progress', { body: { progress: 50 } });
  const data = await Api.artistTrackProgress();
  assertEqual(data.progress, 50);
});

// ── Run ──
console.log('Running api.js characterization tests...\n');
runAll();
package store

import (
	"sync/atomic"

	"musicapp/internal/models"
)

// LibraryVersion is the library cache-invalidation counter: every change to
// the library (scan, watcher, metadata edit, review status) bumps it, and
// clients revalidate /api/library against it (it is the response ETag).
// It lives in store, next to the library state it describes — not in the
// HTTP package.
var LibraryVersion atomic.Int64

// Library is the in-memory track/album index handed to View and Update
// callbacks. It exists so callers can work with the maps while the package
// owns the locking; nothing else should hold a *Library beyond the callback
// that received it (track/album pointers themselves are shared, as always).
type Library struct {
	Tracks map[string]*models.Track
	Albums map[string]*models.Album
}

func currentLibrary() *Library {
	return &Library{Tracks: tracks, Albums: albums}
}

// View runs fn with the library under a read lock. Contract, matching the
// direct-lock code it replaces:
//   - fn must not call any other store library op (View, Update, GetTrack,
//     …) — the RWMutex is not reentrant.
//   - fn may take other locks it already took under store's mutex in the old
//     code (CoverMu; ordering Mu→CoverMu is the established direction), but
//     never a lock in the reverse order.
//   - DB/file access inside fn is permitted (several existing critical
//     sections do it) but keeps the same blocking cost as before.
func View(fn func(*Library)) {
	mu.RLock()
	defer mu.RUnlock()
	fn(currentLibrary())
}

// Update runs fn with the library under the write lock. Same contract as
// View, plus: assigning l.Tracks / l.Albums wholesale (replacing a map) is
// honored — Update writes the fields back to the package state under the
// same lock after fn returns. In-place map edits (insert/delete/field writes
// on the pointed-to structs) need no write-back; rebinding under View is a
// harmless no-op.
func Update(fn func(*Library)) {
	mu.Lock()
	l := &Library{Tracks: tracks, Albums: albums}
	fn(l)
	tracks, albums = l.Tracks, l.Albums
	mu.Unlock()
}

// GetTrack returns the track pointer for id (nil if absent). The returned
// pointer is shared and may outlive the internal lock, exactly like the
// RLock-lookup-RUnlock sites it replaces. Must not be called inside View/Update.
func GetTrack(id string) *models.Track {
	mu.RLock()
	defer mu.RUnlock()
	return tracks[id]
}

// GetAlbum returns the album pointer for id (nil if absent). Same sharing
// rules as GetTrack.
func GetAlbum(id string) *models.Album {
	mu.RLock()
	defer mu.RUnlock()
	return albums[id]
}

// AllTracks returns a snapshot slice of all track pointers.
func AllTracks() []*models.Track {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]*models.Track, 0, len(tracks))
	for _, t := range tracks {
		out = append(out, t)
	}
	return out
}

// TrackCount returns the number of tracks in the library.
func TrackCount() int {
	mu.RLock()
	defer mu.RUnlock()
	return len(tracks)
}

// AlbumCount returns the number of albums in the library.
func AlbumCount() int {
	mu.RLock()
	defer mu.RUnlock()
	return len(albums)
}

// ReplaceLibrary swaps the whole index under the write lock. Boot load,
// DedupTracks, and tests are the legitimate users; anything finer-grained
// belongs in an Update callback.
func ReplaceLibrary(newTracks map[string]*models.Track, newAlbums map[string]*models.Album) {
	mu.Lock()
	defer mu.Unlock()
	if newTracks != nil {
		tracks = newTracks
	}
	if newAlbums != nil {
		albums = newAlbums
	}
}

package scanner

import (
	"fmt"
	"hash/fnv"
	"log"
	"musicapp/internal/models"
	"musicapp/internal/store"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/dhowden/tag"
)

// scanning is true while a ScanMusicDirWithPrefixLocked pass is running.
// The watcher checks it to avoid overlapping the startup scan.
var scanning atomic.Bool

// Callbacks set by main to avoid circular imports
var (
	WakeReviewWorker       func()
	InsertUncheckedReviews func(newTracks map[string]*models.Track)
	LibraryVersionAdd      func(delta int64)
	DeleteReview           func(trackID string)
	SetReviewStatus        func(trackID, status, flags, reviewer string)
)

// ResolveFilePath expands a prefixed FilePath into an absolute path on disk.
// If filePath contains a known prefix like "media:", it resolves against that dir.
// Otherwise it resolves against the primary musicDir.
func ResolveFilePath(filePath string) string {
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		prefixKey := prefix + ":"
		if strings.HasPrefix(filePath, prefixKey) {
			relPath := strings.TrimPrefix(filePath, prefixKey)
			return filepath.Join(dir, relPath)
		}
	}
	return filepath.Join(store.MusicDir, filePath)
}

// MusicDirForPath returns the music directory root for a given FilePath.
// Used to determine where to write images/covers for a track.
func MusicDirForPath(filePath string) string {
	for prefix, dir := range store.MusicDirs {
		if prefix == "" {
			continue
		}
		prefixKey := prefix + ":"
		if strings.HasPrefix(filePath, prefixKey) {
			return dir
		}
	}
	return store.MusicDir
}

func TitleFromFilename(path string) string {
	name := filepath.Base(path)
	ext := filepath.Ext(name)
	return strings.TrimSuffix(name, ext)
}

// slskShareDir delegates to store.SlskShareDir (single source of truth).
func slskShareDir() string {
	return store.SlskShareDir()
}

func ScanMusicDir(dir string) models.ScanStats {
	return ScanMusicDirWithPrefix(dir, "")
}

func ScanMusicDirWithPrefix(dir string, prefix string) models.ScanStats {
	store.ScanMu.Lock()
	defer store.ScanMu.Unlock()
	return ScanMusicDirWithPrefixLocked(dir, prefix)
}

func ScanMusicDirWithPrefixLocked(dir string, prefix string) models.ScanStats {
	scanning.Store(true)
	defer scanning.Store(false)
	var stats models.ScanStats

	newTracks := make(map[string]*models.Track)
	newAlbums := make(map[string]*models.Album)
	newCovers := make(map[string][]byte)
	changedTracks := make(map[string]bool)

	skipDir := filepath.Clean(slskShareDir())
	var files []string
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if path == skipDir || strings.HasPrefix(path, skipDir+string(filepath.Separator)) {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if _, ok := store.AudioExtensions[ext]; ok {
			files = append(files, path)
		}
		return nil
	})

	stats.Scanned = len(files)
	log.Printf("Found %d audio files in %s", len(files), dir)

	for i, fpath := range files {
		if i%50 == 0 {
			log.Printf("[scan] Processing file %d/%d...", i+1, len(files))
		}
		relPath, err := filepath.Rel(dir, fpath)
		if err != nil {
			relPath = fpath
		}

		// Prefix the stored FilePath so we can resolve it later
		storedPath := relPath
		if prefix != "" {
			storedPath = prefix + ":" + relPath
		}

		trackID := models.GenerateID(storedPath)

		// Skip unchanged files (ModTime optimization)
		fileInfo, err := os.Stat(fpath)
		if err != nil {
			continue
		}
		fileModTime := fileInfo.ModTime().Unix()
		store.Mu.RLock()
		if existing, ok := store.Tracks[trackID]; ok && existing.ModTime == fileModTime {
			store.Mu.RUnlock()
			// Still include it in the new tracks map so it isn't deleted
			newTracks[trackID] = existing
			if existing.Album != "" {
				if _, exists := newAlbums[existing.AlbumID]; !exists {
					newAlbums[existing.AlbumID] = &models.Album{
						ID:         existing.AlbumID,
						Name:       existing.Album,
						Artist:     existing.AlbumArtist,
						Year:       existing.Year,
						HasCover:   existing.HasCover,
						TrackCount: 1,
					}
				} else {
					newAlbums[existing.AlbumID].TrackCount++
				}
			}
			continue
		}
		store.Mu.RUnlock()

		parts := strings.Split(relPath, string(filepath.Separator))
		folderArtist := ""
		if len(parts) >= 3 {
			folderArtist = parts[0]
		}

		file, err := os.Open(fpath)
		if err != nil {
			log.Printf("Error opening %s: %v", fpath, err)
			continue
		}

		var modTime int64
		modTime = fileModTime

		tagReader, err := tag.ReadFrom(file)
		file.Close()

		track := &models.Track{
			ID:       trackID,
			FilePath: storedPath,
			Duration: 0,
			ModTime:  modTime,
		}

		hasRealTags := false
		var embeddedPic []byte
		if err == nil && tagReader != nil {
			track.Title = tagReader.Title()
			track.Artist = tagReader.Artist()
			track.Album = tagReader.Album()
			track.AlbumArtist = tagReader.AlbumArtist()
			track.Year = tagReader.Year()
			track.Genre = tagReader.Genre()
			trackNum, _ := tagReader.Track()
			track.TrackNumber = trackNum

			picture := tagReader.Picture()
			if picture != nil {
				track.HasCover = true
				embeddedPic = picture.Data
			}

			if tagReader.Title() != "" && tagReader.Title() != "Unknown" {
				hasRealTags = true
			}
		} else {
			log.Printf("Could not read tags from %s: %v", fpath, err)
		}

		if track.Title == "Unknown" || track.Title == "" {
			track.Title = TitleFromFilename(fpath)
		}
		if track.Artist == "Unknown" {
			track.Artist = ""
		}
		if track.Album == "Unknown" {
			track.Album = ""
		}
		if track.Artist == "" {
			if folderArtist != "" {
				track.Artist = folderArtist
			}
		}
		if track.AlbumArtist == "" {
			track.AlbumArtist = track.Artist
		}

		if hasRealTags {
			track.HasMetadata = true
		}

		var albumID string
		if track.Album != "" {
			albumID = models.GenerateAlbumID(track.AlbumArtist, track.Album)
		} else {
			albumID = models.GenerateID("single:" + trackID)
		}
		track.AlbumID = albumID

		newTracks[trackID] = track
		changedTracks[trackID] = true

		if track.Album != "" {
			if _, exists := newAlbums[albumID]; !exists {
				newAlbums[albumID] = &models.Album{
					ID:     albumID,
					Name:   track.Album,
					Artist: track.AlbumArtist,
					Year:   track.Year,
				}
			}
			newAlbums[albumID].TrackCount++
		}

		if track.HasCover && len(embeddedPic) > 0 {
			if albumID != "" {
				if !store.IsCustomCover(albumID) {
					newCovers[albumID] = embeddedPic
				}
				if newAlbums[albumID] == nil {
					newAlbums[albumID] = &models.Album{
						ID:   albumID,
						Name: track.Album,
					}
				}
				newAlbums[albumID].HasCover = true

				coverDir := filepath.Join(store.MusicDir, "images")
				os.MkdirAll(coverDir, 0755)
				coverPath := filepath.Join(coverDir, albumID+".jpg")
				if _, err := os.Stat(coverPath); os.IsNotExist(err) {
					os.WriteFile(coverPath, embeddedPic, 0644)
				}
			}
		}
	}

	log.Printf("[scan] Tag reading done, %d changed of %d total, writing to DB...", len(changedTracks), len(newTracks))

	store.Mu.Lock()
	oldTrackCount := len(store.Tracks)

	tx, err := store.DB.Begin()
	if err != nil {
		log.Printf("[scan] ERROR: DB.Begin failed: %v", err)
	} else {
		for _, t := range newTracks {
			if _, changed := changedTracks[t.ID]; changed {
				store.DbUpsertTrackTx(tx, t)
			}
		}
		for _, a := range newAlbums {
			store.DbUpsertAlbumTx(tx, a)
		}
		tx.Commit()
	}

	if InsertUncheckedReviews != nil {
		InsertUncheckedReviews(newTracks)
	}
	if len(newTracks) > 0 && WakeReviewWorker != nil {
		WakeReviewWorker()
	}

	if prefix == "" {
		for oldID, oldTrack := range store.Tracks {
			if strings.Contains(oldTrack.FilePath, ":") {
				continue
			}
			if _, exists := newTracks[oldID]; !exists {
				store.DbDeleteTrack(oldID)
				if DeleteReview != nil {
					DeleteReview(oldID)
				}
			}
		}

		// Primary scan: replace only primary-dir entries in global maps
		// First remove old primary tracks
		for id := range store.Tracks {
			if !strings.Contains(store.Tracks[id].FilePath, ":") {
				delete(store.Tracks, id)
			}
		}
		// Then merge new primary tracks in
		for id, t := range newTracks {
			store.Tracks[id] = t
		}
		for id, a := range newAlbums {
			store.Albums[id] = a
		}
		// Clean up orphaned albums (no tracks reference them)
		usedAlbums := make(map[string]bool)
		for _, t := range store.Tracks {
			if t.AlbumID != "" {
				usedAlbums[t.AlbumID] = true
			}
		}
		for id := range store.Albums {
			if !usedAlbums[id] {
				store.DbDeleteAlbum(id)
				delete(store.Albums, id)
			}
		}
	} else {
		// Additional directory: merge into existing maps.
		// Skip media-dir tracks whose normalized path already exists as a
		// primary-dir track (prevents cross-prefix duplicates).
		primaryPaths := make(map[string]bool)
		for _, t := range store.Tracks {
			if !strings.HasPrefix(t.FilePath, "media:") && !strings.Contains(t.FilePath, ":") {
				primaryPaths[t.FilePath] = true
			}
		}
		for id, t := range newTracks {
			relPath := strings.TrimPrefix(t.FilePath, prefix+":")
			if primaryPaths[relPath] {
				continue // primary-dir copy wins
			}
			store.Tracks[id] = t
		}
		for id, a := range newAlbums {
			store.Albums[id] = a
		}
		// Prune media-dir tracks whose files disappeared since the last scan.
		// The merge above only adds; files removed externally must be cleaned up
		// here (same os.Stat pattern as the primary prune above).
		prefixKey := prefix + ":"
		for oldID, oldTrack := range store.Tracks {
			if !strings.HasPrefix(oldTrack.FilePath, prefixKey) {
				continue
			}
			if _, exists := newTracks[oldID]; exists {
				continue
			}
			if _, err := os.Stat(ResolveFilePath(oldTrack.FilePath)); os.IsNotExist(err) {
				store.DbDeleteTrack(oldID)
				if DeleteReview != nil {
					DeleteReview(oldID)
				}
				delete(store.Tracks, oldID)
			}
		}
	}
	store.Mu.Unlock()

	store.CoverMu.Lock()
	for id, data := range newCovers {
		store.CoverCache[id] = data
		store.CoverCacheOrder = append(store.CoverCacheOrder, id)
		store.CoverCacheBytes += int64(len(data))
	}
	for store.CoverCacheBytes > store.MaxCoverCacheBytes && len(store.CoverCacheOrder) > 1 {
		oldest := store.CoverCacheOrder[0]
		store.CoverCacheOrder = store.CoverCacheOrder[1:]
		store.CoverCacheBytes -= int64(len(store.CoverCache[oldest]))
		delete(store.CoverCache, oldest)
	}
	store.CoverMu.Unlock()

	stats.Added = len(newTracks)
	if prefix == "" {
		stats.Added = len(newTracks) - oldTrackCount
		if stats.Added < 0 {
			stats.Removed = -stats.Added
			stats.Added = 0
		} else {
			stats.Removed = 0
		}
	}

	return stats
}

// PruneSharedDirTracks removes any tracks whose file path resolves inside the
// Soulseek share directory. These are copies seeded for sharing and should
// never appear in the library.
func PruneSharedDirTracks() int {
	skipDir := filepath.Clean(slskShareDir())
	var toDelete []string
	store.Mu.RLock()
	for id, t := range store.Tracks {
		full := ResolveFilePath(t.FilePath)
		if full == skipDir || strings.HasPrefix(full, skipDir+string(filepath.Separator)) {
			toDelete = append(toDelete, id)
		}
	}
	store.Mu.RUnlock()

	for _, id := range toDelete {
		store.DbDeleteTrack(id)
		store.Mu.Lock()
		delete(store.Tracks, id)
		store.Mu.Unlock()
	}
	if len(toDelete) > 0 {
		log.Printf("[scanner] Pruned %d tracks from Soulseek share dir", len(toDelete))
	}
	return len(toDelete)
}

// PruneMissingTracks removes tracks whose underlying audio file no longer
// exists on disk (moved, renamed, or deleted outside the app). The count-based
// scan triggers cannot detect moves/renames, so this stat-based pass is the
// reliable way to reconcile the library. Only provably-missing files
// (os.IsNotExist) are removed; transient filesystem errors are left alone.
func PruneMissingTracks() int {
	store.Mu.RLock()
	type entry struct {
		id, filePath string
	}
	all := make([]entry, 0, len(store.Tracks))
	for id, t := range store.Tracks {
		all = append(all, entry{id: id, filePath: t.FilePath})
	}
	store.Mu.RUnlock()

	var orphans []string
	for _, e := range all {
		if _, err := os.Stat(ResolveFilePath(e.filePath)); os.IsNotExist(err) {
			orphans = append(orphans, e.id)
		}
	}

	if len(orphans) == 0 {
		return 0
	}

	store.ScanMu.Lock()
	defer store.ScanMu.Unlock()
	store.Mu.Lock()
	removed := 0
	for _, id := range orphans {
		t, ok := store.Tracks[id]
		if !ok {
			continue
		}
		if _, err := os.Stat(ResolveFilePath(t.FilePath)); !os.IsNotExist(err) {
			continue
		}
		store.DbDeleteTrack(id)
		if DeleteReview != nil {
			DeleteReview(id)
		}
		delete(store.Tracks, id)
		removed++
	}
	store.Mu.Unlock()

	if removed > 0 {
		log.Printf("[scan] Pruned %d tracks whose files no longer exist", removed)
		if LibraryVersionAdd != nil {
			LibraryVersionAdd(1)
		}
	}
	return removed
}

func GeneratePlaceholderSVG(name string, id string) string {
	initial := "?"
	if len(name) > 0 {
		initial = strings.ToUpper(string(name[0]))
	}

	// Use ID (unique hash) for color so every album/artist gets a distinct color
	seed := id
	if seed == "" {
		seed = name
	}
	h := fnv.New32a()
	h.Write([]byte(seed))
	hash := h.Sum32()
	hue := hash % 360

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <defs>
    <linearGradient id="bg" x1="0%%" y1="0%%" x2="100%%" y2="100%%">
      <stop offset="0%%" stop-color="hsl(%d, 35%%, 30%%)"/>
      <stop offset="100%%" stop-color="hsl(%d, 45%%, 40%%)"/>
    </linearGradient>
  </defs>
  <rect width="300" height="300" fill="url(#bg)"/>
  <text x="150" y="158" font-family="sans-serif" font-size="80" font-weight="800" fill="hsl(%d, 55%%, 80%%)" text-anchor="middle" dominant-baseline="middle" letter-spacing="-2">%s</text>
</svg>`, hue, (hue+30)%360, hue, initial)
}

func ExtractEmbeddedCovers() {
	coverDir := filepath.Join(store.MusicDir, "images")
	os.MkdirAll(coverDir, 0755)

	store.Mu.RLock()
	type job struct {
		filePath string
		albumID  string
	}
	var jobs []job
	for _, t := range store.Tracks {
		if !t.HasCover || t.AlbumID == "" {
			continue
		}
		if store.IsCustomCover(t.AlbumID) {
			continue
		}
		store.CoverMu.RLock()
		_, cached := store.CoverCache[t.AlbumID]
		store.CoverMu.RUnlock()
		if cached {
			continue
		}
		coverPath := filepath.Join(coverDir, t.AlbumID+".jpg")
		if _, err := os.Stat(coverPath); err == nil {
			data, err := os.ReadFile(coverPath)
			if err == nil {
				store.CacheCover(t.AlbumID, data)
				cached = true
				continue
			}
		}
		jobs = append(jobs, job{filePath: t.FilePath, albumID: t.AlbumID})
	}
	store.Mu.RUnlock()

	if len(jobs) == 0 {
		return
	}

	log.Printf("Extracting embedded cover art from %d files...", len(jobs))

	saved := 0
	for _, j := range jobs {
		fullPath := ResolveFilePath(j.filePath)
		f, err := os.Open(fullPath)
		if err != nil {
			continue
		}

		tagReader, err := tag.ReadFrom(f)
		f.Close()
		if err != nil || tagReader == nil {
			continue
		}

		pic := tagReader.Picture()
		if pic == nil || len(pic.Data) == 0 {
			continue
		}

		coverPath := filepath.Join(coverDir, j.albumID+".jpg")
		if err := os.WriteFile(coverPath, pic.Data, 0644); err != nil {
			continue
	}

	store.Mu.Lock()
		if a, ok := store.Albums[j.albumID]; ok {
			a.HasCover = true
		}
		store.Mu.Unlock()

		saved++
	}

	log.Printf("Extracted %d covers from file tags", saved)
}

func ScanSingleFile(filePath string) {
	store.ScanMu.Lock()
	defer store.ScanMu.Unlock()

	// Never scan files in the Soulseek share dir
	skipDir := filepath.Clean(slskShareDir())
	absPath, _ := filepath.Abs(filePath)
	if absPath == skipDir || strings.HasPrefix(absPath, skipDir+string(filepath.Separator)) {
		return
	}

	fpath := filePath
	relPath, err := filepath.Rel(store.MusicDir, fpath)
	if err != nil {
		relPath = filepath.Base(fpath)
	}

	trackID := models.GenerateID(relPath)

	fileInfo, err := os.Stat(fpath)
	if err != nil {
		log.Printf("[scan] Could not stat %s: %v", fpath, err)
		return
	}
	modTime := fileInfo.ModTime().Unix()

	parts := strings.Split(relPath, string(filepath.Separator))
	folderArtist := ""
	if len(parts) >= 3 {
		folderArtist = parts[0]
	}

	file, err := os.Open(fpath)
	if err != nil {
		log.Printf("[scan] Could not open %s: %v", fpath, err)
		return
	}

	tagReader, err := tag.ReadFrom(file)
	file.Close()

	track := &models.Track{
		ID:       trackID,
		FilePath: relPath,
		Duration: 0,
		ModTime:  modTime,
	}

	hasRealTags := false
	if err == nil && tagReader != nil {
		track.Title = tagReader.Title()
		track.Artist = tagReader.Artist()
		track.Album = tagReader.Album()
		track.AlbumArtist = tagReader.AlbumArtist()
		track.Year = tagReader.Year()
		track.Genre = tagReader.Genre()
		trackNum, _ := tagReader.Track()
		track.TrackNumber = trackNum

		picture := tagReader.Picture()
		if picture != nil {
			track.HasCover = true
		}

		if tagReader.Title() != "" && tagReader.Title() != "Unknown" {
			hasRealTags = true
		}
	}

	if track.Title == "Unknown" || track.Title == "" {
		track.Title = TitleFromFilename(fpath)
	}
	if track.Artist == "Unknown" {
		track.Artist = ""
	}
	if track.Album == "Unknown" {
		track.Album = ""
	}
	if track.Artist == "" && folderArtist != "" {
		track.Artist = folderArtist
	}
	if track.AlbumArtist == "" {
		track.AlbumArtist = track.Artist
	}
	if hasRealTags {
		track.HasMetadata = true
	}

	var albumID string
	if track.Album != "" {
		albumID = models.GenerateAlbumID(track.AlbumArtist, track.Album)
	} else {
		albumID = models.GenerateID("single:" + trackID)
	}
	track.AlbumID = albumID

	if track.HasCover && !store.IsCustomCover(albumID) {
		file2, err := os.Open(fpath)
		if err == nil {
			tagReader2, err := tag.ReadFrom(file2)
			file2.Close()
			if err == nil && tagReader2 != nil {
				pic := tagReader2.Picture()
				if pic != nil && albumID != "" {
					coverDir := filepath.Join(store.MusicDir, "images")
					os.MkdirAll(coverDir, 0755)
					coverPath := filepath.Join(coverDir, albumID+".jpg")
					if _, err := os.Stat(coverPath); os.IsNotExist(err) {
						os.WriteFile(coverPath, pic.Data, 0644)
					}
					store.CacheCover(albumID, pic.Data)
				}
			}
		}
	}

	store.Mu.Lock()
	store.Tracks[trackID] = track
	if track.Album != "" {
		if _, exists := store.Albums[albumID]; !exists {
			store.Albums[albumID] = &models.Album{
				ID:         albumID,
				Name:       track.Album,
				Artist:     track.AlbumArtist,
				Year:       track.Year,
				HasCover:   track.HasCover,
				TrackCount: 1,
			}
		} else {
			store.Albums[albumID].TrackCount++
		}
	}
	store.Mu.Unlock()

	store.DbUpsertTrack(track)
	if SetReviewStatus != nil {
		SetReviewStatus(trackID, "unchecked", "[]", "")
	}
	if WakeReviewWorker != nil {
		WakeReviewWorker()
	}

	log.Printf("[scan] Added single file: %s - %s -> %s", track.Artist, track.Title, relPath)
}

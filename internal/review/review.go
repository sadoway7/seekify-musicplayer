package review

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"musicapp/internal/models"
	"musicapp/internal/musicbrainz"
	"musicapp/internal/store"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ReviewMu     sync.Mutex
	ReviewActive bool
	ReviewWake   = make(chan struct{}, 1)
)

var LibraryVersionAdd func(delta int64)

type ReviewProgressInfo struct {
	sync.RWMutex
	CurrentTrack string
	CurrentID    string
	Checked      int
	Total        int
	Active       bool
}

type ReviewLogInfo struct {
	sync.RWMutex
	Entries []string
}

var (
	ReviewProgressData ReviewProgressInfo
	ReviewLogData      ReviewLogInfo
)

func InitReviewTables() {
	store.DB.Exec(`CREATE TABLE IF NOT EXISTS track_reviews (
		track_id TEXT PRIMARY KEY,
		status TEXT NOT NULL DEFAULT 'unchecked',
		flags TEXT NOT NULL DEFAULT '[]',
		checked_at TEXT NOT NULL DEFAULT '',
		reviewer TEXT NOT NULL DEFAULT ''
	)`)
	store.DB.Exec(`ALTER TABLE track_reviews ADD COLUMN checked_at TEXT NOT NULL DEFAULT ''`)
	store.DB.Exec(`ALTER TABLE track_reviews ADD COLUMN reviewer TEXT NOT NULL DEFAULT ''`)
}

func DbSetReviewStatus(trackID, status, flags, reviewer string) {
	store.DB.Exec(`INSERT INTO track_reviews (track_id, status, flags, checked_at, reviewer)
		VALUES (?, ?, ?, datetime('now'), ?)
		ON CONFLICT(track_id) DO UPDATE SET
			status = excluded.status,
			flags = excluded.flags,
			checked_at = datetime('now'),
			reviewer = excluded.reviewer`,
		trackID, status, flags, reviewer)
}

func DbGetReviewCounts() map[string]int {
	counts := map[string]int{"unchecked": 0, "needs_review": 0, "reviewed_ok": 0}
	rows, err := store.DB.Query("SELECT track_id, status FROM track_reviews")
	if err != nil {
		return counts
	}
	defer rows.Close()
	for rows.Next() {
		var trackID, status string
		rows.Scan(&trackID, &status)
		store.Mu.RLock()
		_, exists := store.Tracks[trackID]
		store.Mu.RUnlock()
		if !exists {
			continue
		}
		counts[status]++
	}
	return counts
}

func DbGetTracksByReviewStatus(status string, limit int) []string {
	var rows *sql.Rows
	var err error
	if limit > 0 {
		rows, err = store.DB.Query("SELECT track_id FROM track_reviews WHERE status = ? LIMIT ?", status, limit)
	} else {
		rows, err = store.DB.Query("SELECT track_id FROM track_reviews WHERE status = ?", status)
	}
	if err != nil {
		return nil
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		store.Mu.RLock()
		_, exists := store.Tracks[id]
		store.Mu.RUnlock()
		if !exists {
			continue
		}
		ids = append(ids, id)
	}
	return ids
}

func DbGetReviewTracks(limit int) []models.Track {
	rows, err := store.DB.Query("SELECT track_id, flags FROM track_reviews WHERE status = 'needs_review' LIMIT ?", limit)
	if err != nil {
		return []models.Track{}
	}
	defer rows.Close()
	type row struct {
		id    string
		flags string
	}
	var rowBuf []row
	for rows.Next() {
		var trackID, flagsJSON string
		rows.Scan(&trackID, &flagsJSON)
		rowBuf = append(rowBuf, row{trackID, flagsJSON})
	}
	store.Mu.RLock()
	result := make([]models.Track, 0, len(rowBuf))
	var orphanIDs []string
	for _, r := range rowBuf {
		t, exists := store.Tracks[r.id]
		if !exists {
			orphanIDs = append(orphanIDs, r.id)
			continue
		}
		cp := *t
		cp.ReviewStatus = "needs_review"
		json.Unmarshal([]byte(r.flags), &cp.ReviewFlags)
		result = append(result, cp)
	}
	store.Mu.RUnlock()
	if len(orphanIDs) > 0 {
		go cleanupOrphanedReviewIDs(orphanIDs)
	}
	return result
}

func DbGetReviewTotal() int {
	var count int
	store.DB.QueryRow("SELECT COUNT(*) FROM track_reviews WHERE status = 'needs_review'").Scan(&count)
	return count
}

func DbGetReviewForTrack(trackID string) (string, []string) {
	var status, flagsJSON string
	err := store.DB.QueryRow("SELECT status, flags FROM track_reviews WHERE track_id = ?", trackID).Scan(&status, &flagsJSON)
	if err == sql.ErrNoRows {
		return "unchecked", nil
	}
	var flags []string
	json.Unmarshal([]byte(flagsJSON), &flags)
	return status, flags
}

func DbGetReviewTracksPage(limit, offset int) []models.Track {
	rows, err := store.DB.Query("SELECT track_id, flags FROM track_reviews WHERE status = 'needs_review' LIMIT ? OFFSET ?", limit, offset)
	if err != nil {
		return []models.Track{}
	}
	defer rows.Close()
	type row struct {
		id    string
		flags string
	}
	var rowBuf []row
	for rows.Next() {
		var trackID, flagsJSON string
		rows.Scan(&trackID, &flagsJSON)
		rowBuf = append(rowBuf, row{trackID, flagsJSON})
	}
	store.Mu.RLock()
	result := make([]models.Track, 0, len(rowBuf))
	var orphanIDs []string
	for _, r := range rowBuf {
		t, exists := store.Tracks[r.id]
		if !exists {
			orphanIDs = append(orphanIDs, r.id)
			continue
		}
		cp := *t
		cp.ReviewStatus = "needs_review"
		json.Unmarshal([]byte(r.flags), &cp.ReviewFlags)
		result = append(result, cp)
	}
	store.Mu.RUnlock()
	if len(orphanIDs) > 0 {
		go cleanupOrphanedReviewIDs(orphanIDs)
	}
	return result
}

func DbLoadAllReviewStatuses() map[string]struct {
	Status string
	Flags  []string
} {
	rows, err := store.DB.Query("SELECT track_id, status, flags FROM track_reviews")
	if err != nil {
		return nil
	}
	defer rows.Close()
	result := make(map[string]struct {
		Status string
		Flags  []string
	})
	for rows.Next() {
		var trackID, status, flagsJSON string
		rows.Scan(&trackID, &status, &flagsJSON)
		var flags []string
		json.Unmarshal([]byte(flagsJSON), &flags)
		result[trackID] = struct {
			Status string
			Flags  []string
		}{status, flags}
	}
	return result
}

func DbResetAllReviews() {
	store.DB.Exec("UPDATE track_reviews SET status = 'unchecked', flags = '[]', checked_at = '', reviewer = ''")
}

func DbDeleteReview(trackID string) {
	store.DB.Exec("DELETE FROM track_reviews WHERE track_id = ?", trackID)
}

func SeedMissingReviewTracks() {
	store.Mu.RLock()
	trackIDs := make([]string, 0, len(store.Tracks))
	for id := range store.Tracks {
		trackIDs = append(trackIDs, id)
	}
	store.Mu.RUnlock()

	rows, err := store.DB.Query("SELECT track_id FROM track_reviews")
	if err != nil {
		return
	}
	existing := make(map[string]bool, len(trackIDs))
	for rows.Next() {
		var id string
		rows.Scan(&id)
		existing[id] = true
	}
	rows.Close()

	count := 0
	for _, id := range trackIDs {
		if !existing[id] {
			DbSetReviewStatus(id, "unchecked", "[]", "")
			count++
		}
	}
	if count > 0 {
		log.Printf("[review] Seeded %d existing tracks for review", count)
	}
}

func CleanupOldReviewFlags() {
	rows, err := store.DB.Query("SELECT track_id, flags FROM track_reviews WHERE flags LIKE '%missing_track_number%' OR flags LIKE '%missing_year%'")
	if err != nil {
		return
	}
	defer rows.Close()
	type item struct {
		id    string
		flags string
	}
	var items []item
	for rows.Next() {
		var i item
		rows.Scan(&i.id, &i.flags)
		items = append(items, i)
	}
	for _, i := range items {
		var flags []string
		json.Unmarshal([]byte(i.flags), &flags)
		var cleaned []string
		for _, f := range flags {
			if f != "missing_track_number" && f != "missing_year" {
				cleaned = append(cleaned, f)
			}
		}
		if len(cleaned) == 0 {
			cleaned = []string{}
		}
		flagsJSON, _ := json.Marshal(cleaned)
		status := "needs_review"
		if len(cleaned) == 0 {
			status = "reviewed_ok"
		}
		DbSetReviewStatus(i.id, status, string(flagsJSON), "cleanup")
	}
	if len(items) > 0 {
		log.Printf("[review] Cleaned up %d tracks with removed flags", len(items))
	}
}

func cleanupOrphanedReviewIDs(ids []string) {
	for _, id := range ids {
		store.DB.Exec("DELETE FROM track_reviews WHERE track_id = ?", id)
	}
	if len(ids) > 0 {
		log.Printf("[review] Cleaned up %d orphaned review records", len(ids))
	}
}

func CleanupOrphanedReviews() {
	store.Mu.RLock()
	existingIDs := make([]string, 0, len(store.Tracks))
	for id := range store.Tracks {
		existingIDs = append(existingIDs, id)
	}
	store.Mu.RUnlock()

	rows, err := store.DB.Query("SELECT track_id FROM track_reviews")
	if err != nil {
		return
	}
	reviewed := make(map[string]bool, len(existingIDs))
	for rows.Next() {
		var id string
		rows.Scan(&id)
		reviewed[id] = true
	}
	rows.Close()

	count := 0
	for _, id := range existingIDs {
		if !reviewed[id] {
			DbSetReviewStatus(id, "unchecked", "[]", "")
			count++
		}
	}

	result, _ := store.DB.Exec("DELETE FROM track_reviews WHERE track_id NOT IN (SELECT id FROM tracks)")
	orphans, _ := result.RowsAffected()

	if count > 0 || orphans > 0 {
		log.Printf("[review] Seeded %d new review rows, cleaned up %d orphaned review rows", count, orphans)
	}
}

func DbInsertUncheckedReviews(newTracks map[string]*models.Track) {
	if len(newTracks) == 0 {
		return
	}
	rows, err := store.DB.Query("SELECT track_id FROM track_reviews")
	if err != nil {
		return
	}
	existing := map[string]bool{}
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			existing[id] = true
		}
	}
	rows.Close()

	tx, err := store.DB.Begin()
	if err != nil {
		log.Printf("[review] ERROR: DB.Begin failed in DbInsertUncheckedReviews: %v", err)
		return
	}
	for id := range newTracks {
		if !existing[id] {
			tx.Exec(`INSERT OR IGNORE INTO track_reviews (track_id, status, flags, checked_at, reviewer) VALUES (?, 'unchecked', '[]', datetime('now'), '')`, id)
		}
	}
	tx.Commit()
}

func DbUpdateTrackMeta(trackID string, fields map[string]interface{}) {
	store.Mu.Lock()
	track, exists := store.Tracks[trackID]
	if !exists {
		store.Mu.Unlock()
		return
	}
	if v, ok := fields["title"].(string); ok && v != "" {
		track.Title = v
	}
	if v, ok := fields["artist"].(string); ok && v != "" {
		track.Artist = v
	}
	if v, ok := fields["album"].(string); ok && v != "" {
		track.Album = v
	}
	if v, ok := fields["albumArtist"].(string); ok {
		track.AlbumArtist = v
	}
	if v, ok := fields["trackNumber"].(float64); ok {
		track.TrackNumber = int(v)
	}
	if v, ok := fields["year"].(float64); ok {
		track.Year = int(v)
	}
	if v, ok := fields["genre"].(string); ok {
		track.Genre = v
	}
	if track.AlbumArtist == "" {
		track.AlbumArtist = track.Artist
	}
	oldAlbumID := track.AlbumID
	if track.Album != "" {
		track.AlbumID = models.GenerateAlbumID(track.AlbumArtist, track.Album)
	}
	if oldAlbumID != "" && track.AlbumID != oldAlbumID {
		store.MoveCustomCover(oldAlbumID, track.AlbumID)
	}
	track.HasMetadata = true

	store.DbUpdateTrackMetadata(track.ID, track.Title, track.Artist, track.Album, track.AlbumArtist)

	if tn, ok := fields["trackNumber"].(float64); ok {
		store.DB.Exec("UPDATE tracks SET track_number = ? WHERE id = ?", int(tn), track.ID)
	}
	if yr, ok := fields["year"].(float64); ok {
		store.DB.Exec("UPDATE tracks SET year = ? WHERE id = ?", int(yr), track.ID)
	}
	if g, ok := fields["genre"].(string); ok {
		store.DB.Exec("UPDATE tracks SET genre = ? WHERE id = ?", g, track.ID)
	}

	musicbrainz.RebuildAlbumsFromTracks()
	store.Mu.Unlock()

	DbSetReviewStatus(trackID, "reviewed_ok", "[]", "manual")
}

func ResolveTrackFilePath(track *models.Track) string {
	if strings.Contains(track.FilePath, ":") {
		parts := strings.SplitN(track.FilePath, ":", 2)
		prefix := parts[0]
		relPath := parts[1]
		if dir, ok := store.MusicDirs[prefix]; ok {
			return filepath.Join(dir, relPath)
		}
	}
	return filepath.Join(store.MusicDir, track.FilePath)
}

func ReviewDeleteTrack(trackID string) error {
	store.Mu.Lock()
	track, exists := store.Tracks[trackID]
	if !exists {
		store.Mu.Unlock()
		return nil
	}
	fullPath := ResolveTrackFilePath(track)
	store.Mu.Unlock()

	if err := os.Remove(fullPath); err != nil && !os.IsNotExist(err) {
		return err
	}

	store.Mu.Lock()
	delete(store.Tracks, trackID)
	store.DbDeleteTrack(trackID)
	DbDeleteReview(trackID)
	musicbrainz.RebuildAlbumsFromTracks()
	store.Mu.Unlock()

	return nil
}

func ReviewDeleteAllFlagged() (int, error) {
	ids := DbGetTracksByReviewStatus("needs_review", 0)
	if len(ids) == 0 {
		return 0, nil
	}

	type item struct {
		id   string
		path string
	}
	items := make([]item, 0, len(ids))
	store.Mu.RLock()
	for _, id := range ids {
		if track, exists := store.Tracks[id]; exists {
			items = append(items, item{id, ResolveTrackFilePath(track)})
		}
	}
	store.Mu.RUnlock()

	for _, it := range items {
		if err := os.Remove(it.path); err != nil && !os.IsNotExist(err) {
			log.Printf("[review] delete-all: failed to remove %s: %v", it.path, err)
		}
	}

	store.Mu.Lock()
	for _, it := range items {
		delete(store.Tracks, it.id)
		store.DbDeleteTrack(it.id)
		DbDeleteReview(it.id)
	}
	musicbrainz.RebuildAlbumsFromTracks()
	store.Mu.Unlock()

	if len(items) > 0 {
		log.Printf("[review] Deleted all flagged tracks: %d removed", len(items))
	}
	return len(items), nil
}

// --- Review check functions ---

// trackHasEffectiveCover reports whether a track would display cover art in
// the UI. Cover art is resolved at the ALBUM level (keyed by AlbumID) from
// multiple sources, so checking only the per-track t.HasCover flag (which is
// true only when the individual file has an embedded picture tag) produces
// false-positive "no_cover" flags for tracks whose album has art from a
// sibling track, MusicBrainz, Cover Art Archive, Deezer, or a custom upload.
func trackHasEffectiveCover(t *models.Track) bool {
	if t.HasCover {
		return true
	}
	if t.AlbumID == "" {
		return false
	}
	if store.IsCustomCover(t.AlbumID) {
		return true
	}
	store.CoverMu.RLock()
	_, cached := store.CoverCache[t.AlbumID]
	store.CoverMu.RUnlock()
	if cached {
		return true
	}
	store.Mu.RLock()
	a, ok := store.Albums[t.AlbumID]
	store.Mu.RUnlock()
	if ok && a.HasCover {
		return true
	}
	coverPath := filepath.Join(store.MusicDir, "images", t.AlbumID+".jpg")
	if _, err := os.Stat(coverPath); err == nil {
		return true
	}
	return false
}

func CheckMetadataCompleteness(t *models.Track) []string {
	var flags []string
	title := strings.TrimSpace(t.Title)
	artist := strings.TrimSpace(t.Artist)
	album := strings.TrimSpace(t.Album)

	if store.GetSettingBool("review_flag_missing_title", true) {
		if title == "" || IsGenericName(title, []string{"unknown title", "untitled", "title"}) {
			flags = append(flags, "missing_title")
		}
	}
	if store.GetSettingBool("review_flag_missing_artist", true) {
		if artist == "" || IsGenericName(artist, []string{"unknown artist", "unknown"}) {
			flags = append(flags, "missing_artist")
		}
	}
	if store.GetSettingBool("review_flag_missing_album", true) {
		if album == "" || IsGenericName(album, []string{"unknown album"}) {
			titlePresent := title != "" && !IsGenericName(title, []string{"unknown title", "untitled", "title"})
			artistPresent := artist != "" && !IsGenericName(artist, []string{"unknown artist", "unknown"})
			if !(titlePresent && artistPresent && trackHasEffectiveCover(t)) {
				flags = append(flags, "missing_album")
			}
		}
	}
	if store.GetSettingBool("review_flag_missing_genre", true) {
		if t.Genre == "" {
			flags = append(flags, "missing_genre")
		}
	}
	if store.GetSettingBool("review_flag_no_cover", true) {
		if !trackHasEffectiveCover(t) {
			flags = append(flags, "no_cover")
		}
	}
	return flags
}

func CheckSuspiciousNaming(t *models.Track) []string {
	var flags []string
	titleLower := strings.ToLower(t.Title)
	artistLower := strings.ToLower(t.Artist)
	combined := titleLower + " " + artistLower

	suspiciousWords := []string{"episode", "podcast", "audiobook", "chapter", "interview",
		"commentary", "copy of", "draft", "final mix", "untitled", "recorded",
		"official", "video"}
	for _, word := range suspiciousWords {
		if strings.Contains(combined, word) {
			flags = append(flags, "suspicious_title")
			break
		}
	}

	videoWords := []string{"video", " cam ", "concert footage", "bootleg", "promo",
		"teaser", "trailer", "snippet", "clip", "behind the scenes", "making of",
		"live cam", "audience recording"}
	for _, word := range videoWords {
		if strings.Contains(combined, word) {
			flags = append(flags, "suspicious_video")
			break
		}
	}

	coverWords := []string{"karaoke", "backing track", "bad cover", "amateur cover",
		"cover by", "performed by", "tribute"}
	for _, word := range coverWords {
		if strings.Contains(combined, word) {
			flags = append(flags, "suspicious_cover")
			break
		}
	}

	if strings.TrimSpace(t.Title) == strings.TrimSpace(t.Artist) && t.Title != "" {
		flags = append(flags, "artist_equals_title")
	}

	if len(t.Title) > 0 && len(t.Title) < 3 {
		flags = append(flags, "very_short_title")
	}
	if len(t.Title) > 200 {
		flags = append(flags, "very_long_title")
	}

	if store.GetSettingBool("review_flag_filename_derived", true) {
		if IsFilenameDerived(t) {
			flags = append(flags, "filename_derived")
		}
	}

	return flags
}

func CheckDuration(t *models.Track, otherFlags []string) []string {
	var flags []string
	if t.Duration > 0 && t.Duration < 30 {
		flags = append(flags, "short_duration")
	}
	if t.Duration > 540 && len(otherFlags) > 0 {
		flags = append(flags, "long_duration")
	}
	return flags
}

func CheckAllDuplicates() {
	store.Mu.RLock()
	byArtist := make(map[string][]*models.Track)
	for _, t := range store.Tracks {
		artistKey := strings.ToLower(strings.TrimSpace(t.Artist))
		if artistKey == "" || artistKey == "unknown artist" {
			continue
		}
		byArtist[artistKey] = append(byArtist[artistKey], t)
	}
	store.Mu.RUnlock()

	for _, artistTracks := range byArtist {
		if len(artistTracks) < 2 {
			continue
		}
		byTitle := make(map[string][]*models.Track)
		for _, t := range artistTracks {
			titleKey := NormalizeForCompare(t.Title)
			byTitle[titleKey] = append(byTitle[titleKey], t)
		}
		checked := make(map[string]bool)
		for _, titleGroup := range byTitle {
			if len(titleGroup) < 2 {
				continue
			}
			for i, a := range titleGroup {
				if checked[a.ID] {
					continue
				}
				var group []*models.Track
				for j, b := range titleGroup {
					if i == j || checked[b.ID] {
						continue
					}
					if TitleSimilarity(a.Title, b.Title) >= 0.95 {
						group = append(group, b)
						checked[b.ID] = true
					}
				}
				if len(group) > 0 {
					group = append(group, a)
					checked[a.ID] = true
					best := PickBestQuality(group)
					for _, t := range group {
						if t.ID == best.ID {
							status, _ := DbGetReviewForTrack(t.ID)
							if status == "unchecked" {
								DbSetReviewStatus(t.ID, "reviewed_ok", "[]", "worker")
							}
							continue
						}
						existingStatus, existingFlags := DbGetReviewForTrack(t.ID)
						if existingStatus == "reviewed_ok" && existingFlags == nil {
							continue
						}
						var newFlags []string
						for _, f := range existingFlags {
							if f != "potential_duplicate" {
								newFlags = append(newFlags, f)
							}
						}
						newFlags = append(newFlags, "potential_duplicate")
						flagJSON, _ := json.Marshal(newFlags)
						DbSetReviewStatus(t.ID, "needs_review", string(flagJSON), "worker")
					}
				}
			}
		}
	}
}

func TitleSimilarity(a, b string) float64 {
	aNorm := NormalizeForCompare(a)
	bNorm := NormalizeForCompare(b)
	if aNorm == bNorm {
		return 1.0
	}
	tokensA := strings.Fields(aNorm)
	tokensB := strings.Fields(bNorm)
	if len(tokensA) == 0 || len(tokensB) == 0 {
		return 0.0
	}
	matches := 0
	for _, ta := range tokensA {
		for _, tb := range tokensB {
			if ta == tb {
				matches++
				break
			}
		}
	}
	maxLen := len(tokensA)
	if len(tokensB) > maxLen {
		maxLen = len(tokensB)
	}
	return float64(matches) / float64(maxLen)
}

func NormalizeForCompare(s string) string {
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "(", "")
	s = strings.ReplaceAll(s, ")", "")
	s = strings.ReplaceAll(s, "[", "")
	s = strings.ReplaceAll(s, "]", "")
	s = strings.ReplaceAll(s, "-", " ")
	s = strings.ReplaceAll(s, "_", " ")
	s = strings.ReplaceAll(s, "'", "")
	s = strings.ReplaceAll(s, ".", "")
	fields := strings.Fields(s)
	return strings.Join(fields, " ")
}

func PickBestQuality(group []*models.Track) *models.Track {
	best := group[0]
	bestScore := QualityScore(best)
	for _, t := range group[1:] {
		s := QualityScore(t)
		if s > bestScore || (s == bestScore && t.ModTime > best.ModTime) {
			best = t
			bestScore = s
		}
	}
	return best
}

func QualityScore(t *models.Track) int {
	score := 0
	if t.HasCover {
		score += 3
	}
	if t.Title != "" && !IsGenericName(t.Title, nil) {
		score += 1
	}
	if t.Artist != "" && !IsGenericName(t.Artist, nil) {
		score += 1
	}
	if t.Album != "" && !IsGenericName(t.Album, nil) {
		score += 1
	}
	if t.TrackNumber > 0 {
		score += 2
	}
	if t.Year > 0 {
		score += 1
	}
	if t.Genre != "" {
		score += 1
	}
	if t.Duration > 0 {
		score += 1
	}
	return score
}

func IsGenericName(s string, extras []string) bool {
	lower := strings.ToLower(strings.TrimSpace(s))
	if lower == "" {
		return true
	}
	generic := []string{"track", "unknown", "untitled", "title"}
	for _, g := range generic {
		if lower == g {
			return true
		}
	}
	for _, e := range extras {
		if lower == e {
			return true
		}
	}
	for i := 0; i < 100; i++ {
		if lower == fmt.Sprintf("track %d", i) || lower == fmt.Sprintf("track%02d", i) || lower == fmt.Sprintf("track %02d", i) {
			return true
		}
	}
	return false
}

func IsFilenameDerived(t *models.Track) bool {
	fileName := filepath.Base(t.FilePath)
	if strings.Contains(fileName, ":") {
		parts := strings.SplitN(fileName, ":", 2)
		fileName = parts[len(parts)-1]
	}
	ext := filepath.Ext(fileName)
	name := strings.TrimSuffix(fileName, ext)
	name = strings.ReplaceAll(name, "_", " ")
	name = strings.ReplaceAll(name, "-", " ")
	name = strings.TrimSpace(name)
	return strings.EqualFold(name, strings.TrimSpace(t.Title))
}

// --- Review worker ---

func StartReviewScheduler() {
	for {
		if !store.GetSettingBool("review_enabled", true) {
			time.Sleep(5 * time.Minute)
			continue
		}

		ReviewMu.Lock()
		if ReviewActive {
			ReviewMu.Unlock()
			time.Sleep(1 * time.Minute)
			continue
		}
		ReviewActive = true
		ReviewMu.Unlock()

		worked := RunReviewBatch()

		ReviewMu.Lock()
		ReviewActive = false
		ReviewMu.Unlock()

		if !worked {
			hours := store.GetSettingInt("review_recheck_hours", 24)
			if hours < 1 {
				hours = 24
			}
			log.Printf("[review] All tracks checked, sleeping %d hours (or until woken)", hours)
			select {
			case <-ReviewWake:
				log.Printf("[review] Woken up — new tracks to check")
			case <-time.After(time.Duration(hours) * time.Hour):
			}
		} else {
			time.Sleep(2 * time.Second)
		}
	}
}

func WakeReviewWorker() {
	select {
	case ReviewWake <- struct{}{}:
	default:
	}
}

func RunReviewBatch() bool {
	batch := DbGetTracksByReviewStatus("unchecked", 50)
	if len(batch) == 0 {
		return false
	}

	log.Printf("[review] Checking batch of %d tracks", len(batch))

	ReviewLogData.Lock()
	ReviewLogData.Entries = nil
	ReviewLogData.Entries = append(ReviewLogData.Entries, fmt.Sprintf("--- Scan started %s ---", time.Now().Format("2006-01-02 15:04:05")))
	ReviewLogData.Unlock()

	store.Mu.RLock()
	var toCheck []*models.Track
	for _, id := range batch {
		if t, ok := store.Tracks[id]; ok {
			toCheck = append(toCheck, t)
		}
	}
	store.Mu.RUnlock()

	for _, t := range toCheck {
		ReviewProgressData.Lock()
		ReviewProgressData.CurrentTrack = t.Title + " — " + t.Artist
		ReviewProgressData.CurrentID = t.ID
		ReviewProgressData.Checked++
		ReviewProgressData.Total = len(toCheck)
		ReviewProgressData.Active = true
		ReviewProgressData.Unlock()

		var allFlags []string
		var details []string

		hasMetaFlag := store.GetSettingBool("review_flag_missing_title", true) ||
			store.GetSettingBool("review_flag_missing_artist", true) ||
			store.GetSettingBool("review_flag_missing_album", true) ||
			store.GetSettingBool("review_flag_missing_genre", true) ||
			store.GetSettingBool("review_flag_no_cover", true)
		if hasMetaFlag {
			metaFlags := CheckMetadataCompleteness(t)
			if len(metaFlags) > 0 {
				allFlags = append(allFlags, metaFlags...)
				details = append(details, fmt.Sprintf("  metadata: title=%q artist=%q album=%q genre=%q cover=%v → %v",
					t.Title, t.Artist, t.Album, t.Genre, t.HasCover, metaFlags))
			}
		}

		if store.GetSettingBool("review_flag_suspicious", true) {
			nameFlags := CheckSuspiciousNaming(t)
			if len(nameFlags) > 0 {
				allFlags = append(allFlags, nameFlags...)
				details = append(details, fmt.Sprintf("  naming: title=%q artist=%q file=%q → %v",
					t.Title, t.Artist, t.FilePath, nameFlags))
			}
		}

		if store.GetSettingBool("review_flag_duration", true) {
			durFlags := CheckDuration(t, allFlags)
			if len(durFlags) > 0 {
				allFlags = append(allFlags, durFlags...)
				details = append(details, fmt.Sprintf("  duration: %ds (%.1fmin) with other flags=%v → %v",
					t.Duration, float64(t.Duration)/60.0, allFlags, durFlags))
			}
		}

		allFlags = UniqueFlags(allFlags)

		if len(allFlags) > 0 {
			flagsJSON, _ := json.Marshal(allFlags)
			DbSetReviewStatus(t.ID, "needs_review", string(flagsJSON), "worker")
			ReviewLogData.Lock()
			ReviewLogData.Entries = append(ReviewLogData.Entries, fmt.Sprintf("⚠ %s — %s [%s] → needs_review", t.Artist, t.Title, strings.Join(allFlags, ", ")))
			ReviewLogData.Unlock()
		} else {
			DbSetReviewStatus(t.ID, "reviewed_ok", "[]", "worker")
			ReviewLogData.Lock()
			ReviewLogData.Entries = append(ReviewLogData.Entries, fmt.Sprintf("✓ %s — %s → ok", t.Artist, t.Title))
			ReviewLogData.Unlock()
		}

	}

	if store.GetSettingBool("review_flag_duplicates", true) {
		ReviewLogData.Lock()
		ReviewLogData.Entries = append(ReviewLogData.Entries, "--- Checking duplicates ---")
		ReviewLogData.Unlock()
		CheckAllDuplicates()
	}

	counts := DbGetReviewCounts()
	ReviewLogData.Lock()
	ReviewLogData.Entries = append(ReviewLogData.Entries, fmt.Sprintf("--- Scan complete: %d unchecked, %d needs_review, %d reviewed_ok ---", counts["unchecked"], counts["needs_review"], counts["reviewed_ok"]))
	ReviewLogData.Unlock()

	ReviewProgressData.Lock()
	ReviewProgressData.CurrentTrack = ""
	ReviewProgressData.CurrentID = ""
	ReviewProgressData.Checked = 0
	ReviewProgressData.Total = 0
	ReviewProgressData.Active = false
	ReviewProgressData.Unlock()

	return len(toCheck) > 0
}

func UniqueFlags(flags []string) []string {
	seen := make(map[string]bool)
	var result []string
	for _, f := range flags {
		if !seen[f] {
			seen[f] = true
			result = append(result, f)
		}
	}
	return result
}

// --- Review API handlers ---

func ReviewTracksHandler(w http.ResponseWriter, r *http.Request) {
	limit := 200
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}
	offset := 0
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		offset = o
	}
	tracks := DbGetReviewTracksPage(limit, offset)
	total := DbGetReviewTotal()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"tracks": tracks,
		"total":  total,
	})
}

func ReviewCountsHandler(w http.ResponseWriter, r *http.Request) {
	counts := DbGetReviewCounts()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(counts)
}

func ReviewMarkOkHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrackID string `json:"trackId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TrackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}
	DbSetReviewStatus(body.TrackID, "reviewed_ok", "[]", "manual")

	store.Mu.Lock()
	if t, ok := store.Tracks[body.TrackID]; ok {
		t.ReviewStatus = "reviewed_ok"
		t.ReviewFlags = nil
	}
	store.Mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func ReviewEditMetaHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrackID string                 `json:"trackId"`
		Fields  map[string]interface{} `json:"fields"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TrackID == "" {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	DbUpdateTrackMeta(body.TrackID, body.Fields)

	if LibraryVersionAdd != nil {
		LibraryVersionAdd(1)
	}

	store.Mu.Lock()
	if t, ok := store.Tracks[body.TrackID]; ok {
		t.ReviewStatus = "reviewed_ok"
		t.ReviewFlags = nil
	}
	store.Mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"updated": true})
}

func ReviewDeleteHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrackID string `json:"trackId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.TrackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}
	if err := ReviewDeleteTrack(body.TrackID); err != nil {
		http.Error(w, "Could not delete file", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"deleted": true})
}

func ReviewDeleteAllHandler(w http.ResponseWriter, r *http.Request) {
	count, err := ReviewDeleteAllFlagged()
	if err != nil {
		http.Error(w, "Could not delete files", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]int{"deleted": count})
}

func ReviewRecheckAllHandler(w http.ResponseWriter, r *http.Request) {
	DbResetAllReviews()
	ReviewLogData.Lock()
	ReviewLogData.Entries = nil
	ReviewLogData.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"reset": true})

	go func() {
		ReviewMu.Lock()
		if !ReviewActive {
			ReviewActive = true
			ReviewMu.Unlock()
			RunReviewBatch()
			ReviewMu.Lock()
			ReviewActive = false
			ReviewMu.Unlock()
		} else {
			ReviewMu.Unlock()
		}
	}()
}

func ReviewProgressHandler(w http.ResponseWriter, r *http.Request) {
	ReviewProgressData.RLock()
	resp := map[string]interface{}{
		"active":       ReviewProgressData.Active,
		"currentTrack": ReviewProgressData.CurrentTrack,
		"currentID":    ReviewProgressData.CurrentID,
		"checked":      ReviewProgressData.Checked,
		"total":        ReviewProgressData.Total,
	}
	ReviewProgressData.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func ReviewLogHandler(w http.ResponseWriter, r *http.Request) {
	ReviewLogData.RLock()
	logText := strings.Join(ReviewLogData.Entries, "\n")
	ReviewLogData.RUnlock()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(logText))
}

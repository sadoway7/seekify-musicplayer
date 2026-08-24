package store

import (
	"database/sql"
	"sync"

	"musicapp/internal/models"
)

var (
	// tracks/albums/mu are package-private on purpose: all access flows
	// through library.go View/Update/sugar so locking stays in one place.
	tracks map[string]*models.Track
	albums map[string]*models.Album
	mu     sync.RWMutex
	CoverCache      map[string][]byte
	CoverMu         sync.RWMutex
	CoverCacheOrder []string
	CoverCacheBytes int64
	CustomCovers    map[string]bool
	MusicDir   string
	MusicDirs  map[string]string
	ScanMu     sync.Mutex

	DB     *sql.DB
	DBPath string

	AudioExtensions = map[string]string{
		".mp3":  "audio/mpeg",
		".flac": "audio/flac",
		".m4a":  "audio/mp4",
		".aac":  "audio/aac",
		".ogg":  "audio/ogg",
		".wav":  "audio/wav",
		".opus": "audio/opus",
		".wma":  "audio/x-ms-wma",
	}
)

const MaxCoverCacheBytes = 256 * 1024 * 1024

func BoolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

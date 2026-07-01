package store

import (
	"path/filepath"
	"strings"
)

// SlskShareDir returns the configured Soulseek share directory, defaulting to
// <MusicDir>/shared when unset. This is the single source of truth — scanner
// and downloads both call this instead of maintaining duplicate helpers.
func SlskShareDir() string {
	if d := GetSetting("slsk_share_dir", ""); d != "" {
		return d
	}
	return filepath.Join(MusicDir, "shared")
}

// IsInSlskShareDir reports whether a stored track FilePath (relative to
// MusicDir, or absolute) resolves inside the Soulseek share folder.
// Used as the ultimate backstop: no shared-folder track should ever be
// persisted to the database.
func IsInSlskShareDir(filePath string) bool {
	shareDir := filepath.Clean(SlskShareDir())
	full := filePath
	if !filepath.IsAbs(full) {
		full = filepath.Join(MusicDir, full)
	}
	full = filepath.Clean(full)
	return full == shareDir || strings.HasPrefix(full, shareDir+string(filepath.Separator))
}

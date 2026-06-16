package store

import (
	"log"
	"os"
	"path/filepath"
)

func LoadCustomCovers() {
	CoverMu.Lock()
	defer CoverMu.Unlock()

	CustomCovers = make(map[string]bool)
	rows, err := DB.Query("SELECT album_id FROM custom_covers")
	if err != nil {
		log.Printf("Failed to load custom covers: %v", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			CustomCovers[id] = true
		}
	}
}

func IsCustomCover(albumID string) bool {
	CoverMu.RLock()
	defer CoverMu.RUnlock()
	return CustomCovers[albumID]
}

func SetCustomCover(albumID string) {
	if albumID == "" {
		return
	}
	CoverMu.Lock()
	CustomCovers[albumID] = true
	CoverMu.Unlock()
	if _, err := DB.Exec("INSERT OR IGNORE INTO custom_covers (album_id) VALUES (?)", albumID); err != nil {
		log.Printf("Failed to persist custom cover %s: %v", albumID, err)
	}
}

func ClearCustomCover(albumID string) {
	if albumID == "" {
		return
	}
	CoverMu.Lock()
	delete(CustomCovers, albumID)
	CoverMu.Unlock()
	if _, err := DB.Exec("DELETE FROM custom_covers WHERE album_id = ?", albumID); err != nil {
		log.Printf("Failed to clear custom cover %s: %v", albumID, err)
	}
}

func MoveCustomCover(oldID, newID string) {
	if oldID == "" || newID == "" || oldID == newID {
		return
	}
	CoverMu.Lock()
	custom := CustomCovers[oldID]
	CoverMu.Unlock()
	if !custom {
		return
	}

	oldPath := filepath.Join(MusicDir, "images", oldID+".jpg")
	newPath := filepath.Join(MusicDir, "images", newID+".jpg")
	if data, err := os.ReadFile(oldPath); err == nil {
		if err := os.WriteFile(newPath, data, 0644); err != nil {
			log.Printf("[cover] Failed to move custom cover file %s -> %s: %v", oldID, newID, err)
		}
		os.Remove(oldPath)
	}

	RemoveCover(oldID)

	ClearCustomCover(oldID)
	SetCustomCover(newID)
}

func CacheCover(albumID string, data []byte) {
	CoverMu.Lock()
	defer CoverMu.Unlock()
	if _, exists := CoverCache[albumID]; exists {
		return
	}
	CoverCache[albumID] = data
	CoverCacheOrder = append(CoverCacheOrder, albumID)
	CoverCacheBytes += int64(len(data))
	for CoverCacheBytes > MaxCoverCacheBytes && len(CoverCacheOrder) > 1 {
		oldest := CoverCacheOrder[0]
		CoverCacheOrder = CoverCacheOrder[1:]
		CoverCacheBytes -= int64(len(CoverCache[oldest]))
		delete(CoverCache, oldest)
	}
}

func RemoveCover(albumID string) {
	CoverMu.Lock()
	defer CoverMu.Unlock()
	if data, exists := CoverCache[albumID]; exists {
		CoverCacheBytes -= int64(len(data))
		delete(CoverCache, albumID)
		for i, id := range CoverCacheOrder {
			if id == albumID {
				CoverCacheOrder = append(CoverCacheOrder[:i], CoverCacheOrder[i+1:]...)
				break
			}
		}
	}
}

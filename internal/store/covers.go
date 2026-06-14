package store

import "log"

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
	ClearCustomCover(oldID)
	SetCustomCover(newID)
}

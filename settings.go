package main

import (
	"database/sql"
)

func initSettingsTable() {
	db.Exec(`CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT ''
	)`)

	migrateSetting("download_format", "flac")
	migrateSetting("download_concurrent", "3")
	migrateSetting("download_organise_by_artist", "true")
	migrateSetting("download_album_subdir", "Albums")
	migrateSetting("download_convert_to_flac", "true")
	migrateSetting("download_min_bitrate", "0")
	migrateSetting("downloads_enabled", "true")
	migrateSetting("waveform_style", "rounded")
	migrateSetting("review_enabled", "true")
	migrateSetting("review_check_naming", "true")
	migrateSetting("review_check_duplicates", "true")
	migrateSetting("review_check_duration", "true")
	migrateSetting("review_recheck_hours", "24")
	migrateSetting("review_flag_missing_title", "true")
	migrateSetting("review_flag_missing_artist", "true")
	migrateSetting("review_flag_missing_album", "true")
	migrateSetting("review_flag_missing_genre", "true")
	migrateSetting("review_flag_no_cover", "true")
	migrateSetting("review_flag_filename_derived", "true")
	migrateSetting("review_flag_suspicious", "true")
	migrateSetting("review_flag_duration", "true")
	migrateSetting("review_flag_duplicates", "true")
}

func migrateSetting(key, defaultVal string) {
	var count int
	db.QueryRow("SELECT COUNT(*) FROM settings WHERE key = ?", key).Scan(&count)
	if count == 0 {
		db.Exec("INSERT INTO settings (key, value) VALUES (?, ?)", key, defaultVal)
	}
}

func getSetting(key, defaultVal string) string {
	var val string
	err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&val)
	if err == sql.ErrNoRows || val == "" {
		return defaultVal
	}
	return val
}

func getSettingBool(key string, defaultVal bool) bool {
	val := getSetting(key, "")
	if val == "" {
		return defaultVal
	}
	return val == "true" || val == "1" || val == "on"
}

func getSettingInt(key string, defaultVal int) int {
	val := getSetting(key, "")
	if val == "" {
		return defaultVal
	}
	var n int
	for _, c := range val {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		} else {
			return defaultVal
		}
	}
	return n
}

func setSetting(key, value string) {
	db.Exec(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`, key, value, value)
}

func getAllSettings() map[string]string {
	rows, err := db.Query("SELECT key, value FROM settings")
	if err != nil {
		return map[string]string{}
	}
	defer rows.Close()
	result := map[string]string{}
	for rows.Next() {
		var k, v string
		if rows.Scan(&k, &v) == nil {
			result[k] = v
		}
	}
	return result
}

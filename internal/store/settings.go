package store

import (
	"database/sql"
	"strconv"
)

func InitSettingsTable() {
	DB.Exec(`CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT ''
	)`)

	MigrateSetting("download_format", "flac")
	MigrateSetting("download_organise_by_artist", "true")
	MigrateSetting("download_album_subdir", "Albums")
	MigrateSetting("download_convert_to_flac", "true")
	MigrateSetting("download_min_bitrate", "0")
	MigrateSetting("downloads_enabled", "true")
	MigrateSetting("yt_player_client", "default")
	MigrateSetting("watcher_enabled", "true")
	MigrateSetting("watcher_interval", "30")
	MigrateSetting("cover_fetch_enabled", "true")
	MigrateSetting("artist_art_fetch_enabled", "true")
	MigrateSetting("waveform_style", "rounded")
	MigrateSetting("default_now_playing_view", "visualizer")
	MigrateSetting("review_enabled", "true")
	MigrateSetting("review_recheck_hours", "24")
	MigrateSetting("review_flag_missing_title", "true")
	MigrateSetting("review_flag_missing_artist", "true")
	MigrateSetting("review_flag_missing_album", "true")
	MigrateSetting("review_flag_missing_genre", "true")
	MigrateSetting("review_flag_no_cover", "true")
	MigrateSetting("review_flag_filename_derived", "true")
	MigrateSetting("review_flag_suspicious", "true")
	MigrateSetting("review_flag_duration", "true")
	MigrateSetting("review_flag_duplicates", "true")

	migrateStalePlayerClientDefault()
}

// migrateStalePlayerClientDefault flips an existing "web" value to "default".
// "web" was the previous default and forces yt-dlp's most-throttled client
// while disabling its smart client cascade. This is a one-shot, idempotent
// migration guarded by a flag key: any later explicit choice (including
// re-selecting "web") is preserved.
func migrateStalePlayerClientDefault() {
	if GetSetting("yt_player_client_migrated", "") == "1" {
		return
	}
	if GetSetting("yt_player_client", "") == "web" {
		SetSetting("yt_player_client", "default")
	}
	SetSetting("yt_player_client_migrated", "1")
}

func MigrateSetting(key, defaultVal string) {
	var count int
	DB.QueryRow("SELECT COUNT(*) FROM settings WHERE key = ?", key).Scan(&count)
	if count == 0 {
		DB.Exec("INSERT INTO settings (key, value) VALUES (?, ?)", key, defaultVal)
	}
}

func GetSetting(key, defaultVal string) string {
	var val string
	err := DB.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&val)
	if err == sql.ErrNoRows || val == "" {
		return defaultVal
	}
	return val
}

func GetSettingBool(key string, defaultVal bool) bool {
	val := GetSetting(key, "")
	if val == "" {
		return defaultVal
	}
	return val == "true" || val == "1" || val == "on"
}

func GetSettingInt(key string, defaultVal int) int {
	val := GetSetting(key, "")
	if val == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return n
}

func SetSetting(key, value string) {
	DB.Exec(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
		ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`, key, value, value)
}

func GetAllSettings() map[string]string {
	rows, err := DB.Query("SELECT key, value FROM settings")
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

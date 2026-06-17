package handlers

import (
	"encoding/json"
	"io"
	"log"
	"musicapp/internal/store"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxCookiesSize = 1 * 1024 * 1024

func cookiesFilePath() string {
	return filepath.Join(filepath.Dir(store.DBPath), "cookies.txt")
}

func UploadCookiesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxCookiesSize)
	if err := r.ParseMultipartForm(maxCookiesSize); err != nil {
		http.Error(w, `{"error":"cookies file too large (max 1MB) or invalid upload"}`, http.StatusRequestEntityTooLarge)
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `{"error":"file required (upload a Netscape cookies.txt)"}`, http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxCookiesSize))
	if err != nil || len(data) == 0 {
		http.Error(w, `{"error":"could not read cookies file"}`, http.StatusBadRequest)
		return
	}

	if !looksLikeNetscapeCookies(data) {
		http.Error(w, `{"error":"not a valid Netscape cookies.txt — export with a browser extension (e.g. 'Get cookies.txt')"}`, http.StatusBadRequest)
		return
	}

	if err := os.WriteFile(cookiesFilePath(), data, 0600); err != nil {
		log.Printf("[cookies] failed to write cookies file: %v", err)
		http.Error(w, `{"error":"could not save cookies file"}`, http.StatusInternalServerError)
		return
	}

	store.SetSetting("yt_cookies_file", cookiesFilePath())
	store.SetSetting("yt_cookies_from_browser", "")

	log.Printf("[cookies] uploaded cookies.txt (%d bytes)", len(data))

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":   true,
		"path": cookiesFilePath(),
		"size": len(data),
	})
}

func looksLikeNetscapeCookies(data []byte) bool {
	for _, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		// #HttpOnly_-prefixed lines are real cookie entries in Netscape format
		// (not comments) — the domain follows the prefix, e.g.
		// "#HttpOnly_.youtube.com\tTRUE\t...". Must not be skipped as a comment.
		httpOnly := strings.HasPrefix(line, "#HttpOnly_")
		if !httpOnly && strings.HasPrefix(line, "#") {
			// The "# Netscape HTTP Cookie File" line is just a comment — it does
			// not by itself prove the file contains usable cookies.
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) >= 7 {
			domain := fields[0]
			if httpOnly {
				domain = strings.TrimPrefix(domain, "#HttpOnly_")
			}
			if strings.Contains(domain, "youtube.com") {
				return true
			}
		}
	}
	return false
}

func ClearCookiesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	os.Remove(cookiesFilePath())
	store.SetSetting("yt_cookies_file", "")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func CookiesStatusHandler(w http.ResponseWriter, r *http.Request) {
	resp := map[string]interface{}{
		"file":   "",
		"size":   0,
		"active": false,
	}
	if info, err := os.Stat(cookiesFilePath()); err == nil {
		resp["file"] = cookiesFilePath()
		resp["size"] = info.Size()
		resp["mtime"] = info.ModTime().Format("2006-01-02 15:04")
	}
	if browser := store.GetSetting("yt_cookies_from_browser", ""); browser != "" {
		resp["browser"] = browser
	}
	if store.GetSetting("yt_cookies_file", "") != "" {
		resp["active"] = true
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

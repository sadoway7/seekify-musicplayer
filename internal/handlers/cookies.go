package handlers

import (
	"encoding/json"
	"io"
	"log"
	"musicapp/internal/store"
	"net/http"
	"os"
	"os/exec"
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
	store.SetSetting("yt_cookies_from_browser", "")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func ExtractCookiesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Browser string `json:"browser"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Browser == "" {
		http.Error(w, `{"error":"browser required (chrome, firefox, etc.)"}`, http.StatusBadRequest)
		return
	}

	ytdlpPath, _ := exec.LookPath("yt-dlp")
	if ytdlpPath == "" {
		http.Error(w, `{"error":"yt-dlp not found"}`, http.StatusInternalServerError)
		return
	}

	tmpFile := cookiesFilePath() + ".tmp"
	os.Remove(tmpFile)

	// --skip-download triggers cookie extraction + metadata only (no video download).
	// "Me at the zoo" is the first YouTube video — always available, minimal work.
	cmd := exec.Command(ytdlpPath,
		"--cookies-from-browser", req.Browser,
		"--cookies", tmpFile,
		"--skip-download",
		"--no-warnings",
		"https://www.youtube.com/watch?v=jNQXAC9IVRw",
	)
	output, err := cmd.CombinedOutput()
	if err != nil {
		os.Remove(tmpFile)
		log.Printf("[cookies] extract from %s failed: %v — output: %s", req.Browser, err, string(output))
		http.Error(w, `{"error":"failed to extract cookies from `+req.Browser+` — close the browser and try again, or try Firefox"}`, http.StatusInternalServerError)
		return
	}

	info, err := os.Stat(tmpFile)
	if err != nil || info.Size() == 0 {
		os.Remove(tmpFile)
		http.Error(w, `{"error":"no cookies extracted — sign into YouTube in `+req.Browser+` first"}`, http.StatusInternalServerError)
		return
	}

	data, err := os.ReadFile(tmpFile)
	if err != nil || !looksLikeNetscapeCookies(data) {
		os.Remove(tmpFile)
		http.Error(w, `{"error":"extracted file does not contain valid YouTube cookies"}`, http.StatusInternalServerError)
		return
	}

	os.Remove(cookiesFilePath())
	if err := os.Rename(tmpFile, cookiesFilePath()); err != nil {
		os.Remove(tmpFile)
		http.Error(w, `{"error":"could not save cookies file"}`, http.StatusInternalServerError)
		return
	}

	// File is the delivery mechanism (no prompts); browser is kept as the source label.
	store.SetSetting("yt_cookies_file", cookiesFilePath())
	store.SetSetting("yt_cookies_from_browser", req.Browser)

	log.Printf("[cookies] extracted from %s — %d bytes saved to %s", req.Browser, info.Size(), cookiesFilePath())

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"browser": req.Browser,
		"path":    cookiesFilePath(),
		"size":    info.Size(),
	})
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

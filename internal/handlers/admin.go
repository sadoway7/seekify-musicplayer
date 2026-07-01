package handlers

import (
	"encoding/json"
	"io"
	"musicapp/internal/store"
	"musicapp/internal/waveform"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const adminPasscode = "pancake"

func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !adminAuthCheck(r) {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func adminAuthCheck(r *http.Request) bool {
	cookie, err := r.Cookie("admin_auth")
	if err != nil {
		return false
	}
	return cookie.Value == "1"
}

func AdminHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	if adminAuthCheck(r) {
		http.ServeFile(w, r, "admin.html")
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Settings Locked</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0E0E0E;color:#F0EFE9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
</style>
</head>
<body>
<div style="text-align:center;max-width:320px;width:100%">
  <div style="width:56px;height:56px;margin:0 auto 20px;border-radius:16px;background:#1E1E1E;display:flex;align-items:center;justify-content:center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D4F040" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  </div>
  <h2 style="font-size:20px;font-weight:700;margin-bottom:6px">Settings Locked</h2>
  <p style="font-size:13px;color:#888;margin-bottom:24px">Enter the access code to continue</p>
  <input id="code" type="password" autocomplete="off" autofocus placeholder="Access code" style="width:100%;padding:14px 16px;background:#1E1E1E;border:2px solid #2a2a2a;border-radius:12px;color:#F0EFE9;font-size:18px;text-align:center;letter-spacing:0.15em;outline:none;transition:border-color 0.2s">
  <div id="err" style="font-size:13px;color:#f87171;min-height:20px;margin-top:12px"></div>
</div>
<script>
(function(){
  var inp=document.getElementById("code");
  var err=document.getElementById("err");
  inp.focus();
  inp.addEventListener("input",function(){err.textContent="";inp.style.borderColor="#2a2a2a"});
  inp.addEventListener("keydown",function(e){
    if(e.key==="Enter"){
      e.preventDefault();
      var v=inp.value;
      fetch("/api/admin-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:v})}).then(function(r){return r.json()}).then(function(d){
        if(d.ok){window.location.reload()}else{err.textContent="Incorrect code";inp.style.borderColor="#f87171";inp.value="";inp.focus()}
      }).catch(function(){err.textContent="Error";inp.value=""});
    }
  });
})();
</script>
</body>
</html>`))
}

func AdminLoginHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	if body.Code != adminPasscode {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":false}`))
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "admin_auth",
		Value:    "1",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func FileListHandler(w http.ResponseWriter, r *http.Request) {
	subPath := r.URL.Query().Get("path")

	dirPath := filepath.Join(store.MusicDir, subPath)
	dirPath = filepath.Clean(dirPath)

	if !strings.HasPrefix(dirPath, store.MusicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	entries, err := os.ReadDir(dirPath)
	if err != nil {
		http.Error(w, "Could not read directory", http.StatusInternalServerError)
		return
	}

	type fileInfo struct {
		Name    string `json:"name"`
		Path    string `json:"path"`
		IsDir   bool   `json:"isDir"`
		Size    int64  `json:"size"`
		ModTime string `json:"modTime"`
	}

	var dirs []fileInfo
	var files []fileInfo

	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		relPath := filepath.Join(subPath, entry.Name())

		if entry.IsDir() {
			dirs = append(dirs, fileInfo{
				Name:    entry.Name(),
				Path:    relPath,
				IsDir:   true,
				Size:    0,
				ModTime: info.ModTime().Format(time.RFC3339),
			})
		} else {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			if _, ok := store.AudioExtensions[ext]; ok {
				files = append(files, fileInfo{
					Name:    entry.Name(),
					Path:    relPath,
					IsDir:   false,
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.RFC3339),
				})
			}
		}
	}

	sort.Slice(dirs, func(i, j int) bool {
		return dirs[i].Name < dirs[j].Name
	})
	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})

	result := append(dirs, files...)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func UploadHandler(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500*1024*1024)

	if err := r.ParseMultipartForm(500 * 1024 * 1024); err != nil {
		http.Error(w, "Upload too large", http.StatusRequestEntityTooLarge)
		return
	}

	subPath := r.FormValue("path")
	targetDir := filepath.Join(store.MusicDir, subPath)
	targetDir = filepath.Clean(targetDir)

	if !strings.HasPrefix(targetDir, store.MusicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		http.Error(w, "Could not create directory", http.StatusInternalServerError)
		return
	}

	var uploaded []string
	var uploadErrors []string

	formFiles := r.MultipartForm.File["files"]
	for _, fh := range formFiles {
		ext := strings.ToLower(filepath.Ext(fh.Filename))
		if _, ok := store.AudioExtensions[ext]; !ok {
			uploadErrors = append(uploadErrors, fh.Filename+": not an audio file")
			continue
		}

		src, err := fh.Open()
		if err != nil {
			uploadErrors = append(uploadErrors, fh.Filename+": could not read file")
			continue
		}

		dstPath := filepath.Join(targetDir, filepath.Base(fh.Filename))
		dst, err := os.Create(dstPath)
		if err != nil {
			src.Close()
			uploadErrors = append(uploadErrors, fh.Filename+": could not save file")
			continue
		}

		_, err = io.Copy(dst, src)
		dst.Close()
		src.Close()

		if err != nil {
			uploadErrors = append(uploadErrors, fh.Filename+": write error")
			continue
		}

		uploaded = append(uploaded, fh.Filename)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"uploaded": uploaded,
		"errors":   uploadErrors,
	})
}

func DeleteFileHandler(w http.ResponseWriter, r *http.Request) {
	subPath := r.URL.Query().Get("path")
	subPath = filepath.Clean(subPath)

	if strings.Contains(subPath, "..") {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(store.MusicDir, subPath)
	fullPath = filepath.Clean(fullPath)

	if !strings.HasPrefix(fullPath, store.MusicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.Remove(fullPath); err != nil {
		http.Error(w, "Could not delete file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"deleted": true})
}

func CreateFolderHandler(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	body.Name = filepath.Base(body.Name)
	if body.Name == "" || body.Name == "." {
		http.Error(w, "Invalid folder name", http.StatusBadRequest)
		return
	}

	targetPath := filepath.Join(store.MusicDir, body.Path, body.Name)
	targetPath = filepath.Clean(targetPath)

	if !strings.HasPrefix(targetPath, store.MusicDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(targetPath, 0755); err != nil {
		http.Error(w, "Could not create folder", http.StatusInternalServerError)
		return
	}

	relPath := filepath.Join(body.Path, body.Name)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"created": true,
		"path":    relPath,
	})
}

func TrackDurationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	trackID := strings.TrimPrefix(r.URL.Path, "/api/track-duration/")
	if trackID == "" {
		http.Error(w, "Track ID required", http.StatusBadRequest)
		return
	}

	var body struct {
		Duration int `json:"duration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if body.Duration <= 0 {
		http.Error(w, "Invalid duration", http.StatusBadRequest)
		return
	}

	store.Mu.Lock()
	if t, ok := store.Tracks[trackID]; ok {
		if t.Duration == 0 {
			t.Duration = body.Duration
			store.DB.Exec("UPDATE tracks SET duration = ? WHERE id = ?", body.Duration, trackID)
		}
	}
	store.Mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"updated": true})
}

func WaveformHandler(w http.ResponseWriter, r *http.Request) {
	trackID := strings.TrimPrefix(r.URL.Path, "/api/waveform/")
	if trackID == "" {
		http.Error(w, `{"error":"missing track id"}`, http.StatusBadRequest)
		return
	}

	peaks, err := waveform.GetCachedWaveform(trackID)
	if err == nil && peaks != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "public, max-age=86400")
		json.NewEncoder(w).Encode(map[string]interface{}{"peaks": peaks})
		return
	}

	waveform.GenerateAsync(trackID)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	json.NewEncoder(w).Encode(map[string]interface{}{"peaks": []float64{}, "pending": true})
}

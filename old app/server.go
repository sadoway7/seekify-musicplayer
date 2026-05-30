package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const (
	port      = ":8081"
	dbRelPath = "db" + string(filepath.Separator) + "LynqInventory.db"
)

func main() {
	dir, err := os.Getwd()
	if err != nil {
		log.Fatalf("Failed to get working directory: %v", err)
	}
	dbPath := filepath.Join(dir, dbRelPath)
	backupDir := filepath.Join(dir, "db", "backups")
	os.MkdirAll(filepath.Dir(dbPath), 0755)
	os.MkdirAll(backupDir, 0755)

	mux := http.NewServeMux()

	// Serve static files from the working directory
	fileServer := http.FileServer(http.Dir(dir))
	mux.Handle("/", fileServer)

	// GET /data — return the SQLite database as raw bytes
	mux.HandleFunc("/data", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			data, err := os.ReadFile(dbPath)
			if err != nil {
				// Return empty database if not found
				w.Header().Set("Content-Type", "application/x-sqlite3")
				w.Write([]byte{})
				return
			}
			w.Header().Set("Content-Type", "application/x-sqlite3")
			w.Write(data)

		case http.MethodPost:
			r.ParseMultipartForm(32 << 20) // 32MB max
			body := r.Body
			if r.MultipartForm != nil && r.MultipartForm.File != nil {
				// If sent as multipart, get the first file
				for _, files := range r.MultipartForm.File {
					f, err := files[0].Open()
					if err != nil {
						http.Error(w, "Failed to read upload", http.StatusBadRequest)
						return
					}
					defer f.Close()
					body = f
					break
				}
			}

			bodyCap := r.ContentLength
			if bodyCap <= 0 {
				bodyCap = 4096
			}
			data := make([]byte, 0, bodyCap)
			buf := make([]byte, 4096)
			for {
				n, err := body.Read(buf)
				if n > 0 {
					data = append(data, buf[:n]...)
				}
				if err != nil {
					break
				}
			}

			if len(data) == 0 {
				http.Error(w, "Empty body", http.StatusBadRequest)
				return
			}

			// Validate SQLite header
			if len(data) >= 16 && string(data[:16]) != "SQLite format 3\x00" {
				http.Error(w, "Not a valid SQLite database file", http.StatusBadRequest)
				return
			}

			// Ensure db directory exists
			os.MkdirAll(filepath.Dir(dbPath), 0755)

			log.Printf("[data] Saving %d bytes to %s", len(data), dbPath)
			if err := os.WriteFile(dbPath, data, 0644); err != nil {
				log.Printf("[data] ERROR writing: %v", err)
				http.Error(w, "Write failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("OK"))

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// POST /backup — create a timestamped backup
	// GET  /backup          — list all backups (JSON)
	// GET  /backup?file=x   — download a backup file
	// DELETE /backup?file=x — delete a backup file
	mux.HandleFunc("/backup", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			ts := time.Now().Format("2006-01-02-150405")
			bp := filepath.Join(backupDir, "LynqInventory-"+ts+".db")
			log.Printf("[backup] Creating backup: %s (db=%s)", bp, dbPath)
			data, err := os.ReadFile(dbPath)
			if err != nil {
				log.Printf("[backup] ERROR reading db: %v", err)
				http.Error(w, "No database to backup: "+err.Error(), http.StatusBadRequest)
				return
			}
			if err := os.WriteFile(bp, data, 0644); err != nil {
				log.Printf("[backup] ERROR writing backup: %v", err)
				http.Error(w, "Backup write failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			log.Printf("[backup] Success: %d bytes", len(data))
			fi, _ := os.Stat(bp)
			if fi == nil {
				http.Error(w, "Backup file stat failed", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"filename": filepath.Base(bp),
				"size":     fi.Size(),
			})

		case http.MethodGet:
			file := r.URL.Query().Get("file")
			if file != "" {
				// Download specific backup (prevent path traversal)
				file = filepath.Base(file)
				fp := filepath.Join(backupDir, file)
				data, err := os.ReadFile(fp)
				if err != nil {
					http.Error(w, "Backup not found", http.StatusNotFound)
					return
				}
				w.Header().Set("Content-Type", "application/x-sqlite3")
				w.Header().Set("Content-Disposition", "attachment; filename="+file)
				w.Write(data)
				return
			}
			// List all backups
			entries, _ := os.ReadDir(backupDir)
			type BackupInfo struct {
				Filename string `json:"filename"`
				Size     int64  `json:"size"`
				Modified string `json:"modified"`
			}
			var backups []BackupInfo
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
					continue
				}
				info, _ := e.Info()
				backups = append(backups, BackupInfo{
					Filename: e.Name(),
					Size:     info.Size(),
					Modified: info.ModTime().Format(time.RFC3339),
				})
			}
			sort.Slice(backups, func(i, j int) bool {
				return backups[i].Modified > backups[j].Modified
			})
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(backups)

		case http.MethodDelete:
			file := r.URL.Query().Get("file")
			if file == "" {
				http.Error(w, "Missing file parameter", http.StatusBadRequest)
				return
			}
			file = filepath.Base(file)
			fp := filepath.Join(backupDir, file)
			if err := os.Remove(fp); err != nil {
				http.Error(w, "Delete failed", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("OK"))

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})

	// POST /backup/upload — upload a .db file as a new backup
	mux.HandleFunc("/backup/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		uploadCap := r.ContentLength
		if uploadCap <= 0 {
			uploadCap = 4096
		}
		data := make([]byte, 0, uploadCap)
		buf := make([]byte, 4096)
		for {
			n, err := r.Body.Read(buf)
			if n > 0 {
				data = append(data, buf[:n]...)
			}
			if err != nil {
				break
			}
		}

		log.Printf("[upload] Received %d bytes", len(data))

		if len(data) == 0 {
			http.Error(w, "Empty file", http.StatusBadRequest)
			return
		}

		// Validate SQLite header: first 16 bytes should be "SQLite format 3\000"
		if len(data) < 16 || string(data[:16]) != "SQLite format 3\x00" {
			http.Error(w, "Not a valid SQLite database file", http.StatusBadRequest)
			return
		}

		// Use original filename or generate timestamp
		filename := r.Header.Get("X-Filename")
		if filename == "" {
			filename = "uploaded-" + time.Now().Format("2006-01-02-150405") + ".db"
		}
		filename = filepath.Base(filename) // sanitize
		if !strings.HasSuffix(filename, ".db") {
			filename += ".db"
		}

		dest := filepath.Join(backupDir, filename)
		log.Printf("[upload] Writing to: %s", dest)
		if err := os.WriteFile(dest, data, 0644); err != nil {
			log.Printf("[upload] ERROR writing: %v", err)
			http.Error(w, "Write failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("[upload] Success: %d bytes -> %s", len(data), filename)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// POST /restore — restore from a backup file (auto-backups first)
	mux.HandleFunc("/restore", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Filename string `json:"filename"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Filename == "" {
			http.Error(w, "Missing filename", http.StatusBadRequest)
			return
		}
		req.Filename = filepath.Base(req.Filename)
		src := filepath.Join(backupDir, req.Filename)

		// Verify backup exists
		if _, err := os.Stat(src); err != nil {
			http.Error(w, "Backup not found", http.StatusNotFound)
			return
		}

		// Auto-backup current DB before overwriting
		ts := time.Now().Format("2006-01-02-150405")
		preRestore := filepath.Join(backupDir, "LynqInventory-pre-restore-"+ts+".db")
		current, err := os.ReadFile(dbPath)
		if err == nil && len(current) > 0 {
			os.WriteFile(preRestore, current, 0644)
		}

		// Copy backup over live DB
		data, err := os.ReadFile(src)
		if err != nil {
			http.Error(w, "Read backup failed", http.StatusInternalServerError)
			return
		}
		if err := os.WriteFile(dbPath, data, 0644); err != nil {
			http.Error(w, "Restore write failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":       "restored",
			"preRestore":   filepath.Base(preRestore),
			"restoredFrom": req.Filename,
		})
	})

	// Find an available port
	listener, err := net.Listen("tcp", port)
	if err != nil {
		log.Fatalf("Port %s unavailable: %v", port, err)
	}
	actualPort := listener.Addr().(*net.TCPAddr).Port
	url := fmt.Sprintf("http://localhost:%d", actualPort)

	fmt.Printf("Lynq Inventory server running at %s\n", url)
	fmt.Println("Press Ctrl+C to stop.")

	// Open the browser
	openBrowser(url)

	log.Fatal(http.Serve(listener, mux))
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

package handlers

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"musicapp/internal/store"
)

func TestPathWithinRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "music")

	tests := []struct {
		name string
		elem []string
		want string
		ok   bool
	}{
		{name: "root", want: root, ok: true},
		{name: "descendant", elem: []string{"Artist", "Album"}, want: filepath.Join(root, "Artist", "Album"), ok: true},
		{name: "parent", elem: []string{".."}, ok: false},
		{name: "prefix sibling", elem: []string{"..", "music-backup"}, ok: false},
		{name: "nested traversal", elem: []string{"Artist", "..", "..", "music-backup"}, ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := pathWithinRoot(root, tt.elem...)
			if ok != tt.ok || got != tt.want {
				t.Fatalf("pathWithinRoot(%q, %q) = (%q, %v), want (%q, %v)", root, tt.elem, got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestAdminFileHandlersRejectPathsOutsideMusicRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "music")
	outside := filepath.Join(base, "music-backup")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0755); err != nil {
		t.Fatal(err)
	}
	victim := filepath.Join(outside, "victim.mp3")
	if err := os.WriteFile(victim, []byte("audio"), 0644); err != nil {
		t.Fatal(err)
	}

	previousMusicDir := store.MusicDir
	store.MusicDir = root
	t.Cleanup(func() { store.MusicDir = previousMusicDir })

	t.Run("list", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodGet, "/api/files?path="+url.QueryEscape("../music-backup"), nil)
		w := httptest.NewRecorder()
		FileListHandler(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})

	t.Run("upload", func(t *testing.T) {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		if err := mw.WriteField("path", "../music-backup"); err != nil {
			t.Fatal(err)
		}
		if err := mw.Close(); err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(http.MethodPost, "/api/upload", &body)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		w := httptest.NewRecorder()
		UploadHandler(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
	})

	t.Run("delete", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodDelete, "/api/delete?path="+url.QueryEscape("../music-backup/victim.mp3"), nil)
		w := httptest.NewRecorder()
		DeleteFileHandler(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
		if _, err := os.Stat(victim); err != nil {
			t.Fatalf("outside file was changed: %v", err)
		}
	})

	t.Run("create folder", func(t *testing.T) {
		r := httptest.NewRequest(http.MethodPost, "/api/folders", strings.NewReader(`{"path":"../music-backup","name":"created"}`))
		w := httptest.NewRecorder()
		CreateFolderHandler(w, r)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
		}
		if _, err := os.Stat(filepath.Join(outside, "created")); !os.IsNotExist(err) {
			t.Fatalf("outside folder exists or stat failed unexpectedly: %v", err)
		}
	})
}

func TestDeleteFileHandlerRejectsMusicRoot(t *testing.T) {
	root := t.TempDir()
	previousMusicDir := store.MusicDir
	store.MusicDir = root
	t.Cleanup(func() { store.MusicDir = previousMusicDir })

	r := httptest.NewRequest(http.MethodDelete, "/api/delete?path=", nil)
	w := httptest.NewRecorder()
	DeleteFileHandler(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		t.Fatalf("music root was changed: info=%v err=%v", info, err)
	}
}

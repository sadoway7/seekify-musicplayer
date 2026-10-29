package main

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGzipMiddleware_CompressesJSON(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"hello":"world"}`)
	})
	srv := httptest.NewServer(gzipMiddleware(inner))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/api/library", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if ce := resp.Header.Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("Content-Encoding = %q, want %q", ce, "gzip")
	}
	if vary := resp.Header.Get("Vary"); !strings.Contains(vary, "Accept-Encoding") {
		t.Fatalf("Vary = %q, want it to contain Accept-Encoding", vary)
	}
	gzr, err := gzip.NewReader(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(gzr)
	if string(body) != `{"hello":"world"}` {
		t.Fatalf("decompressed body = %q", body)
	}
}

func TestGzipMiddleware_SkipsStreamAndNoAccept(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"ok":true}`)
	})
	srv := httptest.NewServer(gzipMiddleware(inner))
	defer srv.Close()

	req, _ := http.NewRequest("GET", srv.URL+"/api/stream/abc", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if ce := resp.Header.Get("Content-Encoding"); ce == "gzip" {
		t.Fatalf("stream path was gzip-compressed; must be skipped")
	}
	resp.Body.Close()

	req2, _ := http.NewRequest("GET", srv.URL+"/api/library", nil)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatal(err)
	}
	if ce := resp2.Header.Get("Content-Encoding"); ce == "gzip" {
		t.Fatalf("response gzip-compressed without Accept-Encoding")
	}
	resp2.Body.Close()
}

func TestAdminPageRetiredFileApiRoutesIntact(t *testing.T) {
	mux := http.NewServeMux()
	registerRoutes(mux)
	// Match the production mux's catch-all so unregistered paths 404 here too.
	mux.HandleFunc("/", http.NotFound)

	// The admin file-management API survives the admin.html retirement:
	// each route stays registered behind the admin gate (anonymous → 403,
	// not the catch-all's 404).
	for _, path := range []string{"/api/upload", "/api/scan", "/api/delete", "/api/files", "/api/folders"} {
		req := httptest.NewRequest(http.MethodPost, path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("POST %s = %d, want %d (route must remain registered)", path, rec.Code, http.StatusForbidden)
		}
	}

	// The legacy /admin page is retired: no route, so it must fall through
	// to the catch-all (404), not hit an admin-gated handler (403).
	req := httptest.NewRequest(http.MethodGet, "/admin", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("GET /admin = %d, want %d (route must be gone)", rec.Code, http.StatusNotFound)
	}
}

func TestMetadataRoutesRequireAdminAndEnforceMethods(t *testing.T) {
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/metadata-preview"},
		{http.MethodPost, "/api/metadata/scan"},
		{http.MethodPost, "/api/metadata/rescan/track-id"},
		{http.MethodPost, "/api/metadata/rescan-sync/track-id"},
		{http.MethodGet, "/api/metadata/search?q=artist+-+title"},
		{http.MethodPost, "/api/metadata/update-track/track-id"},
		{http.MethodGet, "/api/metadata/scan-progress"},
		{http.MethodGet, "/api/metadata/pending"},
		{http.MethodGet, "/api/metadata/all"},
		{http.MethodPost, "/api/metadata/approve/match-id"},
		{http.MethodPost, "/api/metadata/reject/match-id"},
		{http.MethodPost, "/api/metadata/approve-all"},
		{http.MethodPost, "/api/metadata/clear"},
		{http.MethodGet, "/api/metadata/counts"},
		{http.MethodPost, "/api/metadata/undo/match-id"},
	}

	mux := http.NewServeMux()
	registerRoutes(mux)
	// Match the production mux's SPA/API catch-all; method mismatches must not
	// fall through to it as a 404.
	mux.HandleFunc("/", http.NotFound)
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("anonymous status = %d, want %d", rec.Code, http.StatusForbidden)
			}

			wrongMethod := http.MethodPost
			if route.method == http.MethodPost {
				wrongMethod = http.MethodGet
			}
			req = httptest.NewRequest(wrongMethod, route.path, nil)
			rec = httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusMethodNotAllowed {
				t.Fatalf("wrong-method status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
			}
		})
	}
}

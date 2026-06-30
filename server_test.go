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

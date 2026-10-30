package main

import (
	"compress/gzip"
	"io"
	"log"
	"musicapp/internal/downloads"
	"musicapp/internal/handlers"
	"musicapp/internal/review"
	"musicapp/internal/scanner"
	"net/http"
	"strings"
	"time"
)

// wireCrossPackageHooks is THE composition point for cross-package seams.
// These function vars exist only to break import cycles (scanner/review/
// downloads cannot import each other or the handlers package); they are nil
// until wired here and MUST be wired before the server starts serving.
// Library cache invalidation is no longer a seam: store.LibraryVersion is
// called directly by scanner/review.
func wireCrossPackageHooks() {
	downloads.EnrichFunc = handlers.EnrichWithPython
	downloads.TranscodeWarmFunc = handlers.WarmTranscodeCache
	scanner.WakeReviewWorker = review.WakeReviewWorker
	scanner.InsertUncheckedReviews = review.DbInsertUncheckedReviews
	scanner.DeleteReview = review.DbDeleteReview
	scanner.SetReviewStatus = review.DbSetReviewStatus
	scanner.SeedReviewUnchecked = review.DbSeedReviewUnchecked
}

func recoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC] %s %s — %v", r.Method, r.URL.Path, err)
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		// ponytail: skip logging for high-frequency liveness polls
		isPoll := r.URL.Path == "/api/stats"
		if strings.HasPrefix(r.URL.Path, "/api/") && !isPoll {
			log.Printf("[http] %s %s", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && !isPoll {
			log.Printf("[http] %s %s — %s", r.Method, r.URL.Path, time.Since(start))
		}
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	io.Writer
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if g.Header().Get("Content-Type") == "" {
		g.Header().Set("Content-Type", http.DetectContentType(b))
	}
	return g.Writer.Write(b)
}

// gzipMiddleware compresses /api/ JSON responses for clients that accept gzip.
// It deliberately skips binary streams (audio + images) and all non-/api/ paths
// so HTTP Range seeking on audio and Content-Length on static files are unaffected.
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		gzipable := strings.HasPrefix(p, "/api/") &&
			!strings.HasPrefix(p, "/api/stream/") &&
			!strings.HasPrefix(p, "/api/cover/") &&
			!strings.HasPrefix(p, "/api/artist-art/") &&
			!strings.HasPrefix(p, "/api/download/") &&
			!strings.HasPrefix(p, "/api/download-job/") &&
			!strings.HasPrefix(p, "/api/preview/")
		if !gzipable || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Add("Vary", "Accept-Encoding")
		w.Header().Del("Content-Length")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, Writer: gz}, r)
	})
}

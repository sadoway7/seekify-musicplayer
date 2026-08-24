package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"musicapp/internal/auth"
	"musicapp/internal/downloads"
	"musicapp/internal/handlers"
	"musicapp/internal/review"
	"musicapp/internal/store"
)

// gate is the auth level a route requires. gateOpen routes are reachable by
// anyone (trusted-network deployment mode); gateUser requires a logged-in
// session; gateAdmin requires an admin session.
type gate int

const (
	gateOpen gate = iota
	gateUser
	gateAdmin
)

// route is one row of the route inventory. methods, when set, rejects other
// verbs with 405 before the gate check (the behavior of the old adminMethod
// wrapper); nil methods accepts any verb, matching the historical default.
type route struct {
	path    string
	handler http.HandlerFunc
	gate    gate
	methods []string
}

// routeTable is the single source of truth for API routes and their gating.
// To audit "which routes are open/user/admin", read this table.
var routeTable = []route{
	// ── Library, streaming, art (open) ──
	{"/api/library", handlers.LibraryHandler, gateOpen, nil},
	{"/api/stats", handlers.StatsHandler, gateOpen, nil},
	{"/api/stream/", handlers.StreamHandler, gateOpen, nil},
	{"/api/transcode-warm/", handlers.TranscodeWarmHandler, gateOpen, nil},
	{"/api/cover/", handlers.CoverHandler, gateOpen, nil},
	{"/api/artist-art/", handlers.ArtistArtHandler, gateOpen, nil},
	{"/api/artist-art-fetch/", handlers.ArtistArtFetchHandler, gateOpen, nil},
	{"/api/health", func(w http.ResponseWriter, r *http.Request) {
		ytdlp := downloads.FindYtDlp()
		ffmpeg := downloads.FindFfmpeg()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"yt-dlp": ytdlp,
			"ffmpeg": ffmpeg,
		})
	}, gateOpen, nil},
	{"/api/setup-status", handlers.SetupStatusHandler, gateOpen, nil},
	{"/api/setup", handlers.SetupHandler, gateOpen, nil},
	{"/api/login", handlers.LoginHandler, gateOpen, nil},
	{"/api/logout", handlers.LogoutHandler, gateOpen, nil},
	{"/api/me", handlers.MeHandler, gateOpen, nil},
	{"/api/registration", handlers.RegistrationModeHandler, gateOpen, nil},
	{"/api/register", handlers.RegisterHandler, gateOpen, nil},
	{"/api/waveform/", handlers.WaveformHandler, gateOpen, nil},
	{"/api/bands/", handlers.BandsHandler, gateOpen, nil},
	{"/api/download/", handlers.DownloadHandler, gateOpen, nil},
	{"/api/download-job/", handlers.DownloadJobFileHandler, gateOpen, nil},
	{"/api/shared-queue", handlers.SharedQueueCreateHandler, gateOpen, nil},
	{"/api/shared-queue/", handlers.SharedQueueGetHandler, gateOpen, nil},
	{"/api/settings/public", handlers.PublicSettingsHandler, gateOpen, nil},

	// ── Finder (search open; ripping actions need a user) ──
	{"/api/finder/search", handlers.FinderSearchHandler, gateOpen, nil},
	{"/api/finder/artist/", handlers.FinderArtistReleasesHandler, gateOpen, nil},
	{"/api/finder/artist-track-progress", handlers.ArtistTrackProgressHandler, gateOpen, nil},
	{"/api/finder/release/", handlers.FinderReleaseTracksHandler, gateOpen, nil},
	{"/api/finder/cover/", handlers.FinderCoverHandler, gateOpen, nil},
	{"/api/finder/youtube", handlers.YoutubeSearchHandler, gateUser, nil},
	{"/api/preview/", handlers.PreviewAudioHandler, gateUser, nil},

	// ── Personal collections (user) ──
	{"/api/playlists", handlers.PlaylistsHandler, gateUser, nil},
	{"/api/playlists/", handlers.PlaylistHandler, gateUser, nil},
	{"/api/favorites", handlers.FavoritesHandler, gateUser, nil},
	{"/api/favorites/", handlers.FavoriteToggleHandler, gateUser, nil},
	{"/api/recent", handlers.RecentHandler, gateUser, nil},
	{"/api/recent/", handlers.RecentAddHandler, gateUser, nil},
	{"/api/normalize/", handlers.NormalizeHandler, gateUser, nil},
	{"/api/track-duration/", handlers.TrackDurationHandler, gateUser, nil},
	{"/api/playback-error/", handlers.TrackPlaybackErrorHandler, gateUser, nil},
	{"/api/users/me/password", handlers.ChangeOwnPasswordHandler, gateUser, nil},

	// ── Download queue (user; global controls admin) ──
	{"/api/queue", handlers.DownloadQueueHandler, gateUser, nil},
	{"/api/queue/add", handlers.DownloadQueueAddHandler, gateUser, nil},
	{"/api/queue/add-batch", handlers.DownloadQueueAddBatchHandler, gateUser, nil},
	{"/api/queue/counts", handlers.QueueCountsHandler, gateUser, nil},
	{"/api/queue/clear-completed", handlers.QueueClearCompletedHandler, gateUser, nil},
	{"/api/queue/retry-all-failed", handlers.DownloadRetryAllFailedHandler, gateUser, nil},
	{"/api/queue/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/retry") {
			handlers.DownloadJobRetryHandler(w, r)
		} else if strings.HasSuffix(path, "/delete") {
			handlers.DownloadJobDeleteHandler(w, r)
		} else if strings.HasSuffix(path, "/select") {
			handlers.DownloadJobSelectHandler(w, r)
		} else {
			handlers.DownloadJobStatusHandler(w, r)
		}
	}, gateUser, nil},
	{"/api/bulk-import", handlers.BulkImportHandler, gateUser, nil},
	{"/api/playlist-import", handlers.PlaylistImportHandler, gateUser, nil},
	{"/api/watch", handlers.WatchedPlaylistsHandler, gateUser, nil},
	{"/api/watch/", handlers.WatchedPlaylistsHandler, gateUser, nil},

	// ── Admin: library management ──
	{"/api/scan", handlers.ScanHandler, gateAdmin, nil},
	{"/api/library-upload", handlers.LibraryUploadHandler, gateAdmin, nil},
	{"/admin", handlers.AdminHandler, gateAdmin, nil},
	{"/api/files", handlers.FileListHandler, gateAdmin, nil},
	{"/api/upload", handlers.UploadHandler, gateAdmin, nil},
	{"/api/delete", handlers.DeleteFileHandler, gateAdmin, nil},
	{"/api/folders", handlers.CreateFolderHandler, gateAdmin, nil},

	// ── Admin: downloads & workers ──
	{"/api/admin/downloads", handlers.DownloadsListHandler, gateAdmin, nil},
	{"/api/admin/download-toggle/", handlers.DownloadToggleHandler, gateAdmin, nil},
	{"/api/admin/downloads-enable-all", handlers.DownloadsEnableAllHandler, gateAdmin, nil},
	{"/api/workers", handlers.WorkersHandler, gateAdmin, nil},
	{"/api/workers/run", handlers.WorkerRunHandler, gateAdmin, nil},
	{"/api/queue/toggle-pause", handlers.DownloadTogglePauseHandler, gateAdmin, nil},
	{"/api/soulseek/connect", handlers.SoulseekConnectHandler, gateAdmin, nil},

	// ── Admin: users, settings, limits, logs ──
	{"/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handlers.SettingsSetHandler(w, r)
		} else {
			handlers.SettingsGetHandler(w, r)
		}
	}, gateAdmin, nil},
	{"/api/admin/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handlers.AdminListUsers(w, r)
		} else {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}, gateAdmin, nil},
	{"/api/admin/users/create", handlers.AdminCreateUser, gateAdmin, nil},
	{"/api/admin/users/", handlers.AdminUserSubrouter, gateAdmin, nil},
	{"/api/admin/registration", handlers.AdminRegistrationSettingsHandler, gateAdmin, nil},
	{"/api/admin/download-limits", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handlers.AdminGetDownloadLimits(w, r)
		case http.MethodPut:
			handlers.AdminPutDownloadLimits(w, r)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	}, gateAdmin, nil},
	{"/api/admin/playback-failures", handlers.PlaybackFailuresLogHandler, gateAdmin, nil},
	// Debug: view production server logs.
	{"/api/admin/logs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		if r.URL.Query().Get("tracks") != "" {
			w.Write(store.FilterTrackLogs())
		} else {
			w.Write(store.GetLogBuffer())
		}
	}, gateAdmin, nil},

	// ── Metadata review pipeline (admin; methods preserved from adminMethod) ──
	{"/api/metadata-preview", handlers.MetadataPreviewHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/scan", handlers.MetadataScanHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/rescan/", handlers.MetadataRescanHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/rescan-sync/", handlers.MetadataRescanSyncHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/search", handlers.MetadataSearchHandler, gateAdmin, []string{http.MethodGet}},
	{"/api/metadata/update-track/", handlers.MetadataUpdateTrackHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/scan-progress", handlers.MetadataScanProgressHandler, gateAdmin, []string{http.MethodGet}},
	{"/api/metadata/pending", handlers.MetadataPendingHandler, gateAdmin, []string{http.MethodGet}},
	{"/api/metadata/all", handlers.MetadataAllHandler, gateAdmin, []string{http.MethodGet}},
	{"/api/metadata/approve/", handlers.MetadataApproveHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/reject/", handlers.MetadataRejectHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/approve-all", handlers.MetadataApproveAllHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/clear", handlers.MetadataClearHandler, gateAdmin, []string{http.MethodPost}},
	{"/api/metadata/counts", handlers.MetadataCountsHandler, gateAdmin, []string{http.MethodGet}},
	{"/api/metadata/undo/", handlers.MetadataUndoHandler, gateAdmin, []string{http.MethodPost}},

	// ── Needs Review (admin) ──
	{"/api/review/tracks", review.ReviewTracksHandler, gateAdmin, nil},
	{"/api/review/counts", review.ReviewCountsHandler, gateAdmin, nil},
	{"/api/review/mark-ok", review.ReviewMarkOkHandler, gateAdmin, nil},
	{"/api/review/edit-meta", review.ReviewEditMetaHandler, gateAdmin, nil},
	{"/api/review/upload-cover", handlers.UploadCustomCoverHandler, gateAdmin, nil},
	{"/api/review/clear-cover", handlers.ClearCustomCoverHandler, gateAdmin, nil},
	{"/api/review/delete", review.ReviewDeleteHandler, gateAdmin, nil},
	{"/api/review/delete-all", review.ReviewDeleteAllHandler, gateAdmin, nil},
	{"/api/review/bulk-delete", review.ReviewBulkDeleteHandler, gateAdmin, nil},
	{"/api/review/bulk-approve", review.ReviewBulkApproveHandler, gateAdmin, nil},
	{"/api/review/recheck-all", review.ReviewRecheckAllHandler, gateAdmin, nil},
	{"/api/review/enrich", review.ReviewEnrichHandler, gateAdmin, nil},
	{"/api/review/scan-integrity", review.IntegrityScanHandler, gateAdmin, nil},
	{"/api/review/progress", review.ReviewProgressHandler, gateAdmin, nil},
	{"/api/review/log", review.ReviewLogHandler, gateAdmin, nil},

	// ── Cookie bridge for yt-dlp (open: extension has no session) ──
	{"/api/cookies/upload", handlers.CorsAny(handlers.UploadCookiesHandler), gateOpen, nil},
	{"/api/cookies/clear", handlers.ClearCookiesHandler, gateOpen, nil},
	{"/api/cookies/extract", handlers.ExtractCookiesHandler, gateOpen, nil},
	{"/api/cookies/status", handlers.CookiesStatusHandler, gateOpen, nil},
	{"/api/cookies/extension.zip", ExtensionZipHandler, gateOpen, nil},
}

// registerRoutes mounts the route table on mux, applying the method check
// (405 before auth, as adminMethod always did) and then the auth gate.
func registerRoutes(mux *http.ServeMux) {
	for _, rt := range routeTable {
		hf := rt.handler
		switch rt.gate {
		case gateAdmin:
			hf = auth.RequireAdmin(hf)
		case gateUser:
			hf = auth.RequireUser(hf)
		}
		// Method check wraps the gate (405 before 403), matching the old
		// adminMethod ordering the metadata tests pin down.
		if len(rt.methods) > 0 {
			hf = methodOnly(rt.methods, hf)
		}
		mux.Handle(rt.path, hf)
	}
}

func methodOnly(methods []string, next http.HandlerFunc) http.HandlerFunc {
	allowed := ""
	for i, m := range methods {
		if i > 0 {
			allowed += ", "
		}
		allowed += m
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok := false
		for _, m := range methods {
			if r.Method == m {
				ok = true
				break
			}
		}
		if !ok {
			w.Header().Set("Allow", allowed)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next(w, r)
	})
}

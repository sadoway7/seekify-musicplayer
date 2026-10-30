package handlers

import "net/http"

// Desktop-shell seams. nil in the CLI/Docker build (no window to control —
// routes then 404). Wired by the desktop entrypoint, which owns the
// *application.WebviewWindow.
var (
	WindowMinimizeFunc func()
	WindowMaximizeFunc func()
	WindowCloseFunc    func() // hide to tray — the server keeps running
)

func writeWindowAction(w http.ResponseWriter, r *http.Request, fn func()) {
	if fn == nil {
		http.NotFound(w, r) // not the desktop build
		return
	}
	fn()
	writeJSON(w, map[string]bool{"ok": true})
}

// WindowMinimize hides the desktop window to the taskbar.
func WindowMinimize(w http.ResponseWriter, r *http.Request) {
	writeWindowAction(w, r, WindowMinimizeFunc)
}

// WindowMaximize toggles maximize/restore.
func WindowMaximize(w http.ResponseWriter, r *http.Request) {
	writeWindowAction(w, r, WindowMaximizeFunc)
}

// WindowClose hides the window to the tray; playback continues.
func WindowClose(w http.ResponseWriter, r *http.Request) {
	writeWindowAction(w, r, WindowCloseFunc)
}

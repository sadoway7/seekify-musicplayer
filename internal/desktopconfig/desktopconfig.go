// Package desktopconfig holds the Windows desktop build's small config
// helpers: deciding whether the first-run music-library picker is needed,
// writing the chosen value into the appdata .env, and the default music
// folder suggestion. Pure and testable — the dialog itself lives in the
// desktop entrypoint.
package desktopconfig

import (
	"os"
	"path/filepath"
	"strings"
)

// NeedsMusicDir reports whether no music library is configured yet (first
// run). True when MUSIC_DIR is unset, empty, or whitespace.
func NeedsMusicDir(env func(string) string) bool {
	return strings.TrimSpace(env("MUSIC_DIR")) == ""
}

// AppendEnvVar writes key=value into the .env-style file at path, creating
// it if missing and replacing any existing line for the same key so the
// file never accumulates duplicates. Written via temp file + rename so a
// crash can't leave a half-written config.
func AppendEnvVar(path, key, value string) error {
	var lines []string
	if b, err := os.ReadFile(path); err == nil {
		for _, l := range strings.Split(string(b), "\n") {
			if l == "" || strings.SplitN(l, "=", 2)[0] != key {
				lines = append(lines, l)
			}
		}
	}
	lines = append(lines, key+"="+value)
	out := strings.Join(nonEmpty(lines), "\n") + "\n"

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(out), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func nonEmpty(in []string) (out []string) {
	for _, l := range in {
		if l != "" {
			out = append(out, l)
		}
	}
	return out
}

// DefaultMusicDir is the first-run folder-picker suggestion: the user's
// Music folder.
func DefaultMusicDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "Music"
	}
	return filepath.Join(home, "Music")
}

// SyncTools copies every *.exe from srcDir into dstDir when the destination
// copy is missing or older than the source. Used by the desktop build to
// seed %APPDATA%\Seekify\bin from the installer's read-only tools\ dir —
// the writable copy keeps `yt-dlp -U` self-updates working, and a newer
// dst (a self-updated yt-dlp) is never clobbered. Missing srcDir is a
// no-op (playback-only installs).
func SyncTools(srcDir, dstDir string) (int, error) {
	entries, err := os.ReadDir(srcDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return 0, err
	}
	copied := 0
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || filepath.Ext(name) != ".exe" {
			continue
		}
		src := filepath.Join(srcDir, name)
		dst := filepath.Join(dstDir, name)
		if s, err := os.Stat(src); err == nil {
			if d, err := os.Stat(dst); err == nil && !d.ModTime().Before(s.ModTime()) {
				continue // dst current (possibly self-updated) — keep it
			}
		}
		b, err := os.ReadFile(src)
		if err != nil {
			return copied, err
		}
		if err := os.WriteFile(dst, b, 0o755); err != nil {
			return copied, err
		}
		copied++
	}
	return copied, nil
}

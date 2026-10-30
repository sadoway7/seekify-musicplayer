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

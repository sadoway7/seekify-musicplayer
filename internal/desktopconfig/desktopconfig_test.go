package desktopconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNeedsMusicDir(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
		want bool
	}{
		{"unset", map[string]string{}, true},
		{"empty", map[string]string{"MUSIC_DIR": ""}, true},
		{"whitespace", map[string]string{"MUSIC_DIR": "   "}, true},
		{"set — returning user must not see the picker", map[string]string{"MUSIC_DIR": `C:\Users\me\Music`}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := NeedsMusicDir(func(k string) string { return c.env[k] })
			if got != c.want {
				t.Errorf("NeedsMusicDir(%v) = %v, want %v", c.env, got, c.want)
			}
		})
	}
}

func TestAppendEnvVarCreatesFileWithLine(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")

	if err := AppendEnvVar(p, "MUSIC_DIR", `C:\Music`); err != nil {
		t.Fatalf("AppendEnvVar: %v", err)
	}
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(b), "MUSIC_DIR=C:\\Music\n"; got != want {
		t.Errorf("file = %q, want %q", got, want)
	}
}

func TestAppendEnvVarReplacesSameKeyAndKeepsOthers(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, ".env")
	os.WriteFile(p, []byte("PORT=9000\nMUSIC_DIR=C:\\Old\n"), 0o644)

	if err := AppendEnvVar(p, "MUSIC_DIR", `D:\NewMusic`); err != nil {
		t.Fatalf("AppendEnvVar: %v", err)
	}
	b, _ := os.ReadFile(p)
	s := string(b)
	if strings.Contains(s, "C:\\Old") {
		t.Errorf("old value still present: %q", s)
	}
	if !strings.Contains(s, "PORT=9000") {
		t.Errorf("unrelated line lost: %q", s)
	}
	if !strings.Contains(s, "MUSIC_DIR=D:\\NewMusic") {
		t.Errorf("new value missing: %q", s)
	}
	if n := strings.Count(s, "MUSIC_DIR="); n != 1 {
		t.Errorf("MUSIC_DIR appears %d times, want 1: %q", n, s)
	}
}

func TestAppendEnvVarNoPartialFileOnError(t *testing.T) {
	// Target is a directory → error, and no temp litter left behind.
	dir := t.TempDir()
	if err := AppendEnvVar(dir, "MUSIC_DIR", "x"); err == nil {
		t.Error("AppendEnvVar on a directory should fail")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Errorf("temp litter: %v", entries)
	}
}

func TestDefaultMusicDir(t *testing.T) {
	got := DefaultMusicDir()
	home, _ := os.UserHomeDir()
	want := filepath.Join(home, "Music")
	if got != want {
		t.Errorf("DefaultMusicDir = %q, want %q", got, want)
	}
}

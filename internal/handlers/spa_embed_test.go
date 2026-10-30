package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

// The desktop build runs with a working directory that has no SPA files;
// SpaHandler must fall back to the embedded FS (SpaFS) on disk misses.
func TestSpaHandlerServesEmbeddedFallbackWhenDiskMisses(t *testing.T) {
	// Empty cwd: nothing on disk.
	t.Chdir(t.TempDir())
	orig := SpaFS
	t.Cleanup(func() { SpaFS = orig })
	SpaFS = fstest.MapFS{
		"index.html":      &fstest.MapFile{Data: []byte("<html><title>Seekify</title></html>")},
		"js/app.js":       &fstest.MapFile{Data: []byte("console.log(1)")},
		"css/unsupported": &fstest.MapFile{Data: []byte("/* chrome */")},
	}

	for path, want := range map[string]string{
		"/":           "<title>Seekify</title>",
		"/index.html": "<title>Seekify</title>",
		"/js/app.js":  "console.log(1)",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		SpaHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want 200 (body: %s)", path, rec.Code, rec.Body.String())
			continue
		}
		if !strings.Contains(rec.Body.String(), want) {
			t.Errorf("GET %s body missing %q: %s", path, want, rec.Body.String())
		}
	}
}

func TestSpaHandlerMissingWhitelistedAssetFallsBackToIndex(t *testing.T) {
	// Original SPA contract: a whitelisted path with no file on disk serves
	// index.html (200) so client-side routing can render — my restructure
	// briefly broke this; this test pins it.
	t.Chdir(t.TempDir())
	orig := SpaFS
	t.Cleanup(func() { SpaFS = orig })
	SpaFS = fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<title>fallback</title>")}} // js/ absent

	req := httptest.NewRequest(http.MethodGet, "/js/missing.js", nil)
	rec := httptest.NewRecorder()
	SpaHandler(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "fallback") {
		t.Errorf("GET /js/missing.js = %d %s; want 200 index fallback", rec.Code, rec.Body.String())
	}
}

func TestSpaHandlerDiskWinsOverEmbed(t *testing.T) {
	dir := t.TempDir()
	t.Chdir(dir)
	os.WriteFile(dir+"/index.html", []byte("<title>disk wins</title>"), 0o644)
	orig := SpaFS
	t.Cleanup(func() { SpaFS = orig })
	SpaFS = fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<title>embed</title>")}}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	SpaHandler(rec, req)
	if !strings.Contains(rec.Body.String(), "disk wins") {
		t.Errorf("disk copy must win over embed; got: %s", rec.Body.String())
	}
}

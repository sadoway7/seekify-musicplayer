package main

import (
	"archive/zip"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed extension/musicapp-cookies
var extensionFiles embed.FS

// ExtensionZipHandler streams the bundled companion browser extension as a
// downloadable .zip so users can load it unpacked while it is not yet on a
// store. Files are packaged under a single top-level folder.
func ExtensionZipHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sub, err := fs.Sub(extensionFiles, "extension/musicapp-cookies")
	if err != nil {
		http.Error(w, "extension unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="musicapp-cookies-extension.zip"`)
	zw := zip.NewWriter(w)
	err = fs.WalkDir(sub, ".", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		f, err := sub.Open(path)
		if err != nil {
			return err
		}
		defer f.Close()
		if strings.HasSuffix(path, ".py") {
			return nil
		}
		name := "musicapp-cookies/" + strings.ReplaceAll(path, "\\", "/")
		zf, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = io.Copy(zf, f)
		return err
	})
	if err != nil {
		http.Error(w, "could not build extension zip", http.StatusInternalServerError)
		return
	}
	zw.Close()
}

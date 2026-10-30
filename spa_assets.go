package main

import "embed"

// The SPA is embedded in the binary so the desktop build (whose working
// directory is %APPDATA%\Seekify) can serve its UI without the files on
// disk beside it — and so exe-only auto-updates always deliver UI changes.
// Disk files still win when present (Docker/CLI deployments unchanged);
// this FS is the fallback handlers.SpaHandler reaches for on a disk miss.
//
//go:embed index.html manifest.webmanifest favicon-16.png favicon-32.png icon.png icon-192.png apple-touch-icon.png icon-rounded.png record.png css js assets extension
var spaFS embed.FS

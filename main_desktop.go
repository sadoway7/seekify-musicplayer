//go:build desktop

// Seekify desktop (Wails v3) entrypoint. Built only with -tags desktop; the
// normal CLI build never sees this file. Shell only for now — tray, window,
// server wiring and first-run flow arrive with later commits.
package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	app := application.New(application.Options{
		Name: "Seekify",
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "main",
		Title:  "Seekify",
		Hidden: true,
	})

	if err := app.Run(); err != nil {
		panic(err)
	}
}

//go:build !desktop

// Seekify CLI/server entrypoint — the original binary. The desktop build
// (main_desktop.go) excludes this file and wraps the same startup in Wails.
package main

import "log"

func main() {
	_, errCh := runServer(true)
	if err := <-errCh; err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

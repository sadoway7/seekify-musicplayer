package main

import (
	"bufio"
	"log"
	"os"
	"strings"
)

// loadDotEnv reads a .env file and exports its keys into the process
// environment WITHOUT overwriting keys already set, so real env vars win.
// Missing file = silent no-op.
//
// ponytail: hand-rolled ~15 lines instead of pulling godotenv; no new dep.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // missing .env is fine (Docker/CI use real env vars)
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		eq := strings.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		// strip optional surrounding quotes
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') && val[len(val)-1] == val[0] {
			val = val[1 : len(val)-1]
		}
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, val)
		}
	}
	if err := sc.Err(); err != nil {
		log.Printf("warning: reading .env: %v", err)
	}
}

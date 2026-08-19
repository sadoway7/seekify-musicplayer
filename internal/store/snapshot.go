package store

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
)

// SnapshotDB makes a best-effort safety copy of the database (plus its WAL)
// before the DB is opened, so a corrupt or truncated file never means total
// library loss. Copies land in <dir-of-path>/backups/ and are pruned after
// 7 days. Errors are logged and never block boot.
func SnapshotDB(path string) {
	if _, err := os.Stat(path); err != nil {
		return // first boot — nothing to back up
	}
	dir := filepath.Dir(path)
	backupDir := filepath.Join(dir, "backups")
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		log.Printf("[snapshot] create backup dir: %v", err)
		return
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	dst := filepath.Join(backupDir, "music-"+stamp+".db")
	if err := copyFile(dst, path); err != nil {
		log.Printf("[snapshot] copy db: %v", err)
		return
	}
	if walSrc := path + "-wal"; fileExists(walSrc) {
		if err := copyFile(dst+"-wal", walSrc); err != nil {
			log.Printf("[snapshot] copy wal: %v", err)
		}
	}
	pruneSnapshots(backupDir, 7*24*time.Hour)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func copyFile(dst, src string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func pruneSnapshots(backupDir string, maxAge time.Duration) {
	files, err := filepath.Glob(filepath.Join(backupDir, "music-*.db*"))
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-maxAge)
	for _, f := range files {
		info, err := os.Stat(f)
		if err != nil || info.IsDir() || info.ModTime().After(cutoff) {
			continue
		}
		if err := os.Remove(f); err != nil {
			log.Printf("[snapshot] prune %s: %v", f, err)
		}
	}
}

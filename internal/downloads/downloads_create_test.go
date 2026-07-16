package downloads

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"musicapp/internal/models"
	"musicapp/internal/store"
)

func setupCreateJobTestDB(t *testing.T) {
	t.Helper()
	prevDB := store.DB
	prevPath := store.DBPath
	store.InitDB(filepath.Join(t.TempDir(), "test.db"))
	InitDownloadTables()
	store.SetSetting("download_paused", "true")
	store.Mu.Lock()
	prevTracks := store.Tracks
	store.Tracks = map[string]*models.Track{}
	store.Mu.Unlock()
	t.Cleanup(func() {
		store.DB.Close()
		store.DB = prevDB
		store.DBPath = prevPath
		store.Mu.Lock()
		store.Tracks = prevTracks
		store.Mu.Unlock()
	})
}

func TestCreateDownloadJobEnforcesLimitConcurrently(t *testing.T) {
	setupCreateJobTestDB(t)
	store.SetSetting("download_limit_global", "1")

	start := make(chan struct{})
	var successes atomic.Int32
	var limited atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			_, err := CreateDownloadJob("user", "", "Artist", fmt.Sprintf("Track %d", i), "", "", 0, 0, "", "")
			switch {
			case err == nil:
				successes.Add(1)
			case errors.Is(err, ErrDownloadLimit):
				limited.Add(1)
			default:
				t.Errorf("CreateDownloadJob: %v", err)
			}
		}(i)
	}
	close(start)
	wg.Wait()

	if got := successes.Load(); got != 1 {
		t.Fatalf("successful jobs = %d, want 1", got)
	}
	if got := limited.Load(); got != 23 {
		t.Fatalf("limited jobs = %d, want 23", got)
	}
}

func TestDbGetQueuedJobsReturnsOnlyNextJob(t *testing.T) {
	setupCreateJobTestDB(t)
	store.SetSetting("download_limit_global", "0")

	for i := 0; i < 3; i++ {
		if _, err := CreateDownloadJob("user", "", "Artist", fmt.Sprintf("Track %d", i), "", "", 0, 0, "", ""); err != nil {
			t.Fatal(err)
		}
	}

	jobs, err := DbGetQueuedJobs()
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Fatalf("queued jobs = %d, want 1", len(jobs))
	}
}

func TestCreateDownloadJobConstrainsOverrideDir(t *testing.T) {
	setupCreateJobTestDB(t)
	store.SetSetting("download_limit_global", "0")

	root := filepath.Join(t.TempDir(), "music")
	outside := filepath.Join(filepath.Dir(root), "music-backup")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0755); err != nil {
		t.Fatal(err)
	}
	previousMusicDir := store.MusicDir
	store.MusicDir = root
	t.Cleanup(func() { store.MusicDir = previousMusicDir })

	t.Run("blank remains blank", func(t *testing.T) {
		job, err := CreateDownloadJob("user", "", "Artist", "Blank", "", "", 0, 0, "", "")
		if err != nil {
			t.Fatal(err)
		}
		if job.OverrideDir != "" {
			t.Fatalf("overrideDir = %q, want blank", job.OverrideDir)
		}
	})

	t.Run("relative descendant is normalized", func(t *testing.T) {
		job, err := CreateDownloadJob("user", "", "Artist", "Relative", "", "", 0, 0, filepath.Join("Artist", "Album"), "")
		if err != nil {
			t.Fatal(err)
		}
		want := filepath.Join(root, "Artist", "Album")
		if job.OverrideDir != want {
			t.Fatalf("overrideDir = %q, want %q", job.OverrideDir, want)
		}
	})

	for _, tc := range []struct {
		name string
		dir  string
	}{
		{name: "parent traversal", dir: filepath.Join("..", "escape")},
		{name: "absolute sibling", dir: outside},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := CreateDownloadJob("user", "", "Artist", "Rejected "+tc.name, "", "", 0, 0, tc.dir, "")
			if !errors.Is(err, ErrInvalidOverrideDir) {
				t.Fatalf("error = %v, want ErrInvalidOverrideDir", err)
			}
		})
	}

	t.Run("symlink escape", func(t *testing.T) {
		link := filepath.Join(root, "outside-link")
		if err := os.Symlink(outside, link); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		_, err := CreateDownloadJob("user", "", "Artist", "Rejected symlink", "", "", 0, 0, filepath.Join(link, "new-album"), "")
		if !errors.Is(err, ErrInvalidOverrideDir) {
			t.Fatalf("error = %v, want ErrInvalidOverrideDir", err)
		}
	})
}

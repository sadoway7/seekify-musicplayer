package scanner

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSnapshotAudioFilesDetectsSameCountChanges(t *testing.T) {
	dir := t.TempDir()
	original := filepath.Join(dir, "original.mp3")
	if err := os.WriteFile(original, []byte("one"), 0o644); err != nil {
		t.Fatal(err)
	}

	snapshot := func() audioSnapshot {
		return snapshotAudioFilesSkipping(dir, filepath.Join(dir, "shared"))
	}

	before := snapshot()
	if before.count != 1 {
		t.Fatalf("initial count = %d, want 1", before.count)
	}

	renamed := filepath.Join(dir, "renamed.mp3")
	if err := os.Rename(original, renamed); err != nil {
		t.Fatal(err)
	}
	afterRename := snapshot()
	if afterRename.count != before.count {
		t.Fatalf("rename changed count: before=%d after=%d", before.count, afterRename.count)
	}
	if afterRename.signature == before.signature {
		t.Fatal("rename did not change watcher signature")
	}

	if err := os.WriteFile(renamed, []byte("different size"), 0o644); err != nil {
		t.Fatal(err)
	}
	afterWrite := snapshot()
	if afterWrite.count != afterRename.count {
		t.Fatalf("replacement changed count: before=%d after=%d", afterRename.count, afterWrite.count)
	}
	if afterWrite.signature == afterRename.signature {
		t.Fatal("same-path replacement did not change watcher signature")
	}
}

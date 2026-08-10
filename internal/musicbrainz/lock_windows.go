//go:build windows

package musicbrainz

import (
	"os"

	"golang.org/x/sys/windows"
)

// lockRateFileExclusive / unlockRateFile give reserveMusicBrainzSlot a
// cross-process exclusive lock on the rate-limit file, mirroring flock on unix.
//
// ponytail: LockFileEx on a single byte at offset 0 is enough as a mutex — every
// caller locks the same byte, so they serialize. flock locks the whole file, but
// the only consumer (reserveMusicBrainzSlot) needs mutual exclusion on the
// read-check-sleep-write sequence, not whole-file coverage. LockFileEx blocks by
// default (no LOCKFILE_FAIL_IMMEDIATELY), matching flock's blocking behavior. The
// lock is released by the matching UnlockFileEx or when the handle closes.
func lockRateFileExclusive(f *os.File) error {
	var ol windows.Overlapped
	return windows.LockFileEx(windows.Handle(f.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &ol)
}

func unlockRateFile(f *os.File) error {
	var ol windows.Overlapped
	return windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, &ol)
}

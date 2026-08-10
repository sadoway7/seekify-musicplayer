//go:build !windows

package musicbrainz

import (
	"os"
	"syscall"
)

// lockRateFileExclusive / unlockRateFile give reserveMusicBrainzSlot a
// cross-process exclusive lock on the rate-limit file. linux/darwin use flock.
func lockRateFileExclusive(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_EX)
}

func unlockRateFile(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}

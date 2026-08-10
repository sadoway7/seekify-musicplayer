//go:build windows

package downloads

import (
	"os/exec"
	"strconv"
)

// ConfigureCmdProcessTree is a no-op on windows: taskkill /T (see KillProcessTree)
// walks the process tree by parent/child relationship, so the subprocess does not
// need to be created in a new process group. (Unix needs Setpgid for Kill(-pgid).)
func ConfigureCmdProcessTree(cmd *exec.Cmd) {}

// KillProcessTree kills the subprocess and its descendants using the native
// `taskkill /F /T /PID` — the windows equivalent of killing a unix process
// group. /T = terminate the specified process and any child processes it
// started; this is what prevents orphaned ffmpeg/aria2c children from holding
// the stdout pipe open and blocking output reads after a timeout.
func KillProcessTree(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	// ponytail: ignore the error — if the process is already gone, taskkill
	// returns "process not found" and we don't care.
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
}

//go:build !windows

package downloads

import (
	"os/exec"
	"syscall"
)

// ConfigureCmdProcessTree puts the subprocess in its own process group so the
// whole tree (yt-dlp + its ffmpeg/aria2c children) can be killed together on
// timeout. On unix that's Setpgid; on windows it's a no-op (taskkill /T walks
// the parent/child tree, so no process group is needed). Exported because the
// handlers package launches yt-dlp/python subprocesses too.
func ConfigureCmdProcessTree(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// KillProcessTree kills the subprocess and its children. On unix we kill the
// negative process-group id; on windows we shell out to taskkill /T.
func KillProcessTree(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

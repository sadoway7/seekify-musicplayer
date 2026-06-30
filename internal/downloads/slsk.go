package downloads

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"musicapp/internal/store"
)

// slskRawCandidate mirrors ONE candidate object printed by
// `soulseek_dl.py --search-only` on stdout (a JSON array of these).
// bitrate/duration may be null/absent from python, so they are pointers.
type slskRawCandidate struct {
	Index    int    `json:"index"`
	Username string `json:"username"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	Bitrate  *int   `json:"bitrate,omitempty"`
	Duration *int   `json:"duration,omitempty"`
	Format   string `json:"format"`
}

// slskDownloadResult mirrors the single JSON object printed by the script on a
// successful download. We only strictly need Path, but parse the rest for logs.
type slskDownloadResult struct {
	Username string `json:"username"`
	Filename string `json:"filename"`
	Size     int64  `json:"size"`
	Bitrate  *int   `json:"bitrate,omitempty"`
	Duration *int   `json:"duration,omitempty"`
	Format   string `json:"format"`
	Path     string `json:"path"`
}

// findSlsk returns the path to a python3 executable (searching PATH and the
// same well-known install locations FindYtDlp checks), or "" if absent.
// Soulseek is an optional source: callers must treat "" as "disabled".
func findSlsk() string {
	if p, err := exec.LookPath("python3"); err == nil {
		return p
	}
	for _, p := range []string{
		"/opt/homebrew/bin/python3",
		"/usr/local/bin/python3",
		"/usr/bin/python3",
		"/bin/python3",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

// slskScriptPath returns the path to the bundled Soulseek helper script,
// relative to the working directory (and next to the binary as a fallback),
// or "" if it cannot be located.
func slskScriptPath() string {
	candidates := []string{
		filepath.Join("scripts", "soulseek_dl.py"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates,
			filepath.Join(filepath.Dir(exe), "scripts", "soulseek_dl.py"),
			filepath.Join(filepath.Dir(exe), "soulseek_dl.py"),
		)
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// slskShareDir returns the configured Soulseek share directory, defaulting to
// <MusicDir>/shared when unset.
func slskShareDir() string {
	if d := store.GetSetting("slsk_share_dir", ""); d != "" {
		return d
	}
	return filepath.Join(store.MusicDir, "shared")
}

// slskQuery builds the search query passed to the script from the job metadata.
func slskQuery(job *DownloadJob) string {
	if job.Artist != "" && job.Title != "" {
		return fmt.Sprintf("%s - %s", job.Artist, job.Title)
	}
	return job.SearchQuery
}

// searchSlsk runs the script in --search-only mode and returns the raw
// candidates python prints. Respects SearchTimeout (2m).
func searchSlsk(query string) ([]slskRawCandidate, error) {
	python := findSlsk()
	if python == "" {
		return nil, fmt.Errorf("python3 not found")
	}
	script := slskScriptPath()
	if script == "" {
		return nil, fmt.Errorf("soulseek script not found")
	}
	user := store.GetSetting("slsk_username", "")
	pass := store.GetSetting("slsk_password", "")
	if user == "" || pass == "" {
		return nil, fmt.Errorf("soulseek credentials not configured")
	}

	args := []string{
		script, "--search-only",
		"--username", user, "--password", pass,
		"--share", slskShareDir(),
		"--query", query,
		"--out", store.MusicDir,
	}
	if fmtPref := store.GetSetting("slsk_preferred_format", "any"); fmtPref != "" && fmtPref != "any" {
		args = append(args, "--format", fmtPref)
	}
	if minBr := store.GetSettingInt("slsk_min_bitrate", 0); minBr > 0 {
		args = append(args, "--min-bitrate", strconv.Itoa(minBr))
	}

	ctx, cancel := context.WithTimeout(context.Background(), SearchTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, python, args...).Output()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("soulseek search timed out after %v", SearchTimeout)
	}
	trimmed := strings.TrimSpace(string(out))
	var cands []slskRawCandidate
	// The script prints a JSON array (possibly empty) on success even when it
	// exits non-zero for "no results"; only treat non-parseable output as error.
	jerr := json.Unmarshal([]byte(trimmed), &cands)
	if jerr == nil {
		return cands, nil
	}
	if err != nil {
		return nil, fmt.Errorf("soulseek search failed: %s", trimmed)
	}
	return nil, fmt.Errorf("soulseek search: bad JSON: %v", jerr)
}

// slskCandidateUI is the shape the existing YouTube picker modal reads
// (see js/ui.js _showCandidateModal). Soulseek reuses that modal by mapping
// its candidates onto these fields.
type slskCandidateUI struct {
	VideoID  string `json:"videoId"` // strconv.Itoa(index) — UI treats it as an opaque id
	Title    string `json:"title"`   // basename of the Soulseek filename
	Channel  string `json:"channel"` // Soulseek username
	Duration int    `json:"duration"`
	Score    int    `json:"score"`
}

// slskCandidatesToJSON maps raw python candidates onto the picker UI shape and
// returns the JSON array string suitable for DownloadJob.CandidatesJSON.
func slskCandidatesToJSON(cands []slskRawCandidate) (string, error) {
	ui := make([]slskCandidateUI, 0, len(cands))
	for _, c := range cands {
		dur := 0
		if c.Duration != nil {
			dur = *c.Duration
		}
		ui = append(ui, slskCandidateUI{
			VideoID:  strconv.Itoa(c.Index),
			Title:    filepath.Base(c.Filename),
			Channel:  c.Username,
			Duration: dur,
			Score:    50,
		})
	}
	b, err := json.Marshal(ui)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// slskNormalize lowercases s and reduces it to lowercase alphanumeric runs
// joined by single spaces — the comparison key for strong-match tests.
func slskNormalize(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteRune(' ')
		}
	}
	return strings.TrimSpace(strings.Join(strings.Fields(b.String()), " "))
}

// slskStrongMatch reports whether cand's filename contains both the (normalized)
// artist and title. Used to decide auto-download vs surfacing the picker.
func slskStrongMatch(cand slskRawCandidate, artist, title string) bool {
	nf := slskNormalize(cand.Filename)
	na := slskNormalize(artist)
	nt := slskNormalize(title)
	if na != "" && !strings.Contains(nf, na) {
		return false
	}
	if nt != "" && !strings.Contains(nf, nt) {
		return false
	}
	return true
}

// autoPickSlsk returns the index of the first strong-match candidate, preferring
// FLAC over MP3 when both match. Returns (-1, false) when no strong match exists
// (the caller should then surface the manual picker).
func autoPickSlsk(cands []slskRawCandidate, artist, title string) (int, bool) {
	firstFlac := -1
	firstMp3 := -1
	for _, c := range cands {
		if !slskStrongMatch(c, artist, title) {
			continue
		}
		fmtLower := strings.ToLower(c.Format)
		// Fall back to filename extension when python left Format empty.
		if fmtLower == "" {
			if strings.HasSuffix(strings.ToLower(c.Filename), ".flac") {
				fmtLower = "flac"
			} else if strings.HasSuffix(strings.ToLower(c.Filename), ".mp3") {
				fmtLower = "mp3"
			}
		}
		switch fmtLower {
		case "flac":
			if firstFlac == -1 {
				firstFlac = c.Index
			}
		case "mp3":
			if firstMp3 == -1 {
				firstMp3 = c.Index
			}
		}
	}
	if firstFlac != -1 {
		return firstFlac, true
	}
	if firstMp3 != -1 {
		return firstMp3, true
	}
	return -1, false
}

// runSlskDownload execs the script in download mode. When selectedIdx >= 0 the
// chosen candidate is downloaded via --select; otherwise (auto) the script
// picks internally. Returns the absolute path of the downloaded file.
//
// The running *exec.Cmd is registered in ActiveJobs under DownloadMu exactly
// like runDownloadCmd, so the download is cancellable/introspectable.
func runSlskDownload(job *DownloadJob, selectedIdx int) (string, error) {
	python := findSlsk()
	if python == "" {
		return "", fmt.Errorf("python3 not found")
	}
	script := slskScriptPath()
	if script == "" {
		return "", fmt.Errorf("soulseek script not found")
	}
	user := store.GetSetting("slsk_username", "")
	pass := store.GetSetting("slsk_password", "")
	if user == "" || pass == "" {
		return "", fmt.Errorf("soulseek credentials not configured")
	}

	// Use the same destination directory the finalizer expects so the
	// downloaded file lands where autosort/scanner will find it.
	destDir, _ := computeDest(job)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", err
	}

	args := []string{
		script,
		"--username", user, "--password", pass,
		"--share", slskShareDir(),
		"--query", slskQuery(job),
		"--out", destDir,
	}
	if selectedIdx >= 0 {
		args = append(args, "--select", strconv.Itoa(selectedIdx))
	}

	ctx, cancel := context.WithTimeout(context.Background(), DownloadTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, python, args...)

	// Register the cmd so watchdog/cancel can see it (mirrors runDownloadCmd).
	DownloadMu.Lock()
	ActiveJobs[job.ID] = cmd
	ActiveJobTime[job.ID] = time.Now()
	DownloadMu.Unlock()
	defer func() {
		DownloadMu.Lock()
		delete(ActiveJobs, job.ID)
		delete(ActiveJobTime, job.ID)
		DownloadMu.Unlock()
	}()

	out, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("soulseek timed out after %v", DownloadTimeout)
	}
	if err != nil {
		return "", fmt.Errorf("soulseek failed: %s", strings.TrimSpace(string(out)))
	}

	// The script prints exactly one JSON object on stdout describing the
	// downloaded file. Tolerate leading log lines by scanning for the first
	// line that unmarshals cleanly into slskDownloadResult with a non-empty Path.
	var res slskDownloadResult
	decoded := false
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		if json.Unmarshal([]byte(line), &res) == nil {
			decoded = true
			break
		}
	}
	if !decoded || res.Path == "" {
		return "", fmt.Errorf("soulseek reported no downloaded file")
	}
	return res.Path, nil
}

// ProcessSlskSelection is the entry point invoked by the selection handler when
// a user picks a Soulseek candidate from the picker. It runs the download then
// the shared post-download finalization (validate/tag/scan/playlist).
func ProcessSlskSelection(job *DownloadJob, idx int) {
	// Honor the same concurrency cap as the download queue (cap(DownloadSem) == 3)
	// so manual Soulseek picks can't exceed the global download limit.
	DownloadSem <- struct{}{}
	defer func() { <-DownloadSem }()

	job.Status = "downloading"
	job.Source = "soulseek"
	job.ProgressStage = "Downloading via Soulseek"
	DbUpdateJob(job)

	audioFile, err := runSlskDownload(job, idx)
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] soulseek select failed for %q: %v", job.SearchQuery, err)
		return
	}
	finalizeDownload(job, audioFile)
}

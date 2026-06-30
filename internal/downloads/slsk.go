package downloads

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"musicapp/internal/scanner"
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

// SlskShareDir returns the configured Soulseek share directory, defaulting to
// <MusicDir>/shared when unset.
func SlskShareDir() string {
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
		"--share", SlskShareDir(),
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
		"--share", SlskShareDir(),
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

// slskSeedTarget is the minimum number of files the share folder should hold so
// the Soulseek network doesn't throttle a freshly-created account.
const slskSeedTarget = 30

// SeedSlskShare ensures shareDir exists and, if it contains fewer than
// slskSeedTarget files, top-ups it with copies of the smallest audio files from
// the in-memory library until it reaches the target. It is idempotent: when the
// folder already has >= target files nothing is copied. Only the count of files
// copied during THIS call is returned. An error is returned only when shareDir
// cannot be created or listed (partial copy failures just reduce the count).
func SeedSlskShare(shareDir string) (int, error) {
	if err := os.MkdirAll(shareDir, 0755); err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(shareDir)
	if err != nil {
		return 0, err
	}

	existingCount := 0
	preExisting := make(map[string]bool)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		existingCount++
		preExisting[e.Name()] = true
	}
	if existingCount >= slskSeedTarget {
		return 0, nil
	}

	// Gather candidate metadata under the read lock only. File IO (stat/copy)
	// happens after the lock is released so we never block library access.
	type candInfo struct {
		path string
		stem string
		ext  string
	}
	var infos []candInfo
	store.Mu.RLock()
	for _, t := range store.Tracks {
		resolved := scanner.ResolveFilePath(t.FilePath)
		ext := strings.ToLower(filepath.Ext(resolved))
		if _, ok := store.AudioExtensions[ext]; !ok {
			continue
		}
		stem := strings.TrimSpace(t.Artist + " - " + t.Title)
		if stem == "" || stem == "-" {
			stem = strings.TrimSuffix(filepath.Base(resolved), filepath.Ext(resolved))
		}
		infos = append(infos, candInfo{path: resolved, stem: stem, ext: ext})
	}
	store.Mu.RUnlock()

	type sized struct {
		info candInfo
		size int64
	}
	var sized2 []sized
	for _, ci := range infos {
		fi, err := os.Stat(ci.path)
		if err != nil || fi.IsDir() {
			continue
		}
		sized2 = append(sized2, sized{ci, fi.Size()})
	}
	sort.Slice(sized2, func(i, j int) bool { return sized2[i].size < sized2[j].size })

	taken := make(map[string]bool)
	copied := 0
	for _, s := range sized2 {
		if existingCount+copied >= slskSeedTarget {
			break
		}
		base := scanner.SanitizePath(s.info.stem) + s.info.ext
		if preExisting[base] {
			continue
		}
		final := base
		n := 2
		for taken[final] {
			final = scanner.SanitizePath(s.info.stem) + "_" + strconv.Itoa(n) + s.info.ext
			n++
		}
		target := filepath.Join(shareDir, final)
		if err := slskCopyFile(s.info.path, target); err != nil {
			continue
		}
		taken[final] = true
		copied++
	}
	return copied, nil
}

// slskCopyFile copies src to dst, returning an error if either open or the copy
// itself fails. The destination is truncated.
func slskCopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// slskTestResult mirrors the single JSON object printed by soulseek_dl.py --test.
type slskTestResult struct {
	Ok       bool   `json:"ok"`
	Username string `json:"username,omitempty"`
	Error    string `json:"error,omitempty"`
}

// TestSlskConnection runs the script in --test mode. On success returns
// (true, "connected", nil). When the script ran but reported a failure (e.g.
// wrong password / username taken) returns (false, errorMsg, nil). A real exec
// failure (binary missing, context timeout, non-JSON output) returns a non-nil
// error so the caller can surface it distinctly from a login rejection.
func TestSlskConnection(username, password, shareDir string) (bool, string, error) {
	python := findSlsk()
	if python == "" {
		return false, "python3 not found", nil
	}
	script := slskScriptPath()
	if script == "" {
		return false, "soulseek script not found", nil
	}

	args := []string{
		script, "--test",
		"--username", username, "--password", password,
		"--share", shareDir,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	out, runErr := exec.CommandContext(ctx, python, args...).Output()
	if ctx.Err() == context.DeadlineExceeded {
		return false, "", fmt.Errorf("soulseek test timed out after 75s")
	}

	// The script prints exactly one JSON object to stdout. Tolerate leading
	// log lines by scanning for the first line that starts with '{'.
	var res slskTestResult
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
	if decoded {
		if res.Ok {
			return true, "connected", nil
		}
		msg := res.Error
		if msg == "" {
			msg = "login failed"
		}
		return false, msg, nil
	}
	if runErr != nil {
		return false, "", fmt.Errorf("soulseek test failed: %s", strings.TrimSpace(string(out)))
	}
	return false, "", fmt.Errorf("soulseek test: unexpected output: %s", strings.TrimSpace(string(out)))
}

package downloads

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"musicapp/internal/scanner"
	"musicapp/internal/store"
)

// slskLoginMu serializes Soulseek sessions. Each python process logs in
// independently — multiple concurrent logins from one IP get the server to
// reset the connection. Only one Soulseek session at a time.
var slskLoginMu sync.Mutex

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
	return FindBinary("python3",
		"/opt/homebrew/bin/python3",
		"/usr/local/bin/python3",
		"/usr/bin/python3",
		"/bin/python3",
	)
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

// SlskShareDir delegates to store.SlskShareDir (single source of truth).
func SlskShareDir() string {
	return store.SlskShareDir()
}

// slskQuery builds the search query passed to the script from the job metadata.
// Parenthetical qualifiers and common suffixes are stripped because Soulseek
// search is a substring match — "Song (Acapulco Version)" would only match
// files containing "acapulco" in their path, missing the standard album track.
func slskQuery(job *DownloadJob) string {
	artist := strings.TrimSpace(job.Artist)
	title := slskCleanTitle(job.Title)
	if artist != "" && title != "" {
		return fmt.Sprintf("%s - %s", artist, title)
	}
	return job.SearchQuery
}

// slskCleanTitle strips parenthetical content and common suffixes that make
// Soulseek's substring search too narrow.
func slskCleanTitle(title string) string {
	t := strings.TrimSpace(title)
	for {
		start := strings.Index(t, "(")
		end := strings.Index(t, ")")
		if start >= 0 && end > start {
			t = strings.TrimSpace(t[:start] + " " + t[end+1:])
		} else {
			break
		}
	}
	t = strings.TrimSpace(t)
	for _, suffix := range []string{" remaster", " remastered", " remix", " hd", " official audio", " official video", " lyrics"} {
		if idx := strings.Index(strings.ToLower(t), suffix); idx > 0 {
			t = strings.TrimSpace(t[:idx])
		}
	}
	if t == "" {
		return title
	}
	return t
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
		"--username", user,
		"--share", SlskShareDir(),
		"--query", query,
		"--out", filepath.Join(os.TempDir(), "slsk-search"),
	}
	if fmtPref := store.GetSetting("slsk_preferred_format", "any"); fmtPref != "" && fmtPref != "any" {
		args = append(args, "--format", fmtPref)
	}
	if minBr := store.GetSettingInt("slsk_min_bitrate", 0); minBr > 0 {
		args = append(args, "--min-bitrate", strconv.Itoa(minBr))
	}

	ctx, cancel := context.WithTimeout(context.Background(), SearchTimeout)
	defer cancel()
	c := exec.CommandContext(ctx, python, args...)
	// H8: password via env, not argv.
	c.Env = append(os.Environ(), "SLSK_PASSWORD="+pass)
	// Serialize Soulseek logins — concurrent sessions from one IP get reset by the server.
	slskLoginMu.Lock()
	defer slskLoginMu.Unlock()
	out, err := c.Output()
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
	VideoID  string `json:"videoId"`  // strconv.Itoa(index) — UI treats it as an opaque id
	Title    string `json:"title"`    // clean filename for display
	Channel  string `json:"channel"`  // Soulseek username
	Filename string `json:"filename"` // full remote filename (used for direct download)
	Duration int    `json:"duration"`
	Score    int    `json:"score"`
	Format   string `json:"format,omitempty"` // flac, mp3, etc.
	SizeMB   string `json:"sizeMB,omitempty"` // human-readable size
	Bitrate  int    `json:"bitrate,omitempty"`
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
		br := 0
		if c.Bitrate != nil {
			br = *c.Bitrate
		}
		// Normalize Windows backslashes so filepath.Base works correctly
		cleanName := strings.ReplaceAll(c.Filename, "\\", "/")
		ui = append(ui, slskCandidateUI{
			VideoID:  strconv.Itoa(c.Index),
			Title:    filepath.Base(cleanName),
			Channel:  c.Username,
			Filename: c.Filename,
			Duration: dur,
			Score:    50,
			Format:   c.Format,
			SizeMB:   humanBytes(c.Size),
			Bitrate:  br,
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
// artist and title. The title is matched on word boundaries so that a short
// title like "It" does not match inside the word "Hit" in some filename.
// Used to decide auto-download vs surfacing the picker.
func slskStrongMatch(cand slskRawCandidate, artist, title string) bool {
	nf := slskNormalize(cand.Filename)
	na := slskNormalize(artist)
	nt := slskNormalize(title)
	if na != "" && !strings.Contains(nf, na) {
		return false
	}
	if nt != "" {
		// ponytail: regexp.MatchString recompiles per call; fine here since
		// strong-match runs over a small candidate list, not a hot path. Upgrade
		// to a precompiled pool if matching ever shows up in a profile.
		pattern := `(?:^|\s)` + regexp.QuoteMeta(nt) + `(?:\s|$)`
		if ok, _ := regexp.MatchString(pattern, nf); !ok {
			return false
		}
	}
	return true
}

// slskVersionKeywords are terms that distinguish alternate versions of a track.
var slskVersionKeywords = []string{"live", "remix", "acoustic", "demo", "instrumental", "extended", "acapella", "karaoke", "cover", "bootleg", "reworked"}

// slskVersionTags returns the set of version keywords found in s (lowercased).
func slskVersionTags(s string) map[string]bool {
	tags := map[string]bool{}
	l := strings.ToLower(s)
	for _, kw := range slskVersionKeywords {
		if strings.Contains(l, kw) {
			tags[kw] = true
		}
	}
	return tags
}

// slskVersionScore rates how well a candidate's version matches the desired
// version. Higher = better. +2 for each matching tag, -3 for each undesired tag.
func slskVersionScore(filename string, wantTags map[string]bool) int {
	candTags := slskVersionTags(filename)
	score := 0
	for kw := range candTags {
		if wantTags[kw] {
			score += 2
		} else {
			score -= 3
		}
	}
	return score
}

// autoPickSlsk picks the best healthy candidate using progressive relaxation.
// Candidates are already ranked (FLAC first, then highest bitrate). We apply
// quality gates from strict to loose, stopping at the first tier that yields
// a strong match. This avoids being so strict we never pick anything while
// still preferring high-quality, non-junk files.
//
// rawTitle is the user's original (uncleaned) title, used to detect version
// intent (live, remix, etc.). If the title has no version keywords, studio
// versions are preferred. If it does, matching versions are preferred.
//
// Tiers:
//  1. Strong match + FLAC + size > 2MB + duration > 60s (if known)
//  2. Strong match + MP3 ≥ minBitrate + size > 1MB
//  3. Strong match + any format + size > 1MB
//  4. Fall through to picker (return false)
func autoPickSlsk(cands []slskRawCandidate, artist, title string, rawTitle string, minBitrate int) (int, bool) {
	wantTags := slskVersionTags(rawTitle)

	// Filter to strong matches first, compute health metrics.
	type candidate struct {
		idx       int
		size      int64
		bitrate   int
		dur       int
		format    string
		filename  string
		verScore  int
	}
	var strong []candidate
	for _, c := range cands {
		if !slskStrongMatch(c, artist, title) {
			continue
		}
		br := 0
		if c.Bitrate != nil {
			br = *c.Bitrate
		}
		dur := 0
		if c.Duration != nil {
			dur = *c.Duration
		}
		fmt := strings.ToLower(c.Format)
		if fmt == "" {
			if strings.HasSuffix(strings.ToLower(c.Filename), ".flac") {
				fmt = "flac"
			} else if strings.HasSuffix(strings.ToLower(c.Filename), ".mp3") {
				fmt = "mp3"
			}
		}
		strong = append(strong, candidate{
			idx: c.Index, size: c.Size, bitrate: br, dur: dur, format: fmt,
			filename: c.Filename, verScore: slskVersionScore(c.Filename, wantTags),
		})
	}
	if len(strong) == 0 {
		return -1, false
	}

	// Sort strong by version score descending so version-appropriate candidates
	// are tried first within each quality tier.
	sort.SliceStable(strong, func(i, j int) bool {
		return strong[i].verScore > strong[j].verScore
	})

	// Helper: find first candidate in a tier
	findFirst := func(filter func(c candidate) bool) (int, bool) {
		for _, c := range strong {
			if filter(c) {
				return c.idx, true
			}
		}
		return -1, false
	}

	// Tier 1: FLAC, size > 2MB, duration > 60s (if known)
	if idx, ok := findFirst(func(c candidate) bool {
		if c.format != "flac" {
			return false
		}
		if c.size < 2_000_000 {
			return false
		}
		if c.dur > 0 && c.dur < 60 {
			return false
		}
		return true
	}); ok {
		return idx, true
	}

	// Tier 2: MP3 ≥ minBitrate, size > 1MB, duration > 60s (if known)
	if idx, ok := findFirst(func(c candidate) bool {
		if c.format != "mp3" {
			return false
		}
		if minBitrate > 0 && c.bitrate < minBitrate {
			return false
		}
		if c.size < 1_000_000 {
			return false
		}
		if c.dur > 0 && c.dur < 60 {
			return false
		}
		return true
	}); ok {
		return idx, true
	}

	// Tier 3: FLAC of any size (small FLAC might still be a legit short track)
	if idx, ok := findFirst(func(c candidate) bool {
		return c.format == "flac" && c.size > 1_000_000
	}); ok {
		return idx, true
	}

	// Tier 4: Any format, size > 1MB
	if idx, ok := findFirst(func(c candidate) bool {
		return c.size > 1_000_000
	}); ok {
		return idx, true
	}

	return -1, false
}

// runSlskDownload execs the script in download mode. When dlUsername and
// dlFilename are both non-empty the script downloads that exact file directly
// (no re-search); otherwise the script auto-picks internally. Returns the
// absolute path of the downloaded file.
//
// The password is passed via the SLSK_PASSWORD env var (never argv) so it is
// not visible in `ps`.
//
// The running *exec.Cmd is registered in ActiveJobs under DownloadMu exactly
// like runDownloadCmd, so the download is cancellable/introspectable.
func runSlskDownload(job *DownloadJob, dlUsername, dlFilename string) (string, error) {
	return runSlskDownloadArgs(job, dlUsername, dlFilename, "")
}

// runSlskDownloadMulti tries multiple candidates in a single Soulseek session.
// candidatesJSON is a JSON array of {username, filename, size} objects.
func runSlskDownloadMulti(job *DownloadJob, candidatesJSON, displayName string) (string, error) {
	return runSlskDownloadArgs(job, "", "", candidatesJSON)
}

func runSlskDownloadArgs(job *DownloadJob, dlUsername, dlFilename, candidatesJSON string) (string, error) {
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
		"--username", user,
		"--share", SlskShareDir(),
		"--query", slskQuery(job),
		"--out", destDir,
	}
	if dlUsername != "" && dlFilename != "" {
		// Direct download (C6): download the exact file the caller already chose.
		args = append(args, "--dl-username", dlUsername, "--dl-filename", dlFilename)
	} else if candidatesJSON != "" {
		// Multi-candidate mode: try each candidate until one succeeds.
		args = append(args, "--dl-candidates", candidatesJSON)
	}

	ctx, cancel := context.WithTimeout(context.Background(), DownloadTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, python, args...)
	// H8: password via env, not argv.
	cmd.Env = append(os.Environ(), "SLSK_PASSWORD="+pass)
	// C2: process-group so timeout kills aioslsk's children too.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

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

	// H2: snapshot destDir before download so we can clean new files on failure
	preSnap := dirSnapshot(destDir)

	// Serialize Soulseek logins — concurrent sessions from one IP get reset by the server.
	slskLoginMu.Lock()
	defer slskLoginMu.Unlock()

	// Use pipes instead of buffered Output() so we can parse live progress
	// from stderr (PROGRESS:pct:done:total) and update the job in the DB.
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		slskCleanupIncomplete(destDir, preSnap)
		return "", fmt.Errorf("soulseek stdout pipe: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		slskCleanupIncomplete(destDir, preSnap)
		return "", fmt.Errorf("soulseek stderr pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		slskCleanupIncomplete(destDir, preSnap)
		return "", fmt.Errorf("soulseek start failed: %w", err)
	}

	// Read stderr line by line for progress updates. Also accumulate the
	// last few lines so we can include them in error messages.
	progressDone := make(chan struct{})
	var stderrTail []string
	go func() {
		defer close(progressDone)
		scanner := bufio.NewScanner(stderrPipe)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "PROGRESS:") {
				parts := strings.SplitN(strings.TrimPrefix(line, "PROGRESS:"), ":", 3)
				if len(parts) >= 2 {
					stage := parts[0] + "%"
					if len(parts) == 3 {
						done, _ := strconv.ParseInt(parts[1], 10, 64)
						total, _ := strconv.ParseInt(parts[2], 10, 64)
						stage = fmt.Sprintf("%s%% (%s / %s)", parts[0], humanBytes(done), humanBytes(total))
					}
					store.DB.Exec("UPDATE download_jobs SET progress_stage=? WHERE id=?", stage, job.ID)
				}
			} else {
				log.Printf("[slsk-stderr] %s", line)
			}
			stderrTail = append(stderrTail, line)
			if len(stderrTail) > 10 {
				stderrTail = stderrTail[1:]
			}
		}
	}()

	// Collect stdout for the JSON result. Use a goroutine so we can timeout
	// if pipes don't close after the process is killed (orphaned children).
	stdoutCh := make(chan []byte)
	go func() { b, _ := io.ReadAll(stdoutPipe); stdoutCh <- b }()

	// Wait for the process to exit first (could be up to DownloadTimeout).
	// The context handles the hard kill; we only need the stdout escape for
	// orphaned children that keep pipes open AFTER the main process exits.
	waitCh := make(chan error)
	go func() { waitCh <- cmd.Wait() }()

	var waitErr error
	select {
	case waitErr = <-waitCh:
		// Process exited normally (or was killed by context). Now read stdout
		// with a short escape for orphaned children holding pipe write-ends.
	case <-ctx.Done():
		// Context timeout — process should have been killed by CommandContext.
		<-waitCh
		waitErr = ctx.Err()
	}

	var stdoutBytes []byte
	select {
	case stdoutBytes = <-stdoutCh:
	case <-time.After(5 * time.Second):
		// Orphaned child still holds the pipe open. Force kill and read.
		if cmd.Process != nil {
			syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
		}
		stdoutBytes = <-stdoutCh
	}

	// Don't wait forever for the stderr goroutine if it's stuck.
	select {
	case <-progressDone:
	case <-time.After(5 * time.Second):
	}
	out := stdoutBytes

	if ctx.Err() == context.DeadlineExceeded {
		slskCleanupIncomplete(destDir, preSnap)
		return "", fmt.Errorf("soulseek timed out after %v", DownloadTimeout)
	}
	if waitErr != nil {
		slskCleanupIncomplete(destDir, preSnap)
		detail := strings.TrimSpace(string(out))
		if detail == "" && len(stderrTail) > 0 {
			detail = strings.Join(stderrTail, "; ")
		}
		return "", fmt.Errorf("soulseek failed: %s", detail)
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
		slskCleanupIncomplete(destDir, preSnap)
		return "", fmt.Errorf("soulseek reported no downloaded file")
	}
	return res.Path, nil
}

// dirSnapshot returns a set of filenames in dir (best-effort).
func dirSnapshot(dir string) map[string]bool {
	snap := make(map[string]bool)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return snap
	}
	for _, e := range entries {
		snap[e.Name()] = true
	}
	return snap
}

// slskCleanupIncomplete removes leftover partial files aioslsk leaves in destDir.
// Also removes new audio files created during the job window if snapshot is non-empty.
func slskCleanupIncomplete(destDir string, preSnapshot ...map[string]bool) {
	// Always clean known partial-file suffixes
	for _, suffix := range []string{"*.incomplete", "*.partial", "*.part"} {
		matches, _ := filepath.Glob(filepath.Join(destDir, suffix))
		for _, m := range matches {
			os.Remove(m)
		}
	}
	// H2: if a pre-snapshot was provided, remove audio files that weren't there before
	if len(preSnapshot) > 0 && len(preSnapshot[0]) > 0 {
		snap := preSnapshot[0]
		entries, err := os.ReadDir(destDir)
		if err != nil {
			return
		}
		audioExts := map[string]bool{".flac": true, ".mp3": true, ".m4a": true, ".ogg": true, ".opus": true, ".wav": true}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			name := e.Name()
			if snap[name] {
				continue
			}
			ext := filepath.Ext(name)
			if audioExts[ext] {
				os.Remove(filepath.Join(destDir, name))
			}
		}
	}
}

// ProcessSlskSelection is the entry point invoked by the selection handler when
// a user picks a Soulseek candidate from the picker. It resolves the chosen
// candidate (by index) from job.CandidatesJSON so the exact username/filename
// can be downloaded directly (no re-search), then runs the shared post-download
// finalization (validate/tag/scan/playlist).
func ProcessSlskSelection(job *DownloadJob, idx int) {
	// Honor the same concurrency limit as the download queue
	if !tryAcquireSlot() {
		return
	}
	defer releaseSlot()

	// C6: download the exact file the user picked. The picker stores candidates
	// in job.CandidatesJSON (slskCandidateUI shape); resolve the picked index to
	// its username + filename so the python script downloads directly without a
	// non-deterministic re-search that could map the index to a different file.
	var dlUsername, dlFilename string
	var entries []slskCandidateUI
	if json.Unmarshal([]byte(job.CandidatesJSON), &entries) == nil {
		want := strconv.Itoa(idx)
		for _, e := range entries {
			if e.VideoID == want {
				dlUsername = e.Channel
				dlFilename = e.Filename
				break
			}
		}
	}
	if dlUsername == "" || dlFilename == "" {
		job.Status = "failed"
		job.Error = "Selected candidate no longer available"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		log.Printf("[download] soulseek selection %d for %q could not be resolved from stored candidates", idx, job.SearchQuery)
		return
	}

	job.Status = "downloading"
	job.Source = "soulseek"
	job.ProgressStage = "Downloading from " + dlUsername
	DbUpdateJob(job)

	audioFile, err := runSlskDownload(job, dlUsername, dlFilename)
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
		"--username", username,
		"--share", shareDir,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	var stderr strings.Builder
	cmd := exec.CommandContext(ctx, python, args...)
	// H8: password via env, not argv.
	cmd.Env = append(os.Environ(), "SLSK_PASSWORD="+password)
	cmd.Stderr = &stderr
	out, runErr := cmd.Output()
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
	stderrTrim := strings.TrimSpace(stderr.String())
	if decoded {
		if res.Ok {
			return true, "connected", nil
		}
		msg := res.Error
		if msg == "" {
			msg = "login failed"
		}
		// Append a short stderr tail when present so the caller/UI sees the
		// real aioslsk diagnostic rather than a sparse exception message.
		if stderrTrim != "" {
			tail := stderrTrim
			if len(tail) > 300 {
				tail = "..." + tail[len(tail)-300:]
			}
			msg = msg + "\n" + tail
		}
		return false, msg, nil
	}
	// No decodable JSON on stdout — surface stderr (the real traceback) so the
	// user can diagnose import errors, share-scan failures, etc.
	detail := stderrTrim
	if detail == "" {
		detail = strings.TrimSpace(string(out))
	}
	if runErr != nil {
		return false, "", fmt.Errorf("%s", detail)
	}
	return false, "", fmt.Errorf("soulseek test: unexpected output: %s", detail)
}

func humanBytes(b int64) string {
	switch {
	case b >= 1<<20:
		return fmt.Sprintf("%.1fMB", float64(b)/float64(1<<20))
	case b >= 1<<10:
		return fmt.Sprintf("%.1fKB", float64(b)/float64(1<<10))
	default:
		return fmt.Sprintf("%dB", b)
	}
}

# Soulseek Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a YouTube download fails — or the user forces it — fall back to Soulseek via a per-download Python one-shot (`aioslsk`) exec'd exactly like yt-dlp; no daemon. Auto-fallback in `auto` mode, manual force via a global source setting, and a reused manual result-picker for ambiguous matches.

**Architecture:** One new Python script (`scripts/soulseek_dl.py`) exec'd per download; one new Go file (`internal/downloads/slsk.go`) mirroring the yt-dlp exec pattern; a refactor of `ProcessSingleDownload` into a YouTube path + Soulseek path sharing one post-download finalizer; a source-aware branch in the existing selection handler; a Soulseek section in the existing downloads Settings panel; one pip package in the Dockerfile. All config is additive key-value settings (no migration).

**Spec:** `docs/superpowers/specs/2026-06-29-soulseek-fallback-design.md` (authoritative).

**aioslsk API (confirmed via docs this session):**
- `from aioslsk.client import SoulSeekClient` → `client = SoulSeekClient(settings)` → `await client.start()` → `await client.login()` → work → `await client.stop()`.
- Settings: `from aioslsk.settings import Settings, CredentialsSettings, SharesSettings, SharedDirectorySettingEntry` + `from aioslsk.shares.model import DirectoryShareMode` → `Settings(credentials=CredentialsSettings(username=..., password=...), shares=SharesSettings(scan_on_start=True, directories=[SharedDirectorySettingEntry(path, share_mode=DirectoryShareMode.EVERYONE)]))`.
- Search: `from aioslsk.search.model import SearchRequest` → `req = await client.searches.search(query)` → wait → `req.results` (list of `SearchResult`, each `.username` + `.shared_items` where each item has `.filename`).
- Download: `from aioslsk.transfer.model import Transfer` → `transfer = await client.transfers.download(username, filename)`.

**Two micro-uncertainties (confirm at implementation, NOT guessed):**
1. The exact field for bitrate/size on a `SearchResult` / `shared_item` (likely `shared_item.attributes` dict with keys `Bitrate`/`Length`, and `shared_item.size`). Confirm by reading `aioslsk/search/model.py` (or its mock-server tests under the installed package) before finalizing `soulseek_dl.py`'s candidate emit.
2. How to await transfer completion (aioslsk starts downloads in the background). Confirm the canonical await from `aioslsk/transfer/` — likely an `await client.transfers.<await completion>` helper or a `TransferCompletedEvent` (`from aioslsk.events import TransferCompletedEvent`) paired with an `asyncio.Event`. Each is named in Task 2 Step 4.

---

## File map

- `Dockerfile` — add `aioslsk` to the pip line.
- `scripts/soulseek_dl.py` (NEW) — one-shot CLI on aioslsk (search-only / auto / select modes).
- `scripts/soulseek_dl_test.py` (NEW, optional but recommended) — runs the script's pure helpers (normalize/pick) without the network.
- `internal/downloads/slsk.go` (NEW) — `findSlsk`, `runSlskDownload`, `searchSlsk`, `slskCandidatesToJSON`, `ProcessSlskSelection`.
- `internal/downloads/downloads.go` — refactor `ProcessSingleDownload` into dispatcher + `downloadFromYouTube` + shared `computeDest` + `finalizeDownload`; add `getDownloadSource` + auto-fallback wiring.
- `internal/handlers/downloads.go` — source-aware branch in `DownloadJobSelectHandler`.
- `internal/downloads/slsk_test.go` (NEW) — stdout-JSON parsing + fallback + picker characterization.
- `js/ui.js` — Soulseek section inside `_openDownloadsSettings()`.

---

## Task 1: Add `aioslsk` to the Docker image

**Files:** Modify `Dockerfile` (pip install line, ~line 12).

- [ ] **Step 1: Read the current pip line**

Run: `rg -n "pip install" Dockerfile`
Confirm the exact current line (expected: `pip install --no-cache-dir --break-system-packages --upgrade yt-dlp mutagen musicbrainzngs lyriq requests`).

- [ ] **Step 2: Append `aioslsk` to that line**

Edit the line to add ` aioslsk` at the end (one token; `mutagen` is already present as a shared dep). Do not otherwise change the line.

- [ ] **Step 3: Verify locally (if pip available)**

Run: `python3 -m pip install --user aioslsk 2>&1 | tail -5` (or skip if no local python3 — the build is the real check). Confirm it resolves (`mutagen`, `aiofiles`, `async-upnp-client`, `pydantic-settings`, `async-timeout` come with it).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: add aioslsk to image pip install (Soulseek fallback prereq)"
```

---

## Task 2: `scripts/soulseek_dl.py` — the one-shot Soulseek CLI

**Files:** Create `scripts/soulseek_dl.py`.

**Contract (must match the Go side in Task 3 exactly):**
- Args: `--username --password --share <dir> --query "<artist - title>" --out <dir> [--min-bitrate N] [--format flac|mp3|any] [--search-only] [--select <idx>] [--timeout 600]`
- `--search-only`: print a JSON **array** of candidates to stdout (one line), exit 0. Candidate object: `{"index":int,"title":str,"filename":str,"channel":str,"duration":int,"score":0.0,"bitrate":int,"size":int,"videoId":str}` — note `videoId` is set to the **string index** (`str(i)`) so the existing YouTube picker's `data-video-id` + thumbnail logic works (thumbnail 404s and is hidden by the existing `onerror`). `channel` = Soulseek username. `duration` from item length if available else 0. `score` left at 0 (the YT picker shows "Weak" for <30; acceptable, or set 50 to show "Fair").
- Auto / `--select`: print a single JSON object `{"ok":true,"path":"/abs/file","bitrate":int,"size":int}` on success (exit 0); `{"ok":false,"error":"msg"}` on failure.
- Exit codes: 0 ok / 1 no match / 2 download failed / 3 auth or network error. Non-JSON → stderr only.

- [ ] **Step 1: Confirm the two micro-uncertainties**

Before coding the result/pick/download logic, run:
`python3 -c "import aioslsk, os; print(os.path.dirname(aioslsk.__file__))"` then read `<pkg>/search/model.py` (SearchResult + shared item fields) and `<pkg>/transfer/` for the canonical "await transfer completion" pattern (helper or `TransferCompletedEvent`). Record the exact attribute names. (If aioslsk isn't installed locally, do this inside the container or rely on the mock-server test in Step 5 to pin them.)

- [ ] **Step 2: Write the script**

Create `scripts/soulseek_dl.py` (~150 lines). Structure:

```python
#!/usr/bin/env python3
"""One-shot Soulseek downloader built on aioslsk. Exec'd per-download like yt-dlp.

Modes:
  default (auto): search -> auto-pick -> download -> print result JSON
  --search-only  : search -> print candidate array JSON -> exit
  --select <idx> : re-run search -> download candidate[idx] -> print result JSON
All non-JSON diagnostics go to stderr. Exit: 0 ok, 1 no match, 2 dl fail, 3 auth/net.
"""
import argparse
import asyncio
import json
import os
import re
import sys

from aioslsk.client import SoulSeekClient
from aioslsk.settings import (
    Settings, CredentialsSettings, SharesSettings, SharedDirectorySettingEntry,
)
from aioslsk.shares.model import DirectoryShareMode


def normalize(s: str) -> str:
    """Case-fold, strip punctuation/feat./remix for strong-match filtering."""
    s = s.lower()
    s = re.sub(r"\(.*?\)|\[.*?\]", "", s)            # drop (Official Video) etc.
    s = re.sub(r"\bfeat\b.*$", "", s)
    s = re.sub(r"(\b|\d)\s*(flac|mp3|320|192|kbps)\b", "", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def strongly_matches(filename: str, query: str) -> bool:
    """True if the normalized filename contains the normalized query tokens in order-ish."""
    nf = normalize(os.path.basename(filename))
    nq = normalize(query)
    if not nq:
        return False
    return nq in nf or all(tok in nf for tok in nq.split())


def pick_candidate(items, query: str, fmt: str, min_br: int):
    """good-not-best: first strong-matching FLAC>=min_br else first MP3>=min_br, else None.
    `items` is a flat list of {index, filename, bitrate, size, username, duration} dicts."""
    strong = [it for it in items if strongly_matches(it["filename"], query) and it["size"] >= 1024 * 1024]
    if fmt == "flac":
        flacs = [it for it in strong if it["filename"].lower().endswith(".flac") and it["bitrate"] >= min_br]
        if flacs:
            return flacs[0]
    mp3s = [it for it in strong if it["filename"].lower().endswith(".mp3") and it["bitrate"] >= min_br]
    if mp3s:
        return mp3s[0]
    if fmt == "any" and strong:
        return strong[0]
    return None


async def run(args) -> int:
    os.makedirs(args.share, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)
    settings = Settings(
        credentials=CredentialsSettings(username=args.username, password=args.password),
        shares=SharesSettings(
            scan_on_start=True,
            directories=[SharedDirectorySettingEntry(args.share, share_mode=DirectoryShareMode.EVERYONE)],
        ),
    )
    client = SoulSeekClient(settings)
    try:
        await client.start()
        await client.login()
    except Exception as e:  # auth / network
        print(json.dumps({"ok": False, "error": f"auth/network: {e}"}))
        return 3

    try:
        req = await client.searches.search(args.query)
        await asyncio.sleep(8)  # gather results (bounded by the outer timeout)
        flat = flatten_results(req.results)  # see Step 1 for exact field names

        if args.search_only:
            print(json.dumps(flat))
            return 0 if flat else 1

        if args.select is not None:
            chosen = flat[args.select] if 0 <= args.select < len(flat) else None
        else:
            chosen = pick_candidate(flat, args.query, args.format, args.min_bitrate)

        if not chosen:
            print(json.dumps({"ok": False, "error": "no matching Soulseek result"}))
            return 1

        return await download(client, chosen, args)
    finally:
        await client.stop()


def flatten_results(results) -> list:
    """Flatten aioslsk SearchResults into our candidate dicts.
    NOTE: exact attribute names confirmed in Step 1 (bitrate/size/duration)."""
    out = []
    idx = 0
    for r in results:
        username = getattr(r, "username", "")
        for item in getattr(r, "shared_items", []):
            attrs = getattr(item, "attributes", {}) or {}
            out.append({
                "index": idx,
                "title": os.path.basename(getattr(item, "filename", "")),
                "filename": getattr(item, "filename", ""),
                "channel": username,
                "duration": int(attrs.get("Length", attrs.get("Duration", 0)) or 0),
                "score": 50,
                "bitrate": int(attrs.get("Bitrate", 0) or 0),
                "size": int(getattr(item, "size", 0) or 0),
                "videoId": str(idx),
            })
            idx += 1
    return out


async def download(client, chosen, args) -> int:
    try:
        transfer = await client.transfers.download(chosen["channel"], chosen["filename"])
        # Await completion. CONFIRM canonical pattern in Step 1; this is the
        # standard event-based wait:
        await client.transfers.wait_for_completion(transfer)  # <-- confirm exact name
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"download failed: {e}"}))
        return 2

    # aioslsk downloads into its downloads dir under the configured root; locate
    # the completed file by basename and move/copy into args.out.
    basename = os.path.basename(chosen["filename"])
    downloaded = find_downloaded(client, basename)
    if not downloaded:
        print(json.dumps({"ok": False, "error": "completed file not found"}))
        return 2
    dest = os.path.join(args.out, basename)
    os.replace(downloaded, dest)
    print(json.dumps({"ok": True, "path": dest, "bitrate": chosen["bitrate"], "size": chosen["size"]}))
    return 0


def find_downloaded(client, basename: str) -> str:
    # aioslsk default download location is under the client's download root.
    # Confirm the exact field/setting in Step 1; search common roots as a fallback.
    roots = []
    dd = getattr(getattr(client, "settings", None), "transfers", None)
    if dd and getattr(dd, "download_dir", None):
        roots.append(dd.download_dir)
    home = os.path.expanduser("~")
    roots += [os.path.join(home, ".aioslsk", "downloads"), os.path.join(home, "downloads")]
    for root in roots:
        if not root:
            continue
        for dirpath, _, files in os.walk(root):
            if basename in files:
                return os.path.join(dirpath, basename)
    return ""


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--username", required=True)
    p.add_argument("--password", required=True)
    p.add_argument("--share", required=True)
    p.add_argument("--query", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--min-bitrate", type=int, default=192)
    p.add_argument("--format", choices=["flac", "mp3", "any"], default="flac")
    p.add_argument("--search-only", action="store_true")
    p.add_argument("--select", type=int, default=None)
    p.add_argument("--timeout", type=int, default=600)
    args = p.parse_args()

    try:
        rc = asyncio.run(asyncio.wait_for(run(args), timeout=args.timeout))
    except asyncio.TimeoutError:
        print(json.dumps({"ok": False, "error": "timeout"}))
        sys.exit(2)
    sys.exit(rc)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x scripts/soulseek_dl.py`

- [ ] **Step 4: Pin the two micro-uncertainties against the real package**

Run the confirmations from Step 1. Adjust ONLY: (a) the attribute keys in `flatten_results` (`Bitrate`/`Length`), (b) the completion-await call in `download` (replace `wait_for_completion` with the confirmed API — e.g. an `await asyncio.Event` set by a `TransferCompletedEvent` listener). Re-run Step 5 after.

- [ ] **Step 5: Pure-helper unit test (no network)**

Create `scripts/soulseek_dl_test.py`:

```python
import scripts.soulseek_dl as s

def test_strongly_matches():
    assert s.strongly_matches("Artist - Title.flac", "Artist - Title") is True
    assert s.strongly_matches("random remix.mp3", "Artist - Title") is False

def test_pick_prefers_flac():
    items = [
        {"index": 0, "filename": "Artist - Title.mp3", "bitrate": 320, "size": 2_000_000, "username": "u"},
        {"index": 1, "filename": "Artist - Title.flac", "bitrate": 900, "size": 20_000_000, "username": "u"},
    ]
    chosen = s.pick_candidate(items, "Artist - Title", "flac", 192)
    assert chosen["index"] == 1

def test_pick_drops_junk():
    items = [{"index": 0, "filename": "Artist - Title.mp3", "bitrate": 320, "size": 50_000, "username": "u"}]
    assert s.pick_candidate(items, "Artist - Title", "mp3", 192) is None

if __name__ == "__main__":
    test_strongly_matches(); test_pick_prefers_flac(); test_pick_drops_junk()
    print("ok")
```

Run: `python3 scripts/soulseek_dl_test.py` → prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add scripts/soulseek_dl.py scripts/soulseek_dl_test.py
git commit -m "feat(downloads): add aioslsk one-shot soulseek_dl.py (search/auto/select modes)"
```

---

## Task 3: `internal/downloads/slsk.go` — Go side of the Soulseek exec

**Files:** Create `internal/downloads/slsk.go`.

- [ ] **Step 1: Write the file**

```go
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

// slskResult mirrors the stdout JSON from `soulseek_dl.py` download modes.
type slskResult struct {
	OK      bool   `json:"ok"`
	Path    string `json:"path"`
	Bitrate int    `json:"bitrate"`
	Size    int    `json:"size"`
	Error   string `json:"error"`
}

// slskCandidate mirrors a --search-only candidate and the fields the YouTube
// picker UI reads (videoId == string index; channel == Soulseek username).
type slskCandidate struct {
	Index    int    `json:"index"`
	Title    string `json:"title"`
	Filename string `json:"filename"`
	Channel  string `json:"channel"`
	Duration int    `json:"duration"`
	Score    int    `json:"score"`
	Bitrate  int    `json:"bitrate"`
	Size     int    `json:"size"`
	VideoID  string `json:"videoId"`
}

// findSlsk returns the script path if python3 + scripts/soulseek_dl.py are
// available, else "" (graceful absence — Soulseek is skipped).
func findSlsk() string {
	if _, err := exec.LookPath("python3"); err != nil {
		return ""
	}
	candidates := []string{
		filepath.Join("scripts", "soulseek_dl.py"),
		filepath.Join(filepath.Dir(getExeDir()), "scripts", "soulseek_dl.py"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

// getExeDir is the directory of the running binary (for locating vendored scripts).
func getExeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

// runSlskDownload execs the script in download mode (auto when selectedIdx < 0,
// --select <idx> otherwise). On success it returns the downloaded file path.
// The caller is responsible for moving/tagging via finalizeDownload.
func runSlskDownload(job *DownloadJob, selectedIdx int) (string, error) {
	script := findSlsk()
	if script == "" {
		return "", fmt.Errorf("soulseek script not found (python3 or scripts/soulseek_dl.py missing)")
	}
	user := store.GetSetting("slsk_username", "")
	pass := store.GetSetting("slsk_password", "")
	share := slskShareDir()
	if user == "" || pass == "" {
		return "", fmt.Errorf("soulseek credentials not configured")
	}

	destDir, safeTitle := computeDest(job)
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", err
	}
	args := []string{
		script,
		"--username", user, "--password", pass,
		"--share", share,
		"--query", slskQuery(job),
		"--out", destDir,
		"--min-bitrate", strconv.Itoa(store.GetSettingInt("slsk_min_bitrate", 192)),
		"--format", store.GetSetting("slsk_preferred_format", "flac"),
		"--timeout", strconv.Itoa(int(DownloadTimeout / time.Second)),
	}
	if selectedIdx >= 0 {
		args = append(args, "--select", strconv.Itoa(selectedIdx))
	}

	ctx, cancel := context.WithTimeout(context.Background(), DownloadTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "python3", args...)
	ActiveJobsMu(job.ID, cmd) // see Step 2 note
	out, err := cmd.Output()
	ActiveJobsDelete(job.ID)
	if ctx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("soulseek timed out after %v", DownloadTimeout)
	}
	if err != nil {
		return "", fmt.Errorf("soulseek failed: %s", strings.TrimSpace(string(out)))
	}

	var res slskResult
	// the script prints exactly one JSON object on stdout
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if json.Unmarshal([]byte(line), &res) == nil && res.OK {
			break
		}
	}
	if !res.OK {
		if res.Error == "" {
			res.Error = "soulseek reported failure"
		}
		return "", fmt.Errorf("%s", res.Error)
	}
	_ = safeTitle
	return res.Path, nil
}

// searchSlsk runs --search-only and returns candidates for the manual picker.
func searchSlsk(job *DownloadJob) ([]slskCandidate, error) {
	script := findSlsk()
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
		"--query", slskQuery(job),
		"--out", store.MusicDir,
	}
	ctx, cancel := context.WithTimeout(context.Background(), SearchTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "python3", args...).Output()
	if err != nil {
		return nil, fmt.Errorf("soulseek search failed: %s", strings.TrimSpace(string(out)))
	}
	var cands []slskCandidate
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(out))), &cands); err != nil {
		return nil, fmt.Errorf("soulseek search: bad JSON: %v", err)
	}
	return cands, nil
}

// ProcessSlskSelection is invoked by the selection handler when a user picks a
// Soulseek candidate (idx). It runs --select and finalizes.
func ProcessSlskSelection(job *DownloadJob, idx int) {
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
	destDir, safeTitle := computeDest(job)
	finalizeDownload(job, audioFile, destDir, safeTitle)
}

func slskShareDir() string {
	d := store.GetSetting("slsk_share_dir", "")
	if d == "" {
		d = filepath.Join(store.MusicDir, "shared")
	}
	return d
}

func slskQuery(job *DownloadJob) string {
	if job.Artist != "" && job.Title != "" {
		return fmt.Sprintf("%s - %s", job.Artist, job.Title)
	}
	return job.SearchQuery
}
```

- [ ] **Step 2: Resolve the ActiveJobs helpers + imports**

Run: `rg -n "ActiveJobs\b|func ActiveJob" internal/downloads/downloads.go` to find the exact add/delete helpers for tracking running cmds (used by `runDownloadCmd`). Replace the `ActiveJobsMu`/`ActiveJobsDelete` placeholders in `runSlskDownload` with the real helper calls (same ones `runDownloadCmd` uses), so Soulseek downloads are cancellable/visible like yt-dlp ones. If no typed helper exists, mirror the map manipulation `runDownloadCmd` does under `DownloadMu`.

- [ ] **Step 3: Build + vet**

Run: `go build -mod=vendor ./...` and `go vet ./...`. (Note: this file references `computeDest` and `finalizeDownload` which Task 4 extracts — expect a compile error until Task 4 lands. That's fine; this task's commit can be squashed with Task 4, OR temporarily stub `computeDest`/`finalizeDownload` are done first. **Recommended order: do Task 4 before this Step 3's green build.** Adjust task ordering accordingly — Task 4 is the prerequisite.)

> **Ordering note:** Implement Task 4 (the refactor that defines `computeDest` + `finalizeDownload`) BEFORE attempting the green build in Task 3 Step 3. The two new tasks compile only together.

- [ ] **Step 4: Commit (after Task 4 builds clean)**

```bash
git add internal/downloads/slsk.go
git commit -m "feat(downloads): add Go Soulseek exec layer (findSlsk/runSlskDownload/searchSlsk)"
```

---

## Task 4: Refactor `ProcessSingleDownload` into dispatcher + shared finalizer + fallback

**Files:** Modify `internal/downloads/downloads.go`.

- [ ] **Step 1: Add the source-decision helper**

Add near the top of `ProcessSingleDownload`'s file:

```go
// getDownloadSource returns the configured global source mode.
func getDownloadSource() string {
	s := store.GetSetting("download_source", "auto")
	switch s {
	case "youtube", "soulseek", "auto":
		return s
	default:
		return "auto"
	}
}

// computeDest returns the destination directory + safe filename for a job
// (extracted verbatim from the former ProcessSingleDownload body).
func computeDest(job *DownloadJob) (destDir, safeTitle string) {
	destDir = store.MusicDir
	organise := store.GetSettingBool("download_organise_by_artist", true)
	albumSubdir := store.GetSetting("download_album_subdir", "Albums")
	if albumSubdir == "" {
		albumSubdir = "Albums"
	}
	if job.OverrideDir != "" {
		destDir = job.OverrideDir
	} else if job.Album != "" && job.Artist != "" {
		destDir = filepath.Join(store.MusicDir, SanitizeFilename(job.Artist), SanitizeFilename(job.Album))
	} else if job.Artist != "" && organise {
		destDir = filepath.Join(store.MusicDir, SanitizeFilename(job.Artist))
	}
	safeTitle = SanitizeFilename(job.Title)
	if safeTitle == "" {
		safeTitle = SanitizeFilename(job.SearchQuery)
	}
	if safeTitle == "" {
		safeTitle = "track"
	}
	return destDir, safeTitle
}
```

- [ ] **Step 2: Extract `finalizeDownload` from the tail**

Extract the body from `audioFile := FindDownloadedFile(destDir, safeTitle)` (current line ~722) through the end of `ProcessSingleDownload` (current line ~811) into:

```go
// finalizeDownload owns locate → validate → bitrate gate → tag → complete → scan.
// Shared by the YouTube and Soulseek download paths (DRY).
func finalizeDownload(job *DownloadJob, destDir, safeTitle string) {
	audioFile := FindDownloadedFile(destDir, safeTitle)
	if audioFile == "" {
		job.Status = "failed"
		job.Error = "Download completed but file not found"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	job.ProgressStage = "Validating audio"
	DbUpdateJob(job)

	if ok, reason := ValidateAudioIntegrity(audioFile); !ok {
		os.Remove(audioFile)
		job.Status = "failed"
		job.Error = fmt.Sprintf("Audio validation failed: %s", reason)
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	quality := ProbeAudioQuality(audioFile)
	minBr := store.GetSettingInt("download_min_bitrate", 0)
	if minBr > 0 && quality != "" {
		br := ExtractBitrateFromQuality(quality)
		if br > 0 && br < minBr {
			os.Remove(audioFile)
			job.Status = "failed"
			job.Error = fmt.Sprintf("Bitrate too low: %dkbps < %dkbps minimum", br, minBr)
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			log.Printf("[download] Rejected %q: bitrate %dkbps below minimum %dkbps", job.SearchQuery, br, minBr)
			return
		}
	}

	job.ProgressStage = "Tagging file"
	DbUpdateJob(job)
	log.Printf("[download] Tagging %s - %s (album=%q)", job.Artist, job.Title, job.Album)
	if job.Pipeline == "v2" && EnrichFunc != nil {
		job.ProgressStage = "Enriching metadata"
		DbUpdateJob(job)
		EnrichFunc(audioFile, job)
	} else {
		TagAudioFile(audioFile, job.Artist, job.Title, job.Album, job.TrackNumber, job.TrackTotal)
	}
	quality = ProbeAudioQuality(audioFile)

	job.Status = "completed"
	job.AudioQuality = quality
	job.FilePath = audioFile
	job.ProgressStage = "Done"
	job.CompletedAt = time.Now().Format(time.RFC3339)
	DbUpdateJob(job)
	log.Printf("[download] Completed: %s - %s -> %s (%s)", job.Artist, job.Title, audioFile, quality)

	go func() {
		time.Sleep(1 * time.Second)
		scanner.ScanSingleFile(audioFile)
		if job.AlbumMBID != "" {
			store.Mu.RLock()
			var albumID string
			for _, tr := range store.Tracks {
				if scanner.ResolveFilePath(tr.FilePath) == audioFile {
					albumID = tr.AlbumID
					break
				}
			}
			store.Mu.RUnlock()
			if albumID != "" {
				musicbrainz.FetchAndCacheCoverByMBID(albumID, job.AlbumMBID)
			}
		}
		if job.PlaylistID != "" && job.Artist != "" && job.Title != "" {
			store.Mu.RLock()
			for _, tr := range store.Tracks {
				if strings.EqualFold(tr.Artist, job.Artist) && strings.EqualFold(tr.Title, job.Title) {
					store.DbAddTrackToPlaylist(job.PlaylistID, tr.ID)
					log.Printf("[download] Added %s - %s to playlist %s", tr.Artist, tr.Title, job.PlaylistID)
					break
				}
			}
			store.Mu.RUnlock()
		}
	}()
}
```

This is a verbatim move of the existing tail (logic unchanged — behavior-preserving refactor per AGENTS.md). `minBr` is now read here (was at old line 667); remove the now-dead old read at 667 if it becomes unused.

- [ ] **Step 3: Rewrite `ProcessSingleDownload` as the dispatcher**

Replace the entire current `ProcessSingleDownload` (lines 545-811) with:

```go
// ProcessSingleDownload routes a job to the configured source and handles
// auto-fallback from YouTube to Soulseek on failure.
func ProcessSingleDownload(job *DownloadJob) {
	source := getDownloadSource()
	if source == "soulseek" {
		downloadFromSoulseek(job, -1) // -1 = auto-pick
		return
	}
	// "youtube" or "auto"
	ytOK := downloadFromYouTube(job)
	if ytOK || source == "youtube" {
		return
	}
	// auto-mode fallback: YouTube failed; try Soulseek on the same job.
	if !store.GetSettingBool("slsk_enabled", false) || findSlsk() == "" {
		return
	}
	log.Printf("[download] YouTube failed for %q, falling back to Soulseek", job.SearchQuery)
	job.Source = "soulseek"
	job.Error = ""
	job.ProgressStage = ""
	downloadFromSoulseek(job, -1)
}

// downloadFromYouTube runs the existing YouTube flow and returns true if the
// job reached a terminal non-failed state (completed or needs_selection).
// On any failed exit it leaves job.Status="failed" and returns false.
func downloadFromYouTube(job *DownloadJob) bool {
	// === entire former ProcessSingleDownload body from line 545 through the
	//     point just BEFORE `audioFile := FindDownloadedFile(...)` (old ~722) ===
	// PASTE that body here verbatim, with these adjustments:
	//   * replace the destDir/safeTitle computation block (old 603-633) with:
	//         destDir, safeTitle := computeDest(job)
	//         os.MkdirAll(destDir, 0755)
	//   * replace the tail (old 722-811, locate→validate→tag→complete→scan)
	//     with:  finalizeDownload(job, destDir, safeTitle); return true
	//   * every existing `job.Status="failed"; ...; return` site: `return false`
	//   * the `job.Status="needs_selection"; ...; return` site: `return true`
	//   * the `job.Status="completed"` is now set inside finalizeDownload
	// (See Step 4 for the verification of every failed-exit return.)
	... // body as described
}

// downloadFromSoulseek runs the Soulseek flow. selectedIdx < 0 = auto-pick;
// >= 0 = user-selected candidate (from the picker).
func downloadFromSoulseek(job *DownloadJob, selectedIdx int) {
	script := findSlsk()
	if script == "" {
		job.Status = "failed"
		job.Error = "Soulseek unavailable (python3 or script missing)"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}
	if store.GetSetting("slsk_username", "") == "" || store.GetSetting("slsk_password", "") == "" {
		job.Status = "failed"
		job.Error = "Soulseek credentials not configured"
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}

	// Manual picker: only when auto-picking (no idx yet) AND no strong match.
	if selectedIdx < 0 {
		job.Status = "searching"
		job.Source = "soulseek"
		job.ProgressStage = "Searching Soulseek"
		DbUpdateJob(job)
		cands, serr := searchSlsk(job)
		if serr != nil {
			job.Status = "failed"
			job.Error = "Soulseek search failed: " + serr.Error()
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			return
		}
		if chosen := autoPickSlsk(cands, job); chosen != nil {
			selectedIdx = chosen.Index // strong match found -> download it
		} else if len(cands) > 0 {
			// ambiguous -> surface the existing picker
			job.CandidatesJSON = slskCandidatesToJSON(cands)
			job.Status = "needs_selection"
			job.ProgressStage = "Awaiting user selection"
			DbUpdateJob(job)
			return
		} else {
			job.Status = "failed"
			job.Error = "No Soulseek results"
			job.CompletedAt = time.Now().Format(time.RFC3339)
			DbUpdateJob(job)
			return
		}
	}

	job.Status = "downloading"
	job.Source = "soulseek"
	job.ProgressStage = "Downloading via Soulseek"
	DbUpdateJob(job)
	audioFile, err := runSlskDownload(job, selectedIdx)
	if err != nil {
		job.Status = "failed"
		job.Error = err.Error()
		job.CompletedAt = time.Now().Format(time.RFC3339)
		DbUpdateJob(job)
		return
	}
	destDir, safeTitle := computeDest(job)
	finalizeDownload(job, audioFile, destDir, safeTitle)
}
```

- [ ] **Step 4: Add the small picker helpers**

Add (same file or slsk.go):

```go
// autoPickSlsk applies the strong-match filter; returns the chosen candidate or nil.
// Mirrors soulseek_dl.py pick_candidate: first FLAC>=min_br else first MP3>=min_br.
func autoPickSlsk(cands []slskCandidate, job *DownloadJob) *slskCandidate {
	minBr := store.GetSettingInt("slsk_min_bitrate", 192)
	fmtPref := store.GetSetting("slsk_preferred_format", "flac")
	query := slskQuery(job)
	var firstFlac, firstMp3 *slskCandidate
	for i := range cands {
		c := &cands[i]
		if c.Size < 1024*1024 {
			continue
		}
		if !slskStrongMatch(c.Filename, query) {
			continue
		}
		lo := strings.ToLower(c.Filename)
		if strings.HasSuffix(lo, ".flac") && c.Bitrate >= minBr && firstFlac == nil {
			firstFlac = c
		} else if strings.HasSuffix(lo, ".mp3") && c.Bitrate >= minBr && firstMp3 == nil {
			firstMp3 = c
		}
	}
	if fmtPref == "flac" && firstFlac != nil {
		return firstFlac
	}
	if firstMp3 != nil {
		return firstMp3
	}
	if fmtPref == "any" {
		if firstFlac != nil {
			return firstFlac
		}
		return firstMp3 // may be nil
	}
	return firstFlac // may be nil
}

func slskStrongMatch(filename, query string) bool {
	nf := slskNormalize(filename)
	nq := slskNormalize(query)
	if nq == "" {
		return false
	}
	if strings.Contains(nf, nq) {
		return true
	}
	for _, tok := range strings.Fields(nq) {
		if !strings.Contains(nf, tok) {
			return false
		}
	}
	return true
}

func slskNormalize(s string) string {
	s = strings.ToLower(s)
	// strip parentheticals
	s = stripParens(s)
	s = strings.Split(s, " feat")[0]
	for _, w := range []string{" flac", " mp3", " 320", " 192", " kbps"} {
		s = strings.ReplaceAll(s, w, " ")
	}
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == ' ' {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	return strings.TrimSpace(strings.Join(strings.Fields(b.String()), " "))
}

func stripParens(s string) string {
	for {
		i := strings.IndexAny(s, "([")
		if i < 0 {
			return s
		}
		close := byte(')')
		if s[i] == '[' {
			close = ']'
		}
		j := strings.IndexByte(s[i:], close)
		if j < 0 {
			return s
		}
		s = s[:i] + s[i+j+1:]
	}
}

// slskCandidatesToJSON serializes candidates for job.CandidatesJSON.
func slskCandidatesToJSON(cands []slskCandidate) string {
	b, _ := json.Marshal(cands)
	return string(b)
}
```

(Add `encoding/json` to imports if not present.)

- [ ] **Step 5: Build + vet + existing tests**

Run: `go build -mod=vendor ./...`, `go vet ./...`, `go test ./...` → green. The existing YouTube flow is byte-for-byte the same body, just relocated, so behavior is preserved.

- [ ] **Step 6: Commit (combine with Task 3's file)**

```bash
git add internal/downloads/downloads.go internal/downloads/slsk.go
git commit -m "feat(downloads): source dispatcher + YouTube/Soulseek paths sharing finalizeDownload"
```

---

## Task 5: Source-aware selection handler branch

**Why:** The existing `DownloadJobSelectHandler` (`internal/handlers/downloads.go:337`) reads `{videoId}` and re-queues for YouTube. Soulseek selects by **index** and must call `ProcessSlskSelection`.

- [ ] **Step 1: Branch on `job.Source` in the handler**

In `internal/handlers/downloads.go`, after the job load + `needs_selection` check (line ~354) and BEFORE the YouTube `videoId` handling, insert:

```go
	if job.Source == "soulseek" {
		var req struct {
			VideoID string `json:"videoId"` // the UI sends the string index here
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.VideoID == "" {
			http.Error(w, `{"error":"missing selection"}`, http.StatusBadRequest)
			return
		}
		idx, err := strconv.Atoi(req.VideoID)
		if err != nil || idx < 0 {
			http.Error(w, `{"error":"bad index"}`, http.StatusBadRequest)
			return
		}
		job.CandidatesJSON = ""
		job.ProgressStage = ""
		job.Error = ""
		job.Status = "queued"
		downloads.DbUpdateJob(job)
		go func() {
			downloadMu := make(chan struct{}, 1) // no-op; ProcessSlskSelection owns its own lifecycle
			_ = downloadMu
			downloads.ProcessSlskSelection(job, idx)
		}()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(job)
		return
	}
```

Simplify the goroutine to just `go downloads.ProcessSlskSelection(job, idx)` — the channel lines above are illustrative; remove them. Add `"strconv"` to the file's imports if missing.

- [ ] **Step 2: Build + vet**

Run: `go build -mod=vendor ./...` and `go vet ./...`.

- [ ] **Step 3: Commit**

```bash
git add internal/handlers/downloads.go
git commit -m "feat(downloads): route soulseek picker selection to ProcessSlskSelection"
```

---

## Task 6: UI — Soulseek section in the downloads Settings panel

**Files:** Modify `js/ui.js` inside `_openDownloadsSettings()`.

- [ ] **Step 1: Locate the panel builder + the settings save pattern**

Run: `rg -n "_openDownloadsSettings|Api.setSetting|setSetting\(" js/ui.js js/api.js`. Note the panel's section HTML pattern (other sections like cookies/finder are templates) and the exact setSetting call signature.

- [ ] **Step 2: Add a Soulseek section to the panel**

Inside `_openDownloadsSettings()`'s HTML string (append a new section block before the close), add (using the existing `.settings-section`/`.settings-input` classes seen elsewhere in the file):

```js
      + '<div class="settings-section">'
      + '<div class="settings-section-title" data-collapse>' + Icons.settings() + ' Soulseek (Fallback)' + Icons.chevronDown() + '</div>'
      + '<div class="settings-section-body">'
      + '<label class="settings-row"><input type="checkbox" id="set-slsk-enabled"> Enable Soulseek fallback</label>'
      + '<div class="settings-row"><span>Source mode</span>'
      + '<select id="set-download-source" class="settings-input">'
      + '<option value="auto">Auto (YouTube &rarr; Soulseek)</option>'
      + '<option value="youtube">YouTube only</option>'
      + '<option value="soulseek">Soulseek only</option>'
      + '</select></div>'
      + '<div class="settings-row"><span>Username</span><input type="text" id="set-slsk-username" class="settings-input"></div>'
      + '<div class="settings-row"><span>Password</span><input type="password" id="set-slsk-password" class="settings-input"></div>'
      + '<div class="settings-row"><span>Share folder</span><input type="text" id="set-slsk-share" class="settings-input" placeholder="music/shared"></div>'
      + '<div class="settings-row"><span>Preferred format</span>'
      + '<select id="set-slsk-format" class="settings-input">'
      + '<option value="flac">FLAC</option><option value="mp3">MP3</option><option value="any">Any</option>'
      + '</select></div>'
      + '<div class="settings-row"><span>Min bitrate (kbps)</span><input type="number" id="set-slsk-min-br" class="settings-input" min="0"></div>'
      + '<button class="settings-btn settings-btn-primary" id="btn-save-slsk">' + Icons.check() + '<span>Save</span></button>'
      + '<div class="settings-hint">Share folder is created if missing. Populate it with a few albums — Soulseek throttles accounts that share nothing.</div>'
      + '</div>'
      + '</div>'
```

- [ ] **Step 3: Populate fields on open + wire Save**

In the same function, after rendering, populate from current settings (use the existing settings getter, e.g. `Store.getSetting(key)` / the same pattern the other sections use — confirm in Step 1):

```js
    const set = (id, v) => { const el = panel.querySelector('#'+id); if (el) el.value = v; };
    const chk = (id, v) => { const el = panel.querySelector('#'+id); if (el) el.checked = !!v; };
    chk('set-slsk-enabled', Store.getSetting('slsk_enabled') === 'true');
    set('set-download-source', Store.getSetting('download_source') || 'auto');
    set('set-slsk-username', Store.getSetting('slsk_username') || '');
    set('set-slsk-password', Store.getSetting('slsk_password') || '');
    set('set-slsk-share', Store.getSetting('slsk_share_dir') || '');
    set('set-slsk-format', Store.getSetting('slsk_preferred_format') || 'flac');
    set('set-slsk-min-br', Store.getSetting('slsk_min_bitrate') || '192');

    const saveSlsk = panel.querySelector('#btn-save-slsk');
    if (saveSlsk) saveSlsk.addEventListener('click', async () => {
      saveSlsk.disabled = true;
      const share = panel.querySelector('#set-slsk-share').value.trim() || 'music/shared';
      await Promise.all([
        Api.setSetting('slsk_enabled', panel.querySelector('#set-slsk-enabled').checked ? 'true' : 'false'),
        Api.setSetting('download_source', panel.querySelector('#set-download-source').value),
        Api.setSetting('slsk_username', panel.querySelector('#set-slsk-username').value),
        Api.setSetting('slsk_password', panel.querySelector('#set-slsk-password').value),
        Api.setSetting('slsk_share_dir', share),
        Api.setSetting('slsk_preferred_format', panel.querySelector('#set-slsk-format').value),
        Api.setSetting('slsk_min_bitrate', panel.querySelector('#set-slsk-min-br').value || '192'),
      ]);
      Store._settings = Store._settings || {};
      this._showToast('Soulseek settings saved');
      saveSlsk.disabled = false;
    });
```

(Confirm the exact `Api.setSetting(key, value)` + `Store.getSetting(key)` names via the Step 1 grep; rename if the codebase uses different names.)

- [ ] **Step 4: Manual verify (no JS build step)**

`./server` → open the finder/downloads tab → click Settings (now on the Retry All / Clear History row from the prior audit work) → expand "Soulseek (Fallback)" → fill dummy values → Save → reload; values persist. Toggle Source mode and confirm it round-trips.

- [ ] **Step 5: Commit**

```bash
git add js/ui.js
git commit -m "ui: add Soulseek settings section to the downloads settings panel"
```

---

## Task 7: Tests for the Go Soulseek layer + fallback

**Files:** Create `internal/downloads/slsk_test.go`.

- [ ] **Step 1: Stdout-JSON parsing characterization**

```go
package downloads

import "testing"

func TestSlskResultParse(t *testing.T) {
	cases := []struct{ out string; ok bool; path string }{
		{`{"ok":true,"path":"/x/y.flac","bitrate":900,"size":100}`, true, "/x/y.flac"},
		{`{"ok":false,"error":"no match"}`, false, ""},
	}
	for _, c := range cases {
		var res slskResult
		parsed := false
		for _, line := range splitLines(c.out) {
			if jsonUnmarshal(line, &res) == nil { parsed = true; break }
		}
		if !parsed { t.Fatal("no parse") }
		if res.OK != c.ok { t.Errorf("ok=%v want %v", res.OK, c.ok) }
		if c.ok && res.Path != c.path { t.Errorf("path=%q want %q", res.Path, c.path) }
	}
}
```

(Replace `splitLines`/`jsonUnmarshal` with stdlib `strings.Split` + `encoding/json` directly; the helper names above are shorthand — use the real calls.)

- [ ] **Step 2: autoPickSlsk unit test (mirrors the Python pick test)**

```go
func TestAutoPickSlsk_PrefersFlac(t *testing.T) {
	cands := []slskCandidate{
		{Index: 0, Filename: "Artist - Title.mp3", Bitrate: 320, Size: 2_000_000},
		{Index: 1, Filename: "Artist - Title.flac", Bitrate: 900, Size: 20_000_000},
	}
	job := &DownloadJob{Artist: "Artist", Title: "Title"}
	// default fmt=flac, min_br=192 requires setting the store; if settings need
	// a DB, gate this test behind store.InitDB(t.TempDir()) like library_test.go.
	chosen := autoPickSlsk(cands, job)
	if chosen == nil || chosen.Index != 1 {
		t.Fatalf("expected flac (index 1), got %+v", chosen)
	}
}

func TestAutoPickSlsk_DropsJunk(t *testing.T) {
	cands := []slskCandidate{{Index: 0, Filename: "Artist - Title.mp3", Bitrate: 320, Size: 50_000}}
	job := &DownloadJob{Artist: "Artist", Title: "Title"}
	if autoPickSlsk(cands, job) != nil {
		t.Fatal("expected nil for <1MB junk")
	}
}
```

If `autoPickSlsk` reads settings that require a DB, call `store.InitDB(filepath.Join(t.TempDir(), "t.db"))` in the test (same pattern as `internal/handlers/library_test.go`).

- [ ] **Step 3: Run the suite**

Run: `go test -mod=vendor ./...` → green.

- [ ] **Step 4: Commit**

```bash
git add internal/downloads/slsk_test.go
git commit -m "test(downloads): soulseek stdout parsing + auto-pick characterization"
```

---

## Task 8: End-to-end manual verification

- [ ] **Step 1: Full build/vet/test gate**

Run: `go build -mod=vendor ./...`, `go vet ./...`, `go test ./...` → all green.

- [ ] **Step 2: Configure Soulseek in the UI**

`./server` → downloads tab → Settings → Soulseek section → enable, enter a real Soulseek account, set share to `music/shared` (drop a couple of albums in), Source = `soulseek`, Save.

- [ ] **Step 3: Force-Soulseek a track**

Rip one track with Source = `soulseek`. Confirm: job shows `source: soulseek`, downloads, the file appears in the library (scanner ingests it via the shared `finalizeDownload`), and the queue ends `completed`.

- [ ] **Step 4: Ambiguous-match picker**

Rip an obscure/ambiguous title with Source = `soulseek`. Confirm the candidate picker modal opens (YouTube picker reused; thumbnails hidden via onerror), picking one completes the download via `ProcessSlskSelection`.

- [ ] **Step 5: Auto-fallback**

Set Source = `auto`. Rip a track that YouTube bot-blocks (or temporarily break yt-dlp). Confirm the job logs "falling back to Soulseek", flips to `source: soulseek`, and completes (or fails with a combined message if Soulseek also fails).

- [ ] **Step 6: Graceful degradation**

Disable Soulseek (or `mv scripts/soulseek_dl.py /tmp`) → Source = `auto` → rip a track that fails on YouTube. Confirm the job just fails normally (no crash, no hang) and logs Soulseek-unavailable once.

---

## Self-review notes

- **Spec coverage:** aioslsk dep (T1), script + 3 modes + result picking (T2), Go exec layer (T3), dispatcher + fallback + shared finalizer (T4), picker selection routing (T5), settings UI (T6), tests (T7), e2e incl. picker + fallback + degradation (T8). Manual picker, auto-fallback, force-source, give-to-get share, additive settings, graceful absence — all covered.
- **Invariants:** no ID/path/scheme change; no schema migration (settings key-value only); no new global maps; mutex discipline unchanged (the refactor is a verbatim-move of the post-download tail); yt-dlp/ffmpeg/python3 optional preserved (findSlsk→"" skips cleanly).
- **API-JSON shapes:** no existing response shape changed; the select endpoint gains a source-aware branch only (existing YouTube clients unaffected).
- **No placeholders:** the two aioslsk field/method names that are genuinely unconfirmed are pinned to explicit confirmation steps (T2 Step 1/Step 4) against the installed package — they are flagged unknowns, not hand-waved.
- **Ordering dependency:** T3 and T4 compile only together (slsk.go references `computeDest`/`finalizeDownload` defined in T4). Build green happens at T4 Step 5.
- Each task ends in a commit; tasks are independently revertible except the T3+T4 compile pair.

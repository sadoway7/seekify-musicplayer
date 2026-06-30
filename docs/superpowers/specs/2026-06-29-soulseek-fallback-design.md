# Soulseek Fallback — Design

**Date:** 2026-06-29
**Status:** Design approved by user (pending spec review)
**Goal:** When a YouTube download fails (or when the user forces it), automatically fall back to Soulseek, exec'd as a per-download Python one-shot just like yt-dlp — no long-running daemon.

## Non-goals
- Not building a Soulseek library manager or GUI client.
- Not auto-populating the share folder.
- Not seeking the *best* quality — good quality is enough (user decision).

## Hard invariants respected (AGENTS.md)
- **ID scheme / `media:` prefix**: untouched. Soulseek-downloaded files enter the library through the normal post-download scan, which derives IDs by the same rules.
- **Schema**: additive only — all new config is stored in the existing SQLite **key-value settings table** (no `CREATE TABLE`/`ALTER` needed).
- **Mutex discipline**: no new global maps; Soulseek downloads reuse the existing `DownloadSem` and `DownloadJob` lifecycle.
- **Graceful degradation**: `aioslsk`/`python3` are optional at runtime, exactly like yt-dlp/ffmpeg. If absent, the Soulseek path is skipped with a logged warning; YouTube-only behavior is unchanged.
- **API JSON shapes**: no existing response shape changes. New behavior reuses the existing download-queue job shape (the `source` field already exists).
- **One concern per change**; Dockerfile change is isolated and additive (one extra pip package).

---

## Architecture

Two new artifacts + small wiring changes:

1. **`scripts/soulseek_dl.py`** (vendored, ~120–180 lines) — a one-shot CLI built on `aioslsk` (`pip install aioslsk`). Stateless per invocation; no daemon, no shared session between downloads. Three modes selected by flags:
   - **Search-only mode** (`--search-only`): start client → login → register share → search → print a JSON **array** of candidates to stdout → exit 0. Candidate shape matches the existing YouTube `needs_selection` candidate shape so the UI picker is reused: `[{"title","filename","bitrate","size","user","queue_wait"}, ...]` (only the fields the existing UI reads are populated; extras ignored).
   - **Auto-download mode** (default, no `--search-only`): as above, then auto-pick a result (see *Result picking*) → download to `--out` → emit one JSON object to stdout → exit.
   - **Select mode** (`--select <idx>`): re-run a prior `--search-only` with the same `--query`, then download the candidate at `<idx>` (deterministic given the same query) → emit the same JSON object as auto mode → exit.
   - **Args:** `--username --password --share <dir> --query "<artist> - <title>" --out <dir> [--min-bitrate N] [--format flac|mp3|any] [--search-only] [--select <idx>]`
   - **stdout (download modes):** `{"ok":true,"path":"/abs/path/to/file.flac","bitrate":...,"size":...}` or `{"ok":false,"error":"short message"}`.
   - **Exit codes:** `0` success (or search-only with results), `1` no match, `2` download failed, `3` auth/network error. Non-JSON lines go to stderr only (logged by Go, never parsed).
   - **Timeout:** self-imposed asyncio timeout (default 600s, matches `DownloadTimeout`); also enforced by the Go parent via `exec.CommandContext`.

2. **`internal/downloads/slsk.go`** (new, package `downloads`) — mirrors the yt-dlp exec pattern:
   - `findSlsk()` — resolve the script; returns the path if `python3` exists and `scripts/soulseek_dl.py` is present, else `""` (graceful absence).
   - `runSlskDownload(job, selectedIdx)` — build args from settings + job, `exec.CommandContext("python3", script, args...)` for either auto-download (no idx) or select (idx given), stream-parse the single stdout JSON line, move/tag the result through the **existing** post-download pipeline (reused, not duplicated).
   - `searchSlsk(query)` — dry-run search (`--search-only`) returning the candidate list; used by the **manual picker** flow (in scope — see *Manual result picker*).

### Fallback wiring (`internal/downloads/downloads.go`)
- Extract the existing YouTube body of `ProcessSingleDownload` (`downloads.go:545`) into `downloadFromYouTube(job)`.
- Add `downloadFromSoulseek(job)`.
- **Source decision** (`getDownloadSource()`): read `download_source` setting → `"auto" | "youtube" | "soulseek"`, default `"auto"`.
  - `"youtube"`: YouTube only (current behavior).
  - `"soulseek"`: Soulseek only (manual force) — skip YouTube entirely.
  - `"auto"`: YouTube first; **on YouTube failure** at the existing `job.Status="failed"` exit points (`downloads.go:548,568,576,673,691,705,713,724,736`), if `slsk_enabled && findSlsk() != ""` → set `job.Source="soulseek"`, clear the failure status, run `downloadFromSoulseek(job)` on the **same job** (one lifecycle, no new job). If Soulseek also fails, the job ends `"failed"` with a combined error message noting both sources were tried.
- **`DownloadJob.Source`** (`downloads.go:37`, json `"source"`) reused — value `"soulseek"`. The UI already renders a source badge, so a Soulseek job shows its source with no new field.

### Post-download pipeline (reused unchanged)
A successfully downloaded Soulseek file is handed to the same path a yt-dlp file takes: MusicBrainz tag (`ApplyApprovedMatches` + per-job metadata), optional FLAC conversion via existing `ConvertToFlac`, then the scanner ingests it (IDs derived normally). No special-casing.

### Concurrency & state
- `DownloadSem` (`make(chan struct{}, 3)`) governs Soulseek jobs too — no new semaphore.
- Each invocation logs in fresh and exits; no Soulseek session persists between downloads. Acceptable: Soulseek logins are cheap and the app isn't a high-throughput client.

---

## Settings (additive keys, existing key-value table)

| Key | Type | Default | Notes |
|-----|------|---------|-------|
| `slsk_enabled` | bool | `false` | Master switch. |
| `slsk_username` | string | `""` | Account username. |
| `slsk_password` | string | `""` | Stored plaintext in SQLite (see *Security note*). |
| `slsk_share_dir` | string | `<music_dir>/shared` | Dedicated small share folder. Created on save/startup if missing. |
| `slsk_preferred_format` | string | `flac` | `flac`/`mp3`/`any`. |
| `slsk_min_bitrate` | int | `192` | "Good quality, not best" floor (user decision). |
| `download_source` | string | `auto` | **Global** source mode: `auto`/`youtube`/`soulseek` (user decision — not per-job). |

No schema migration. Read/written through the existing settings GET/SET endpoints and `store.GetSetting*` helpers.

## Result picking ("good quality, not best")
Order, first match wins:
1. Filter to results whose filename strongly matches `"<artist> - <title>"` (normalized: case-fold, strip punctuation/feat./remix unless the query has them).
2. Among matches: if `preferred_format == flac` and a FLAC result exists at ≥ `min_bitrate`, take the **first** qualifying FLAC (not the highest — good, not best). Else take the first qualifying MP3 ≥ `min_bitrate`.
3. Drop junk: ignore results < 1 MB and absurd durations.
4. If nothing qualifies → exit code `1` ("no match") → `auto` mode reports "no Soulseek result" and the job fails.

## Manual result picker (in scope — YouTube parity)
Mirrors the existing YouTube `needs_selection` flow so the UI's result-picker is reused, not duplicated.
- **Trigger:** when `download_source="soulseek"` (force), or `auto` fallback lands on Soulseek, and the *strong-match filter* from *Result picking* step 1 yields **zero** candidates (no filename strongly matches `"<artist> - <title>"`), call `searchSlsk(query)`, set `job.Status="needs_selection"`, and store the candidate list on the job in the **existing** candidate-shape. When at least one strong match exists, auto-download proceeds without the picker.
- **UI:** the existing picker (rendered for YouTube `needs_selection` jobs) shows Soulseek candidates unchanged; the user taps one → the app calls the existing selection endpoint with the chosen index → `runSlskDownload(job, selectedIdx)` (`--select <idx>`).
- **Fallback:** if the user dismisses the picker, the job fails (same as YouTube's dismiss behavior) — in `auto` mode, no further source is tried (Soulseek was already the fallback).
- No new UI components; the picker and its endpoint already exist for YouTube.

**Implementation prerequisite:** verify the exact existing YouTube `needs_selection` candidate JSON shape (fields the UI renders) before writing the picker glue, and have `soulseek_dl.py --search-only` populate exactly those fields. The spec asserts reuse but the field names must be confirmed against the current code (search `needs_selection` in `js/ui.js` + the candidate struct in `internal/downloads/`).

## UI
Inside the existing downloads **Settings** panel — `_openDownloadsSettings()` in `js/ui.js`, the panel behind `#btn-dl-settings` (relocated in the prior audit work) — add a **"Soulseek"** section:
- Enable toggle (`slsk_enabled`).
- Global **Source mode** selector: `Auto (YouTube → Soulseek)` / `YouTube only` / `Soulseek only` (`download_source`). *(User decision: global, in settings — not a per-job dropdown.)*
- Username, Password (masked).
- Share folder path (`slsk_share_dir`, default `music/shared`).
- Preferred format (`flac`/`mp3`/`any`), Min bitrate.
- **Save** (existing settings SET endpoint). No new API endpoint for config.

No other UI surface changes. The download queue continues to show jobs as today; a Soulseek-sourced job shows `source: soulseek`.

## Deployment
- `Dockerfile:12`: add `aioslsk` to the existing `pip install --upgrade …` line (one token). Its deps (`mutagen` already present; `aiofiles`, `async-upnp-client`, `pydantic-settings`, `async-timeout`) resolve automatically.
- Single-container GitLab CI deploy, unchanged otherwise.
- Graceful degradation locally: if `python3` or the script is absent, `findSlsk()=="")` → Soulseek skipped, logged once; YouTube-only behavior intact.

## Security note (flag, not a blocker)
`slsk_password` is stored plaintext in the SQLite settings table — identical exposure to how `yt_cookies_file` (a path to a secret) and other credentials are already stored. No regression. Container/admin-only surface. Flagging explicitly; no encryption work in scope.

## Give-to-get note
Soulseek throttles/queues accounts that share nothing. We **create** `slsk_share_dir` if missing and register it with `aioslsk`, but we do **not** populate it — the user drops a few albums in manually. An empty share will still work but downloads will be slow/deprioritized.

## Testing
- **`scripts/soulseek_dl.py`**: unit-testable against `aioslsk`'s shipped **mock server** (`aioslsk` tests provide one) — assert search→pick→download happy path and the no-match exit code, without a real network/account.
- **`internal/downloads/slsk.go`**: `runSlskDownload` parsing test — feed canned stdout JSON (success + each error exit code) and assert the job state transitions, using table-driven tests in the existing `internal/downloads/downloads_helpers_test.go` style.
- **Fallback wiring**: characterization assertion that with `download_source="auto"`, a YouTube failure flips `job.Source="soulseek"` and invokes the Soulseek path (mock `findSlsk`/`runSlskDownload`).
- **Manual picker**: assertion that an ambiguous Soulseek result sets `job.Status="needs_selection"` with candidates, and that selecting an index calls `runSlskDownload(job, idx)` (mock the exec).
- Manual: force `download_source="soulseek"`, rip one track, confirm it downloads + appears in the library + the queue shows `source: soulseek`; and that an ambiguous track surfaces the picker, which on selection completes the download.

## Design decisions (explicitly chosen, not deferred)
- **Source selector = global** (in the downloads Settings panel), not a per-job dropdown. User chose this.
- **Manual result picker = included**, reusing the existing YouTube `needs_selection` UI/endpoint — no new picker components. Chosen for YouTube-feature parity (user: "complete working tested implementation").
- **Share-folder management = filesystem only**, no in-app browse/manage UI. User populates the folder manually.
- **Persistent Soulseek session = none.** Per-invocation login is the design (cheap, stateless, matches yt-dlp pattern).
- **Quality = "good, not best"** — first qualifying FLAC else first MP3 ≥ min_bitrate; no quality maximization / extra transcoding beyond the existing `ConvertToFlac`. User chose this.

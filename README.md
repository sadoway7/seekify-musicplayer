# musicapp

A self-hosted music server. Stream your library, discover and download new
music, and let it clean up metadata and artwork for you. Runs as a single
binary; the UI is a mobile-first web app you can install to your home screen.

---

## What it does

**Build a library two ways:**
- Point it at a folder of existing music files — it scans tags, extracts
  embedded artwork, and builds a browsable library.
- Search for anything and download it — from YouTube (via yt-dlp) or Soulseek
  (peer-to-peer). Files are auto-tagged, converted to your preferred format,
  and dropped into the library.

**Browse and play:**
- Library organized by album and artist. Search, sort, filter.
- Tap a track to play. A mini-player floats above the tab bar; expand it to a
  full now-playing screen with scrubbing, queue, and shuffle.
- Lock-screen / media-key controls on iOS and Android (install to home screen
  for the full PWA experience).
- Build playlists; recent plays and favorites are tracked.

**Find & download (Finder tab):**
- Search MusicBrainz for canonical metadata, YouTube for audio, or Soulseek
  for lossless files. Download anything with one tap.
- A download queue shows live progress (searching → downloading → tagging →
  done). Filter by status. If a source is ambiguous, it asks you to pick.
- Soulseek sources are ranked by quality and learned peer speed — fast,
  reliable uploaders are tried first.

**Review (Needs Attention):**
- After files land, a background worker flags problems: missing metadata,
  suspicious filenames, duplicates, missing artwork, no duration.
- The Needs Attention page lists flagged tracks. Fix inline, fetch artwork,
  rescan metadata from MusicBrainz, or mark "doesn't need review."
- Manually-approved tracks stay approved — the worker won't re-flag them.

---

## Design

Mobile-first and dark, built to feel like a native music app:

- **Fixed bottom tab bar** (Library, Finder, Downloads, Review) with a
  floating mini-player above it. On desktop, the tab bar becomes a left rail.
- **Bottom-sheet modals** slide up from the bottom for track actions, metadata
  editing, and source selection.
- **Filter chips** throughout — tap to slice a list by status, type, or flag.
- **Installable** as a PWA: add to home screen, full-screen, status-bar-aware.
- No page reloads — it's a single-page app that streams audio and updates live.

---

## Stack

**Backend** — Go, single binary (one `package main`, no subpackage sprawl
beyond `internal/`).
- **SQLite** via `modernc.org/sqlite` — pure-Go, no CGo. WAL mode.
- **`dhowden/tag`** — reads audio tags (FLAC, MP3, OGG, M4A).
- **`google/uuid`** — ID generation.

**Frontend** — vanilla JS and CSS. No framework, no bundler, no build step.
Served as static files by the Go binary.

**Runtime tools** (optional but expected for full functionality):
- **yt-dlp** — YouTube search and download.
- **ffmpeg** — transcoding, waveform generation, audio probing (ffprobe).
- **python3** — Soulseek client (`aioslsk`) and metadata enrichment
  (`musicbrainzngs`, `mutagen`). Falls back gracefully if unavailable.

**Deploy** — Dockerfile included (Alpine + all runtime tools preinstalled).

---

## Quick start

```sh
cp .env .env          # edit if you want (admin passcode, music dir, port)
go build -mod=vendor -o server .
./server
```

Then open `http://localhost:8081`. The binary auto-opens a browser. Put music
in `./music` (or set `MUSIC_DIR`). See `.env` for all options.

To run with Docker, see `Dockerfile` and `.gitlab-ci.yml`.

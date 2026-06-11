# PyPI Research: Lightweight Packages for Musicapp

> Broad survey of PyPI packages that could improve metadata matching, genre tagging, album pairing,
> audio quality, lyrics, normalization, and more. Focus: lightweight, well-documented, easy to integrate.

---

## HIGHLIGHT: youtune (MUST INVESTIGATE)

**Package:** [youtune](https://pypi.org/project/youtune/) v1.2.1 (Apr 2026)
**License:** MIT | **Source:** 22KB | **Python:** >=3.9

### Why it's a goldmine for musicapp

youtune is a YouTube→MP3 downloader that solves almost EVERY gap in musicapp's download pipeline:

| musicapp gap | youtune solution |
|---|---|
| `tagAudioFile()` only writes 4 fields (artist/title/album/track#) via ffmpeg | Writes full ID3v2 tags via **mutagen** (artist, album, year, track#, genre, MBIDs) |
| YouTube title junk like "(Official Video) [HD Remaster]" left in metadata | Smart title parsing strips junk, extracts clean artist + song |
| MusicBrainz genres never fetched (`musicbrainz.go` has no `inc=tags`) | MusicBrainz lookup with confidence scoring, gets full metadata |
| No cover art from Cover Art Archive | Fetches cover from Cover Art Archive, embeds in file |
| No lyrics support | Fetches synced/plaintext lyrics from **lrclib**, embeds in file |
| No loudness normalization | EBU R128 loudness normalization built in |
| Album artist never written in `tagAudioFile()` | Proper tag writing via mutagen (all fields) |
| No quality upgrade path | Optional Soulseek integration for FLAC/320kbps upgrade |
| Messy filenames from yt-dlp | Smart renaming to `Artist - Title.mp3` |

### Pipeline (maps directly to musicapp's download flow)

```
YouTube URL
    → yt-dlp extract audio → MP3
    → Parse title (strip "Official Video [HD]" → clean artist + song)
    → MusicBrainz lookup (recording → album, year, track#, genre, MBIDs)
    → Cover Art Archive (fetch cover → embed in MP3)
    → lrclib (fetch synced lyrics → embed in MP3)
    → mutagen (write ID3v2 tags + APIC art + USLT lyrics)
    → (optional) Soulseek search for FLAC/320 → replace YouTube file
    → (optional) EBU R128 loudness normalization
```

### What it uses internally (all lightweight)
- **mutagen** — tag reading/writing (zero deps)
- **musicbrainzngs** — MusicBrainz API (zero deps)
- **yt-dlp** — already in musicapp's Docker image
- **ffmpeg** — already in musicapp's Docker image
- Optional: `soulseek` extra for quality upgrades

### Integration ideas for musicapp
1. **Replace/enhance `tagAudioFile()` in `downloads.go`** — call youtune as a post-download Python helper instead of the current ffmpeg-based tagging
2. **Borrow the smart title parsing logic** — port to Go or call from Python
3. **Use as reference** for how to properly chain MusicBrainz → Cover Art Archive → lrclib → mutagen
4. **CLI integration** — `youtune download URL --lyrics --normalize` does everything in one shot

### GitHub
https://github.com/jschof1/youtune

---

## Audio Fingerprinting & Identification

### pyacoustid (RECOMMENDED)
- **PyPI:** https://pypi.org/project/pyacoustid/ v1.3.1 (Apr 2026)
- **What:** Chromaprint fingerprinting + Acoustid web API lookup AND submission
- **Deps:** requests, audioread (optional). Needs `fpcalc` binary (chromaprint)
- **For musicapp:** Identify unknown tracks by audio content. Fallback when string-based MusicBrainz matching fails. Requires Acoustid API key (free).
- **Weight:** Very light

### pychromaprint
- **PyPI:** https://pypi.org/project/pychromaprint/ v1.2.2 (Jan 2023)
- **What:** Direct C bindings to Chromaprint via ctypes. Raw fingerprint generation, no web service.
- **Deps:** libchromaprint system library. No Python deps. 2.6KB source.
- **For musicapp:** Compute Chromaprint hashes without Acoustid API. Could store fingerprints in SQLite for local dedup.
- **Weight:** Ultra-light

### audiolocate
- **PyPI:** https://pypi.org/project/audiolocate/ v0.1.1 (Apr 2026)
- **What:** Shazam-like algorithm (Wang 2003). Finds where a short clip appears in a long recording. Streaming/chunked.
- **Deps:** numpy, scipy, av (PyAV)
- **For musicapp:** "Find this track in my DJ sets" feature. Clean, modern, well-documented.
- **Weight:** Medium

### soundaudit
- **PyPI:** https://pypi.org/project/soundaudit/ v0.1.2 (May 2026)
- **What:** Music library health scanner. AcoustID fingerprinting, content-hash dedup, spectral transcode detection (fake-FLAC), MusicBrainz resolution, tag writeback.
- **Deps:** mutagen, pydantic, pyyaml, requests, rich, sqlalchemy, textual, typer, xxhash. Optional: pyacoustid. **No numpy/scipy.**
- **For musicapp:** All-in-one library health tool. Duplicate detection, fake-FLAC detection, metadata cleanup.
- **Weight:** Light (no numpy/scipy)

### audalign
- **PyPI:** https://pypi.org/project/audalign/ v1.3.1 (Mar 2025)
- **What:** Audio alignment via fingerprinting, cross-correlation, spectrogram, or visual. 4 recognizers. Find partial matches, time-offset duplicates.
- **Deps:** numpy, scipy, matplotlib, pydub, tqdm, ffmpeg
- **For musicapp:** Most versatile dedup — can find different encodings of same track, partial matches.
- **Weight:** Medium-heavy

---

## Lyrics

### lyriq (TOP PICK for synced lyrics)
- **PyPI:** https://pypi.org/project/lyriq/ v1.6.0 (Dec 2025)
- **What:** Zero-dep library fetching plain + synced (LRC) lyrics from LRCLib API. Caching, CLI, LRC/JSON I/O.
- **Deps:** None
- **For musicapp:** Call from backend for synced lyrics display. Can download full LRCLib SQLite dump for offline.
- **Weight:** Ultra-light

### lrclib-python
- **PyPI:** https://pypi.org/project/lrclib-python/ v0.4.2 (Jan 2026)
- **What:** Minimal LRCLib API wrapper. Returns `.synced_lyrics`, `.plain_lyrics`, `.status`.
- **Deps:** requests only
- **For musicapp:** Simplest synced lyrics fetcher.
- **Weight:** Ultra-light

### syncedlyrics (already known)
- **PyPI:** https://pypi.org/project/syncedlyrics/
- **What:** Multi-provider synced lyrics (LRCLib, NetEase, Musixmatch, YouTube, etc.)
- **Deps:** requests, rapidfuzzy
- **For musicapp:** Best coverage due to multiple providers.

### lyricsgenius
- **PyPI:** https://pypi.org/project/lyricsgenius/ v3.0.1
- **What:** Full Genius.com API client. Search songs/artists/albums, fetch lyrics.
- **Deps:** requests, beautifulsoup4
- **For musicapp:** Best plain lyrics source. Requires free Genius API token.
- **Weight:** Light

### lrctoolbox
- **PyPI:** https://pypi.org/project/lrctoolbox/ v1.2.0 (Nov 2023)
- **What:** Parse, edit, shift timestamps, check sync status of LRC files. Zero deps.
- **Deps:** None
- **For musicapp:** Manipulate LRC files alongside music files.
- **Weight:** Ultra-light

### karaoke
- **PyPI:** https://pypi.org/project/karaoke/ v0.0.2 (Oct 2024)
- **What:** LRC parser with playback-aware API. `set_current_lyric(timestamp_ms)` for real-time sync.
- **Deps:** None
- **For musicapp:** Feed timestamps during playback for live lyric highlighting.
- **Weight:** Ultra-light

---

## Audio Normalization & Loudness

### r128gain (TOP PICK for loudness tagging)
- **PyPI:** https://pypi.org/project/r128gain/ v1.0.7 (Mar 2023)
- **What:** Fast audio loudness scanner & tagger. Tags with ReplayGain v2 or Opus R128. Uses FFmpeg. Multi-threaded.
- **Deps:** FFmpeg only (no Python deps — wraps ffmpeg CLI)
- **For musicapp:** Scan whole library, write loudness tags. Zero Python deps. Fast.
- **Weight:** Ultra-light (just ffmpeg, already in Docker)

### rs-audio-stats (TOP PICK for loudness measurement)
- **PyPI:** https://pypi.org/project/rs-audio-stats/ v1.4.1 (Dec 2025)
- **What:** EBU R128 analysis powered by Rust. Integrated/short-term/momentary loudness, true peak, loudness range.
- **Deps:** None (pre-compiled Rust wheels)
- **For musicapp:** Full R128 loudness metrics for every track. Zero Python deps. Rust speed.
- **Weight:** Ultra-light (note: docs primarily in Japanese)

### ffmpeg-normalize (already known)
- **PyPI:** https://pypi.org/project/ffmpeg-normalize/ v1.37.8 (May 2026)
- **What:** Batch audio normalization via ffmpeg. EBU R128 or RMS-based.
- **Deps:** tqdm, colorama, ffmpeg-progress-yield, colorlog, mutagen
- **For musicapp:** Gold standard for normalizing downloads.
- **Weight:** Light

### loudness
- **PyPI:** https://pypi.org/project/loudness/ v0.2.0 (Dec 2025)
- **What:** Fast C++ LUFS measurement per ITU BS.1770 / EBU R128. "World's fastest."
- **Deps:** numpy, pybind11
- **For musicapp:** Fast programmatic LUFS per track.
- **Weight:** Light

---

## Audio Metadata & Tagging

### mutagen (ESSENTIAL)
- **PyPI:** https://pypi.org/project/mutagen/
- **What:** Read/write audio tags for every format. The de facto standard.
- **Deps:** None (pure Python)
- **For musicapp:** Replace ffmpeg-based `tagAudioFile()`. Write genre, album artist, MBIDs, year, etc.
- **Weight:** Ultra-light

### mutagen-rs
- **PyPI:** https://pypi.org/project/mutagen-rs/ v0.2.7 (Feb 2026)
- **What:** Rust-based drop-in replacement for mutagen. 100-300x faster.
- **Deps:** None (pre-compiled wheels)
- **For musicapp:** If mutagen is too slow for large scans. Drop-in replacement.
- **Weight:** Ultra-light

### tinytag (TOP PICK for metadata reading)
- **PyPI:** https://pypi.org/project/tinytag/ v2.2.1 (Mar 2026)
- **What:** Read audio metadata (tags, duration, bitrate, sample rate, channels) from any format.
- **Deps:** None (pure Python)
- **For musicapp:** Get bitrate/duration/format info with zero deps. Detect corrupt files via ParseError.
- **Weight:** Ultra-light

### music-tag
- **PyPI:** https://pypi.org/project/music-tag/
- **What:** Format-agnostic tag editing layer on top of mutagen. Unified API.
- **Deps:** mutagen
- **For musicapp:** Simpler API than raw mutagen if you want quick tag edits.

### eyeD3
- **PyPI:** https://pypi.org/project/eyeD3/ v0.9.x
- **What:** ID3 tag reader/writer for MP3 (ID3v1.x, ID3v2.3/2.4). CLI tool included.
- **Deps:** Minimal (deprecation, filetype)
- **For musicapp:** MP3-specific tag work. Supports album art embedding.

---

## MusicBrainz & Metadata Sources

### musicbrainzngs (RECOMMENDED)
- **PyPI:** https://pypi.org/project/musicbrainzngs/
- **What:** Full MusicBrainz Web Service wrapper. Handles rate limiting, retries.
- **Deps:** None
- **For musicapp:** Replace hand-rolled MB HTTP calls in `musicbrainz.go`. Get genres (`inc=tags`), release groups, proper matching.
- **Weight:** Ultra-light

### python3-discogs-client
- **PyPI:** https://pypi.org/project/python3-discogs-client/ v2.8 (Feb 2025)
- **What:** Discogs API client. Query releases, masters, labels, marketplace.
- **Deps:** requests, oauthlib
- **For musicapp:** Secondary metadata source for releases, genres, labels, year.
- **Weight:** Light

### pylast
- **PyPI:** https://pypi.org/project/pylast/ v7.0.2 (Jan 2026)
- **What:** Full Last.fm/Libre.fm API. Artist bios, similar artists, tags, scrobbling.
- **Deps:** None (uses http.client)
- **For musicapp:** Artist biographies, similar artists, user scrobbling. Could enable "similar artists" radio.
- **Weight:** Ultra-light

### deezer-python
- **PyPI:** https://pypi.org/project/deezer-python/ v7.2.0 (Apr 2026)
- **What:** Deezer API wrapper. Albums, artists, tracks, genres, charts.
- **Deps:** requests
- **For musicapp:** Rich public metadata, genre data, album art URLs. No auth needed for public data.
- **Weight:** Light

### spotipy
- **PyPI:** https://pypi.org/project/spotipy/ v2.26.0 (Mar 2026)
- **What:** Spotify Web API client. Audio features (tempo, key, energy, danceability).
- **Deps:** requests, urllib3
- **For musicapp:** Get audio analysis features (tempo, key, loudness) that other APIs don't provide.
- **Weight:** Light

---

## Cover Art

### sacad (TOP PICK for cover art)
- **PyPI:** https://pypi.org/project/sacad/
- **What:** Smart Automatic Cover Art Downloader. Searches Deezer, Apple Music, Cover Art Archive.
- **Deps:** requests, Pillow, mutagen, aiohttp
- **For musicapp:** Batch-scan library, fill missing covers automatically. Multi-source.
- **Weight:** Light

### get-cover-art
- **PyPI:** https://pypi.org/project/get-cover-art/ v1.8.x
- **What:** Batch-downloads cover art from Apple Music/iTunes, embeds into files.
- **Deps:** mutagen, requests
- **For musicapp:** Bulk-embed cover art. Apple Music has huge catalog.
- **Weight:** Light

### python-fanart
- **PyPI:** https://pypi.org/project/python-fanart/ v1.4.0
- **What:** Fanart.tv API. Artist backgrounds, album covers, logos.
- **Deps:** requests
- **For musicapp:** High-quality artist images and banners for UI.
- **Weight:** Light

---

## BPM / Key Detection (Music Theory)

### keyfinder (TOP PICK for key detection)
- **PyPI:** https://pypi.org/project/keyfinder/ v1.1.0
- **What:** Python bindings for libKeyFinder (C++). Returns key, Camelot notation, Open Key notation.
- **Deps:** libKeyFinder (C++ lib), ffmpeg. **No numpy/scipy.**
- **For musicapp:** Key detection + Camelot wheel for harmonic mixing. `key.camelot()` → '11B'.
- **Weight:** Light (just C++ lib + ffmpeg)

### aubio (TOP PICK for BPM)
- **PyPI:** https://pypi.org/project/aubio/ v0.4.9
- **What:** C library with Python bindings. Beat detection, tempo tracking, onset detection, pitch tracking.
- **Deps:** numpy. Optionally ffmpeg, libsndfile.
- **For musicapp:** BPM detection per-track during scanning. Only ~480KB. `aubio.tempo("default", ...)`.
- **Weight:** Light-medium (numpy + C lib)

### mingus
- **PyPI:** https://pypi.org/project/mingus/
- **What:** Pure Python music theory. Note/chord/scale/interval handling.
- **Deps:** None
- **For musicapp:** Key/scale lookups, note-to-frequency, chord construction. Frontend features.
- **Weight:** Ultra-light

### pychord
- **PyPI:** https://pypi.org/project/pychord/
- **What:** Parse, manipulate, generate chord names. Transpose chords.
- **Deps:** None
- **For musicapp:** Chord notation in metadata, transpose for display.
- **Weight:** Ultra-light

---

## Audio Quality & Analysis

### flac-detective
- **PyPI:** https://pypi.org/project/flac-detective/ v1.4.0 (Jun 2026)
- **What:** Detects MP3-to-FLAC transcodes via 11-rule spectral analysis.
- **Deps:** numpy, scipy, mutagen, soundfile, rich
- **For musicapp:** Flag fake FLAC files in library.
- **Weight:** Light-medium

### auditok (TOP PICK for silence detection)
- **PyPI:** https://pypi.org/project/auditok/ v0.4.2 (May 2026)
- **What:** Audio activity detection. Split/trim by energy threshold. No ML required.
- **Deps:** numpy (core only)
- **For musicapp:** Detect silence for gapless playback info, trim silence, find where music starts.
- **Weight:** Light

### filetype
- **PyPI:** https://pypi.org/project/filetype/
- **What:** Infer file type and MIME by magic numbers. Pure Python.
- **Deps:** None
- **For musicapp:** Validate downloaded files are actually audio. Catch misnamed files.
- **Weight:** Ultra-light

### dr14meter
- **PyPI:** https://pypi.org/project/dr14meter/ v1.1.5 (Nov 2025)
- **What:** DR14 dynamic range meter (Pleasurize Music Foundation spec).
- **Deps:** numpy only
- **For musicapp:** Compute DR values per track. Identify over-compressed masters.
- **Weight:** Light

---

## Playlist Generation & Recommendation

### troi (TOP PICK for recommendations)
- **PyPI:** https://pypi.org/project/troi/ (Mar 2026, very active)
- **What:** ListenBrainz' empathic music recommendation engine. Collaborative filtering, similarity, tags. Resolves to local files.
- **Deps:** Python >=3.10, optional nmslib
- **For musicapp:** Self-hosted playlist generation. Scans local collections. Resolves via MusicBrainz IDs or fuzzy matching. Supports Subsonic API sources.
- **Weight:** Light

---

## FFmpeg Wrappers

### python-ffmpeg
- **PyPI:** https://pypi.org/project/python-ffmpeg/ v2.0.12
- **What:** Python binding for FFmpeg with sync and async APIs. Typed.
- **Deps:** pyee, typing-extensions
- **For musicapp:** Lightweight async ffmpeg wrapper for transcoding.
- **Weight:** Ultra-light

### ffmpegio
- **PyPI:** https://pypi.org/project/ffmpegio/ v0.11.1
- **What:** Full FFmpeg I/O — read, write, probe, manipulate multimedia.
- **Deps:** pluggy, packaging, typing_extensions
- **For musicapp:** Most complete ffmpeg wrapper if you need fine-grained audio control.
- **Weight:** Light

---

## Wikipedia / Artist Info

### Wikipedia-API
- **PyPI:** https://pypi.org/project/Wikipedia-API/ v0.15.0 (May 2026)
- **What:** Wikipedia wrapper (sync + async). Text, sections, links, images, categories.
- **Deps:** requests
- **For musicapp:** Fetch artist biographies for artist detail pages.
- **Weight:** Light

---

## Packages REJECTED (too heavy / wrong fit)

| Package | Why rejected |
|---|---|
| librosa | Heavy ML stack (numpy, scipy, soundfile, audioread...) |
| beets | Conflicts with musicapp's own library management |
| madmom | Non-commercial license on trained models |
| crepe | Requires TensorFlow |
| music21 | 30MB, overkill for runtime |
| essentia | Capable but large Docker footprint |
| spotdl | Redundant with yt-dlp |
| PyDejavu | Requires MySQL/PostgreSQL, abandoned |
| aubio (for key) | Doesn't do key detection directly |

---

## Top Recommendations by Priority

### Tier 1: Highest impact, lightest weight (should do)
1. **youtune** — Enhance entire download pipeline (smart tagging, lyrics, art, normalization)
2. **mutagen** — Proper tag writing (replace ffmpeg-based `tagAudioFile()`)
3. **musicbrainzngs** — Proper MusicBrainz API with genres, rate limiting
4. **tinytag** — Zero-dep metadata reading (bitrate, format, duration)
5. **r128gain** — Zero-dep loudness tagging (just ffmpeg, already in Docker)

### Tier 2: High impact, light weight (strong should)
6. **lyriq** or **lrclib-python** — Synced lyrics from LRCLib (zero/1 dep)
7. **sacad** — Auto cover art from multiple sources
8. **pyacoustid** — Acoustic fingerprinting for unknown tracks
9. **rs-audio-stats** — Zero-dep EBU R128 loudness measurement (Rust wheels)
10. **auditok** — Silence detection for gapless playback (numpy only)

### Tier 3: Nice to have, light weight
11. **keyfinder** — Key detection + Camelot wheel (C++ lib, no numpy)
12. **aubio** — BPM detection (numpy + C lib)
13. **troi** — ListenBrainz playlist generation
14. **pylast** — Last.fm scrobbling + similar artists (zero deps)
15. **deezer-python** — Rich public metadata (requests only)
16. **Wikipedia-API** — Artist biographies (requests only)

### Tier 4: Explore later
17. **soundaudit** — Library health scanner (duplicates, fake-FLAC)
18. **flac-detective** — Fake FLAC detection
19. **dr14meter** — Dynamic range measurement
20. **filetype** — File type validation
21. **mingus** / **pychord** — Music theory utilities
22. **python-fanart** — Artist images from fanart.tv

---

## Lightest-weight dream stack (zero numpy/scipy)

| Need | Package | Python deps |
|---|---|---|
| Download pipeline | youtune | mutagen, musicbrainzngs, requests |
| Tag writing | mutagen | None |
| Metadata reading | tinytag | None |
| Loudness tagging | r128gain | None (wraps ffmpeg) |
| Loudness measurement | rs-audio-stats | None (Rust wheels) |
| Synced lyrics | lyriq | None |
| Cover art | sacad | requests, Pillow, mutagen, aiohttp |
| MusicBrainz | musicbrainzngs | None |
| Fingerprinting | pyacoustid | requests |
| Silence detection | auditok | numpy |
| Artist info | pylast | None |
| File validation | filetype | None |

**Total external deps:** requests, Pillow, mutagen, aiohttp, numpy = very manageable

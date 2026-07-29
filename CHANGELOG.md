# Changelog

## 2026-07-28 — Security & Defect Fixes + Visualizer Perf

13 audit findings fixed (11 security, 4 defects, 1 frontend). Full report: `docs/audits/2026-07-28-seekify-audit.md`. All `go build/vet/test` green after each fix.

### Security
- **S1** SpaHandler now whitelists static assets (was: served any CWD file unauthenticated) — `handlers.go:190` + `spa_test.go`
- **S3** Path-traversal guards in Cover/ArtistArt/FinderCover handlers — `streaming.go:124,171`, `finder.go:142`
- **S4** `/api/shared-queue` body cap 1MB + 500-track limit — `collections.go:121`
- **S5/S6/S11** `auth.RequireUser` on `/api/watch`, `/api/v2/resolve-url`, `/api/v2/search`, `/api/track-duration/`, `/api/finder/youtube`, `/api/preview/` — `server.go` mux lines
- **S9** PreviewAudioHandler took `ytDlpSem` + `CommandContext(30s)` — `downloads.go:536`
- **S10** V2SearchHandler took `ytDlpSem` — `resolve.go:344`

### Defects
- **D2** Password change now invalidates other sessions — `auth.go:122`
- **D5** RingBuffer full-flag logic rewritten — `logbuf.go:31-47`
- **D6** `DbMigrateTrackID` returns error; autosort rolls back rename on DB failure — `database.go:1206`, `autosort.go:87-91`
- **D9** `ExtractYouTubePlaylistTracks` took `CommandContext(2min)` — `watched.go:121`
- **D10** SetupHandler serialized with mutex — `auth.go`
- **D11** AutoSort skips rename when destination exists — `autosort.go:79`

### Frontend
- **F10** `Api._req` handles empty-body 204 — `js/api.js:25`
- **V1** Visualizer shader cost halved (`maxEdge` 1920→1280, `uMaxSteps` 148→96) — main-thread raymarch was starving audio playback when visualizer was on — `js/visualizer.js:621,189`
- Dice-shuffle pose blend (250ms smoothstep) — pointer-drag transitions no longer snap — `js/shuffle-die.js`

### Deferred (still open)
S2 (cookies+CORS, needs extension flow), S7 (rate limit middleware), S8 (FinderCoverHandler body leak), D1/D3/D4 (product/schema decisions), C1/C5 (perf refactors), F1 (library DOM virtualization).

---

## 2026-07-28 — Security & Defect Audit

Full audit completed. Report: `docs/audits/2026-07-28-seekify-audit.md`.

### Critical (fix first)
- **S1** `SpaHandler` serves any CWD file unauthenticated (`data/music.db`, `data/cookies.txt`, `.env`) — `internal/handlers/handlers.go:190-202`
- **S2** Cookie endpoints unauthenticated + CORS `*` — `server.go:414-417`, `internal/handlers/cookies.go`
- **S3** Path traversal in 3 cover/art handlers — `streaming.go:124-148,165-198`, `finder.go:142-191`

### High (anonymous surface)
- **S4** Unbounded `/api/shared-queue` DB insert — `collections.go:121-136`
- **S5** `/api/watch*` unauthenticated (SSRF + disk-fill) — `settings.go:176-261`
- **S6** `/api/v2/resolve-url`, `/api/preview/`, `/api/finder/youtube` unauthenticated subprocess spawn — `resolve.go`, `downloads.go:523-555`, `finder.go:212-286`
- **S7** No rate limit on `/api/login`, `/api/register`, `/api/setup` — `auth.go:57-86`, `register.go:21-63`

### Medium (lifecycle / leaks)
- **S8** `FinderCoverHandler` leaks upstream response bodies on 404 — `finder.go:166-177`
- **S9** `PreviewAudioHandler` no timeout/semaphore — `downloads.go:536-542`
- **S10** `V2SearchHandler` no concurrency cap — `resolve.go:315-374`
- **S11** `TrackDurationHandler` unauthenticated DB write — `admin.go:230-267`

### Defects (verified)
- **D1** Self-service admin escalation (`default_role=admin` + `self_service`) — `register.go:39-42`, `ui-settings.js:241-245`
- **D2** Password change doesn't invalidate sessions — `auth.go:101-124`
- **D3** Case-variant duplicate usernames — `database.go:148`, `auth/users.go:96`
- **D4** `DbDeleteUser` orphans data, sessions may persist — `auth/users.go:180`
- **D5** Ring buffer off-by-one — `logbuf.go:31-48`
- **D6** `DbMigrateTrackID` swallows `DB.Begin` error → orphaned favorites — `database.go:1209-1211`, `autosort.go:87`
- **D7** Scanner swallows `tx.Commit` error → DB/memory divergence — `scanner.go:332-364`
- **D8** `GenerateUUID` ignores `rand.Read` error — `models/ids.go:16-21`
- **D9** `ExtractYouTubePlaylistTracks` no timeout → worker wedge — `watched.go:121-130`
- **D10** `SetupHandler` TOCTOU → duplicate admin — `auth.go:26-44`
- **D11** AutoSort overwrite of existing destination — `autosort.go:79`
- **D12** `Content-Disposition` header injection via track title — `downloads.go:79-84`

### Likely / Uncertain (one link unconfirmed)
- **C1** `orphanReset` re-queues searching jobs → double-processing — `downloads.go:1979-2007`
- **C2** `ALTER TABLE ADD COLUMN` without `IF NOT EXISTS` — `database.go:43,110,133-143,156,177`
- **C3** No `SetMaxOpenConns(1)` — `database.go:29`
- **C4** `GetSetting` can't distinguish empty from missing — `settings.go:66-73`
- **C5** Review bulk ops hold `Mu` across N DB writes — `review.go:617-625,654-661,581-589`
- **C6** Login username enumeration via timing — `auth.go`
- **C7** Session cookie lacks `Secure` — `auth.go:146-152`
- **C8** `enrichActive` read without lock — `review.go:1420`
- **C9** Sessions table unbounded growth — `sessions.go:45-47`
- **C10** Last-admin demote/delete race — `users.go:103-110,142-147`

### Frontend
- **F1** Library infinite scroll grows DOM monotonically — `ui-library.js:227-291`
- **F10** `Api._req` throws on 204 empty body — `api.js:25`

### Clean (verified, no action)
- SQL injection: none found
- bcrypt/session tokens: correct
- `store.Mu` lock discipline: holds (hard invariant 6)
- Range parsing: correct, tested
- Shell injection: none (argv-vector everywhere)
- Subprocess pipe draining: correct
- MusicBrainz rate limiting: cross-process file lock, well-built
- Workers registry: race regression-tested
- Upload paths: dual validation, admin-gated
- `handlers.RequireAdmin`: thin delegate, `ADMIN_PASSCODE` dead in code

### Quick wins (≤5 lines, isolated)
S1, S3, S4, S5, S6, S9, S10, S11, D2, D5, D6, D9, D10, D11, F10

### Deferred (needs design or product call)
S2 (extension flow), S7 (new middleware), S8 (subtle pattern), D1 (product), D3 (migration), D4 (tx design), C1 (state machine), C5 (perf refactor), F1 (virtualization)

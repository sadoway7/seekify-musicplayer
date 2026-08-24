# Seekify — Architecture Deepening Review

**2026-08-23 · read-only review · two exploration passes (frontend + backend)**

Seven deepening opportunities, found by walking the hot spots (`js/ui.js`, `server.go`, `internal/store`, `internal/downloads`, `internal/review`) with the deletion test in hand.

Vocabulary used below: a **module** has an **interface** and an implementation; it is **deep** when a lot of behaviour sits behind a small interface. A **seam** is where you can change behaviour without editing in place. Depth buys callers **leverage** and maintainers **locality** (fix once, fixed everywhere). No `CONTEXT.md` or ADRs exist yet — domain names come from AGENTS.md: the library, the queue, the scanner, the review worker, the ripper.

Tally: 4 Strong · 2 Worth exploring · 1 Speculative. One Critical bug surfaced along the way (card 6 — since fixed by removal).

---

## 1 · A Library module for the global track maps — **Strong**

**Files:** `internal/store/store.go` · `internal/handlers` (13 of 20 files) · scanner · review · musicbrainz · downloads · waveform · bands · watched · normalize

**Problem.** The library — `store.Tracks` / `store.Albums` guarded by `store.Mu` — has no module at all. Its interface is "know the maps exist and re-implement the RWMutex ritual": roughly **280 caller-side lock sites across 9 packages** (handlers 83, review 67, scanner 59, musicbrainz 37, downloads 22, four more packages 16). No depth — every unit of behaviour costs a unit of lock-discipline learning. The review worker, scanner, and HTTP handlers all mutate the same maps, each re-spelling the ceremony.

Tests pay for it directly: 7 of 11 handler test files swap the globals under the mutex (`streaming_test.go:51–64` is the canonical form; 23 `store.Tracks =` assignments repo-wide). The test surface *is* the implementation, so no two handler tests can run in parallel.

Deletion test: there is nothing to delete. That is the finding.

**Solution.** One Library module whose interface is a handful of read/write operations over tracks and albums (lookup, snapshot-for-JSON, upsert, remove, plus the cover variants). The mutex becomes an internal implementation detail; the ~280 ritual sites collapse to plain calls. `store.CoverCache` via `CacheCover`/`RemoveCover` (`covers.go:84–114`) already proves the shape — it is the one deep pocket store has, and the 7 sites that still reach past it into raw `CoverCache` are the counter-example.

**Benefits.** *Locality:* every future locking bug is one file's problem; lock-ordering changes stop being high-risk cross-package edits. *Leverage:* one interface, 9 consumer packages. *Tests:* the interface becomes the test surface — handler tests construct a library instead of mutating package globals, and parallel tests become safe.

---

## 2 · A declarative route table in server.go — **Strong**

**Files:** `server.go` (633 lines · 85 commits · 113 routes) · `internal/handlers/admin.go` · `internal/auth`

**Problem.** 113 routes registered across 98 inline lines of `main()` plus `registerMetadataRoutes`. Gating is real but smeared across three mechanisms and two names for the same gate: `auth.RequireAdmin` (27 routes), the pure alias `handlers.RequireAdmin` (10, `admin.go:14–23`), `adminMethod` (15, metadata routes only), inline method-switches in closures (`server.go:440–468`), and suffix sub-dispatch for `/api/queue/`. Path knowledge also leaks into middleware: the gzip skip-list (`server.go:612–621`), logging's `/api/stats` special case, and a second SPA whitelist inside SpaHandler.

The current per-route auth inventory (36 open / 25 user / 52 admin) took manual cross-referencing to produce — the exact chore the seekify-audit skill repeats on every audit.

**Solution.** One slice of route descriptors — path, verb(s), handler, gating level — with a single registration loop applying the gate. The `handlers.RequireAdmin` alias deletes (its callers are one mechanical edit). Middleware reads path facts from the table instead of hardcoding prefixes.

**Benefits.** *Locality:* auth review becomes reading one table. *Leverage:* method-checking and gating fall out of the same declaration. *Tests:* one table-driven test asserts every mutating route carries a gate — a permanently green check standing in for today's hand-grepped audit.

---

## 3 · Finish the UI extraction — the split files, the unsplit state — **Strong**

**Files:** `js/ui.js` (2092 lines · 61 methods · hottest file in git) · the seven `ui-*` files · `store.js` · `keyboard.js`

**Problem.** The 2026-07-01 extraction moved 170 methods into 7 files but left the coupling: `_viewTrackList` written at 20 sites across 4 files; `_homeLayoutDrag` declared in `ui.js:1710`, consumed only in `ui-settings.js:1571`; `_downloadJobs` written by ui-finder, read by ui.js. The `_`-prefix "private" convention is not a boundary — 8 private methods are called across module lines. The base file still hosts two whole features (metadata-review, ~256 lines; the Workers tab, ~127 lines), **four hand-rolled drag/seek implementations**, and two shadow registries: `_clearPollTimers` (`ui.js:1308`) names every module's timer, and `keyboard._closeTopmost` enumerates every overlay type in the app.

Testability evidence: `scripts/home_discovery_test.mjs` loads ui-home.js by *re-implementing* `_esc` and `_homeDiscoveryScore` rather than loading ui.js — the modules are not independently loadable, so every UI test maintains its own fakes.

FYI: Store also renders DOM (`store.js:107–112` error screen, duplicated in `app.js:82`) — the data layer reaching back into the UI layer.

**Solution.** Complete the move the extraction started: the two stranded features relocate to their owning files; one shared pointer-drag module replaces the four seek/volume/swipe implementations (all the same fraction-of-bar math around `_barFraction`); polls and overlays become registries — each module registers its timer or overlay instead of the base file enumerating them. Store returns errors; app.js renders the error screen.

**Benefits.** *Locality:* adding a poll or overlay touches one file instead of ui.js plus the feature file. *Leverage:* the drag module's interface (a bar element + a fraction callback) serves 5 call sites. *Tests:* modules load under the proven vm/param-shadow harness without duplicate `_esc` fakes, and the drag math gets direct unit tests instead of hiding inside 145-line event closures.

---

## 4 · Make the eight invisible seams visible — **Worth exploring**

**Files:** `server.go:96–103` · `scanner.go:23–28` · `review.go:40` · `downloads.go:275` · `handlers/library.go:14`

**Problem.** Cross-package cycles are broken by **8 nil-able function vars** wired only in `main()`: `downloads.EnrichFunc`; `scanner.WakeReviewWorker`, `InsertUncheckedReviews`, `DeleteReview`, `SetReviewStatus`, `SeedReviewUnchecked`; and two `LibraryVersionAdd` closures. Nothing at a call site says "must be wired"; exactly one is nil-checked in the whole repo (`server.go:190`). Most load-bearing: `LibraryVersion` — the counter every client's library cache depends on — lives in the HTTP package and is bumped by scanner/review through closures. The same cycle forced `writeJSON` to exist twice (`handlers.go:40`, `review.go:42`).

**Solution.** Two small moves: (a) `LibraryVersion` relocates to `store` — it is cache-invalidation state, not HTTP; scanner and review call it directly and both closures delete. (b) The remaining seam wirings collect into one visible wire-up block, so "composition happens here" is a place, not a grep result.

**Benefits.** *Locality:* nil-wire bugs (a feature silently off) become findable in one file. *Tests:* scanner/review tests wire explicit fakes at the same visible seam instead of relying on production `main()` having run. The duplicate `writeJSON` deletes once review can import the shared home.

---

## 5 · Delete the hand-maintained cache-buster ritual — **Strong**

**Files:** `index.html` (138 commits — 65 are bust-only) · `internal/handlers/handlers.go:28–35, 220, 244`

**Problem.** Every JS/CSS edit demands a hand-edited `?v=` bump in index.html: **65 of 138 index.html commits do nothing else**. The ritual is already dead weight — since ff79782 the server stamps an `assetVersion` at process start and `bustAssetVersions` rewrites every `?v=` on serve (`handlers.go:34–35`), so the hand values are overwritten before the browser sees them. The ritual has already failed once: commit d30c53d exists because a missed bump shipped stale JS against a new backend.

**Solution.** Stop hand-maintaining the values; the server owns busting. One verification first: confirm every HTML serving path passes through `bustAssetVersions` (admin.html's inline script was not traced — the exploration's one open edge).

**Benefits.** The deletion test passes literally: removing the ritual removes ~47% of the hottest file's commit traffic and a whole class of "forgot to bump" bug, with zero behavior change once the serving-path check passes.

---

## 6 · The ripper page — ~~Worth exploring~~ **RESOLVED 2026-08-23: removed**

**Status update.** After this report was written, the ripper page was deleted whole (`ripperv2.html`, `js/ripperv2.js`, `css/ripperv2.css`, the `/ripperv2` route, and the ripper-only `/api/v2/*` endpoints). The Critical finding below died with the file — the unsafe `_esc` no longer exists. The Finder is the only rip UI; `parseVideoTitle`/`cleanChannelArtist` (unit-tested) and `EnrichWithPython` remain, now serving the downloads pipeline. Original finding kept for the record:

> **Critical (was: fix now).** ripperv2's local `_esc` (`ripperv2.js:22`) did not escape quotes, yet was interpolated inside double-quoted attributes (`data-artist="' + this._esc(c.artist)` at :382, :516) — artist/title strings arriving from YouTube and Soulseek responses. A name containing `"` would break out of the attribute: markup injection from external data at a trust boundary.
>
> Architecturally: the ripper was both a standalone page (dragging in all 82KB of ui.js just for toasts) and an SPA view, with ui.js reaching into its private `RipperV2._pollTimer` and dispatching into `RipperV2.render`. It also carried a duplicate, null-unguarded `_isQueued` and its own jobs-fetch loop shadowing ui-finder's.

---

## 7 · Player's two overlapping seams — **Speculative**

**Files:** `js/player.js` · `ui-player-chrome.js` (27 raw field reads) · `visualizer.js` (12 reads of `Player.audio`) · `app.js:108–110` · `ui.js` · `keyboard.js` · `ui-context-menus.js`

**Problem.** The queue/player module exposes two seams at once: five nullable callbacks (registered only in app.js) *and* unrestricted raw-state access — 12 files touch `Player.*`, 7 read raw fields, and app.js writes fields directly to prime deep links. The callbacks pass the deletion test (deleting them would spread UI updates across every caller); the raw reads bypass them. One module, two seams — so neither is a real contract. Worth noting: this is also the best-tested module in the frontend (23 vm-harness tests), precisely because tests exercise it through its interface.

**Solution.** Nothing immediately. If touched later: pick one seam — promote the callbacks to the contract (raw readers gain accessor methods) or accept the shared-global model and drop the ceremony. That is a design-it-twice decision, not a drive-by.

**Why only Speculative.** The recent resilience work added guarded load paths and behavior is stable; forcing a single seam now would churn 12 files for no new capability. Recorded so a future review does not re-derive the observation — a candidate ADR if the dual-seam state is intentional.

---

## Top recommendation

Fix card 6's escaping bug first — moot now, since the file was removed.

Then card 1, the Library module. It is the deepest available win: ~280 scattered lock-ritual sites in 9 packages concentrate behind one small interface, the "swap globals under the mutex" test pattern (23 sites) is replaced by constructing a library through the interface, and parallel tests become possible. It also un-blocks cards 2 and 4 — the route table's gating test and the seam-wiring cleanup both get simpler once library state has a module.

Card 3 (UI extraction) is the strongest frontend counterpart but larger; card 5 (cache-buster deletion) is a small, self-contained win to take in between.

**Suggested sequence: 5 → 1 → 2 → 4 → 3 → (7 parked, possibly as an ADR)**

---

*Sources: two read-only exploration passes, 2026-08-23. Counts are static greps unless noted; runtime-unverified items are flagged in the source notes.*

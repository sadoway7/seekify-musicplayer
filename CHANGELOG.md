# Changelog

This project doesn't ship numbered releases. This is a running log of what
changed, grouped by date. The `Looking at` block at the top holds what's on the
radar but not started. Newest entries go at the top of their dated block.

## Looking at

Not promised, not scheduled — just on the radar.

- more visualizer shader looks
- smarter duplicate detection across albums and sources
- lyrics sync in the now-playing view
- stats-driven smart playlists (song-based, genre mixing, preferences, rules)
- rotating mood mix on the home screen
- on-the-fly opus transcode
- Spotify import → finder/autodownloader

## 2026-07-17

- fix: "Needs Review" playlist entry hidden when there are 0 flagged tracks
- fix: artist tracklist filter search centered on desktop (was stretched full-width)
- fix: queue drag item no longer shifts horizontally (removed will-change:transform from queue-panel and now-playing that broke position:fixed coordinates)
- fix: finder type dropdown (Artists/Songs/Albums) replaces hidden mobile chips; gradient kept, dropdown sits above it
- fix: sticky header locked to top on desktop (removed padding-top gap)
- fix: finder tabs/search/results/downloads/bulk/tracklist capped and centered on desktop
- fix: downloads admin buttons use icons (gear/pause/retry) with aria-labels; filter chip hover no longer white-on-green
- fix: finder search history removed; empty state added for first-time use
- fix: finder search tab now shows an empty state ("Find music to rip") instead of blank space when there's no query and no history
- fix: search history stays visible while typing (was disappearing the moment you typed, requiring you to clear the input to re-run a previous search)
- fix: Escape no longer bricks the app after opening the candidate picker — the invisible overlay was left in the DOM swallowing all clicks; now uses the same fade-out removal as the close button
- fix: finder status poll no longer leaks a background timer after navigating away from the finder (was hitting /api/queue/counts every 5-15s forever)
- fix: finder preview audio now stops when navigating away from the finder (was leaving YouTube audio playing in the background with no visible control)
- fix: bulk import button no longer relabels itself to "Import" (losing its icon) after the first run — preserves its original markup
- a11y: icon-only buttons in the finder (pick source, retry, delete, preview, candidate close) now have aria-labels for screen readers
- a11y: touch targets on finder chips, history chips, queue action buttons, watched buttons, and preview button bumped to ≥32-44px
- responsive: downloads admin action buttons now wrap on narrow screens instead of truncating labels; the primary "Retry All" goes full-width on top

- fix: Soulseek candidate selection no longer always fails with "Selected candidate no longer available" — the handler was clearing CandidatesJSON before the selection goroutine read it
- fix: when all download slots are busy, a Soulseek selection now returns to needs_selection with a retry message instead of silently dropping the user's pick (the generic queue would then re-search and auto-pick a different candidate)
- fix: watched-playlist tracks no longer get stuck perpetually "queued" when a download job already exists for that artist+title (marked completed since the existing job covers it)
- fix: /api/track-duration now reports updated:false honestly when the track doesn't exist or already has a duration (was always true)
- fix: /api/v2/resolve-url returns a clear "yt-dlp returned no metadata" 502 on empty output instead of a generic 500 parse error
- fix: "Play Next" no longer offered on the currently-playing track in the queue context menu (was a silent dead click)
- fix: ripper v2 batch URL resolve now has a 20s per-URL timeout so one slow/hung source doesn't freeze the whole batch
- fix: rescan "Find More" no longer collapses distinct releases (singles vs compilations vs remasters) that share the same title+artist; dedup now keys on albumId or title+artist+album
- fix: now-playing swipe-down no longer gets stuck invisible if a second swipe interrupts the first transition (fallback timeout guarantees cleanup)
- fix: context menu centers on-screen when triggered without a position element (keyboard path) instead of falling to the viewport bottom
- fix: per-user favorites and recents no longer orphaned when AutoSort moves a file or dedup merges duplicates (user_favorites/user_recent were missing from the ID-cascade; legacy favorites/recent were migrated but the per-user tables weren't)
- fix: track deletion and orphan cleanup now also clear user_favorites/user_recent (was leaving stale rows that grew the DB unbounded)
- fix: scanner no longer holds the library lock during review inserts — library reads and streaming no longer stall during a scan merge
- fix: cover cache no longer double-counts bytes on overwrite during a scan (was causing premature eviction and extra disk/MusicBrainz fetches)
- fix: session expiry now surfaces a login screen instead of failing personal actions silently (auth-required event was dispatched but never listened for)
- fix: background library poll no longer discards in-progress home search input on every version change
- fix: home menu click listener no longer leaks on every home re-render
- fix: change-password now shows the server's "current password incorrect" message instead of a generic "Failed to update"
- fix: Escape now closes the review dropdown before the review overlay (was leaving the dropdown orphaned open)
- cleanup: removed leftover [recent-debug] and [viz-color] console.log output

- Search: genre cards now pick varied cover art across the grid instead of all showing the same album (most-constrained genres claim first, multi-album genres prefer covers not already used), with a proper Fisher-Yates shuffle replacing the biased sort-based pick.
- Genres: allow a track to have multiple canonical genres (comma-separated) so it appears in every matching genre list; MusicBrainz enrichment and manual edits both store up to three validated genres, and the Search browse grid and genre filter now split multi-genre tracks correctly.
- Tasks: Settings worker "Last run" timestamps now reflect the last meaningful pass, not the last polling tick (scanner and review keep their previous run time when the cycle did no work), and the download-watchdog row no longer shows a disabled "Run Now" button.
- Genres: preserve detailed subgenres while normalizing variants, enrich missing genres through cached, rate-limited MusicBrainz metadata (recording first, then artist fallback), let the edit-metadata modal and Rescan Meta action work on existing approved tracks without writing permanent "none" placeholders, refresh the Search page from live library data so genre cards appear after enrichment, and stop Rescan Meta from overwriting existing metadata/album covers.
- Home: add a subtle diffused lime glow behind the 3D shuffle die without restoring a visible tile or container.
- Home: supersample the 3D shuffle die canvas for smoother anti-aliased edges as it rotates.
- Home: remove the shuffle die's remaining stepped shadow ramps and increase its passive rotation to 2.2× the original speed.
- Home: increase the 3D shuffle die's passive rotation speed without changing its press tumble or drag controls.
- Home: soften the 3D shuffle die's lighting and specular transitions and add subtle dithering, preserving its cartoon character without visible color banding.
- Docker: package the Shuffle All fallback artwork so iPhone and other browsers without an active WebGL renderer never show a broken image.
- Home: replace Shuffle All artwork with a larger, unframed, low-power cel-shaded 3D die that drifts slowly, has concave lime pips, tumbles immediately on press, supports drag rotation, and keeps a static fallback for browsers without WebGL.

## 2026-07-16

- Playback: keep iPhone lock-screen and background audio active when the visualizer routes music through Web Audio, using Safari's playback audio session where supported.
- Visualizer: feed iPhone Safari from the real player audio again, preserving live frequency-band response across song changes and recovering interrupted audio contexts without recreating the player source.

## 2026-07-15

- Unraid: publish an explicit template release date and real interface screenshots so Community Applications can display accurate update and app-detail information.
- Home discovery: keep the rotating Artist and Album showcases artwork-first by omitting entries without usable art; the complete library remains available through See all and Search.
- Security: keep every custom download destination inside the music library (including symlink escapes), require admin access and correct methods for metadata tools, and honor per-track download restrictions.
- Queue controls: Play Next now works from both queue history and upcoming tracks, and queue mutations immediately refresh Now Playing controls and playing-track highlights.
- Finder, Ripper, and Review: only show successful queue additions, recover failed action buttons, prevent Review settings from changing worker state, and fix repeated filters, malformed pagination markup, and artist result counts.
- Interface polish: keyboard playback shortcuts ignore buttons and links, Settings and Review layouts wrap cleanly on phones, and Settings → About links to the public GitHub project.
- Inputs: replace the browser-blue search clear button with a neutral app-styled icon and hover state.
- Metadata rescrape: rank likely original official albums and singles above compilations, live/remix releases, bootlegs, and Various Artists collections.
- Now Playing: reduce the centered action tray and adjacent playlist toggle by 10% on both desktop and mobile.
- Player state: removing the current or final queued track now loads the correct successor or fully clears stale playback UI; volume and mute persist and stay synchronized across every control surface.
- Finder and metadata: stale searches can no longer replace newer results, changing result type always refetches, and metadata Save is protected from duplicate submissions.
- File security: admin list, upload, delete, and create-folder operations now use path-aware library containment and cannot escape into similarly named sibling folders or delete the library root.
- Streaming and sessions: support suffix byte ranges used by media clients, return correct invalid-range metadata, and reduce rolling-session SQLite writes from every request to at most once daily.
- Visualizer: keep the main player on native audio output so enabling visuals cannot alter or stop background playback, and rebind audio analysis when songs change; unsupported capture browsers use decorative mode.
- Downloads: prevent concurrent requests from bypassing limits or duplicate checks, make Resume immediate, and expose the admin Pause/Resume control.
- Home and search: rotate Artists and Albums daily, add full-library links, label quick play, return Albums in search, and show clearer Library filter feedback.
- Playback: keep unavailable-file detection active until audio truly starts, handle autoplay blocking without skipping tracks, and fix repeat-one Next state, shared track links, and cancelled touch seeks.
- UI reliability: load failures now stay visible instead of becoming empty/default states; Settings waits for saved values before rendering workers, and Review bulk actions describe their full scope.
- Library: detect renamed/replaced audio files even when the file count is unchanged, and keep clients updated after later downloads or filesystem changes.
- Reliability: manual workers can no longer start twice or crash the server, and admin log capture is safe during concurrent writes.
- Security: bulk and playlist imports now reject anonymous requests instead of risking a server panic.

## 2026-07-10
- Visualizer: reposition correctly when queue panel opens/closes on desktop at all breakpoints (direct invalidation on toggle + ResizeObserver fallback).
- Admin setting: choose default Now Playing view (visualizer vs album art). Default is album art. Users can still toggle individually; admin default applies until they do.
- Visualizer: throttle render loop to 30fps and cache per-frame layout/property reads — fixes audio stutter, speed drift, and pause hiccups caused by main-thread saturation.
- README and repo polish for the public GitHub mirror.

## 2026-07-09
- first public push to GitHub (`seekify-musicplayer`).

## 2026-06
- early beta. Screenshots in the README are from this point.

# Changelog

This project doesn't ship numbered releases. This is a running log of what
changed, grouped by date. The `Looking at` block at the top holds what's on the
radar but not started. Newest entries go at the top of their dated block.

## Looking at

Not promised, not scheduled — just on the radar.

- more visualizer shader looks
- smarter duplicate detection across albums and sources
- playlist import/export (m3u, xspf)
- lyrics sync in the now-playing view
- a cleaner first-run experience
- stats page (most-played, listening time, 7/30-day rolls)
- smart / auto-playlists by rule
- rotating mood mix on the home screen
- on-the-fly opus transcode
- Spotify import → finder/autodownloader

## 2026-07-17

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

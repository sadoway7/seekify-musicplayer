# Changelog

This project doesn't ship numbered releases. This is a running log of what
changed, grouped by date. The `Unreleased` block at the top holds whatever's in
flight. When a batch goes out, the date gets filled in and a new `Unreleased`
block opens. Newest entries go at the top of their block.

## Unreleased
- Visualizer: reposition correctly when queue panel opens/closes on desktop (ResizeObserver on disc wrapper).
- Admin setting: choose default Now Playing view (visualizer vs album art) for first-time users. Users can still toggle individually.
- Visualizer: throttle render loop to 30fps and cache per-frame layout/property reads — fixes audio stutter, speed drift, and pause hiccups caused by main-thread saturation.
- README and repo polish for the public GitHub mirror.

## 2026-07-09
- first public push to GitHub (`seekify-musicplayer`).

## 2026-06
- early beta. Screenshots in the README are from this point.
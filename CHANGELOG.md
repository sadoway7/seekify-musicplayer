# Changelog

This project doesn't ship numbered releases. This is a running log of what
changed, grouped by date. The `Unreleased` block at the top holds whatever's in
flight. When a batch goes out, the date gets filled in and a new `Unreleased`
block opens. Newest entries go at the top of their block.

## Unreleased

## 2026-07-10
- Visualizer: reposition correctly when queue panel opens/closes on desktop at all breakpoints (direct invalidation on toggle + ResizeObserver fallback).
- Admin setting: choose default Now Playing view (visualizer vs album art). Default is album art. Users can still toggle individually; admin default applies until they do.
- Visualizer: throttle render loop to 30fps and cache per-frame layout/property reads — fixes audio stutter, speed drift, and pause hiccups caused by main-thread saturation.
- README and repo polish for the public GitHub mirror.

## 2026-07-09
- first public push to GitHub (`seekify-musicplayer`).

## 2026-06
- early beta. Screenshots in the README are from this point.
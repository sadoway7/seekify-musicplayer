package main

// Version is the build version. Overridden in CI via
// -ldflags "-X main.Version=0.YYYYMMDD.N" (date + GitHub run number keeps
// it semver-monotonic across same-day pushes — the wails updater compares
// versions and must see every push to main as newer).
// "dev" for local builds.
var Version = "dev"

// UpdateRepository is the GitHub owner/repo the desktop updater polls for
// releases (the public mirror; slug confirmed from the CA template ReadMe
// URL). Overridable via -X main.UpdateRepository=... if it ever moves.
var UpdateRepository = "sadoway7/seekify-musicplayer"

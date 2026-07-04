#!/bin/bash
# Starts Seekify: checks for the helper tools it needs, installs any that are
# missing (best-effort), builds, and runs.
# Run from anywhere — resolves the repo root as this script's parent dir.
cd "$(dirname "$0")/.." || exit 1

echo "Starting Seekify..."

# Install a tool if it isn't already on PATH. Best-effort: needs Homebrew on
# macOS or apt on Linux. If neither is present, we print a hint and move on.
ensure() {
  local cmd="$1" brew_pkg="$2" apt_pkg="$3"
  if command -v "$cmd" >/dev/null 2>&1; then return 0; fi
  echo "  $cmd not found — installing…"
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install "$brew_pkg"
      else
        echo "  Homebrew isn't installed. Get it from https://brew.sh, then run this again."
      fi ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y "$apt_pkg"
      else
        echo "  apt not found — install $cmd with your package manager."
      fi ;;
    *)
      echo "  Not macOS or Linux — install $cmd yourself." ;;
  esac
}

echo "Checking helper tools…"
ensure go go golang-go
ensure yt-dlp yt-dlp yt-dlp
ensure ffmpeg ffmpeg ffmpeg
ensure python3 python3 python3

echo "Building…"
go build -mod=vendor -o server . || { echo "Build failed."; exit 1; }
echo "Running on http://localhost:8081"
./server

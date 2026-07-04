#!/bin/bash
# Double-clickable launcher. Resolves repo root, then runs start.sh there.
cd "$(dirname "$0")/.."
bash scripts/start.sh

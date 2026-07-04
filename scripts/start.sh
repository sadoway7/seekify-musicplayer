#!/bin/bash
# Run from anywhere — resolves the repo root as this script's parent dir.
cd "$(dirname "$0")/.."
echo "Starting Music..."
go build -mod=vendor -o server .
./server

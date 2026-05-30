#!/bin/bash
echo "Starting Music..."
go build -o server server.go scanner.go handlers.go models.go state.go
./server

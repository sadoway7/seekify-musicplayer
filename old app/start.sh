#!/bin/bash
echo "Starting Lynq Inventory..."
go build -o server server.go
./server

#!/bin/bash
echo "Starting Music..."
go build -mod=vendor -o server .
./server

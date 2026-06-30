#!/bin/bash
echo "Stopping Music..."
PID=$(lsof -ti tcp:8081)
if [ -n "$PID" ]; then
  kill $PID
  echo "Stopped server (PID $PID)."
else
  echo "Server is not running."
fi

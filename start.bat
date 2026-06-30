@echo off
echo Starting Music (Windows)...
go build -mod=vendor -o server.exe .
server.exe
pause

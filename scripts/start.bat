@echo off
cd /d "%~dp0\.."
echo Starting Music (Windows)...
go build -mod=vendor -o server.exe .
server.exe
pause

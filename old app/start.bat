@echo off
echo Starting Lynq Inventory (Windows)...
go build -o server.exe server.go
server.exe
pause

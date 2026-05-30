@echo off
echo Starting Music (Windows)...
go build -o server.exe server.go scanner.go handlers.go models.go state.go
server.exe
pause

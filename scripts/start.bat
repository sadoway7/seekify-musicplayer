@echo off
cd /d "%~dp0\.."
echo Starting Seekify (Windows)...

REM --- Helper tools: install anything missing via winget (best-effort) ---
where winget >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo winget not found. Install Go, yt-dlp, ffmpeg, and Python yourself,
  echo then run this again. ^(winget comes with "App Installer" from the Microsoft Store.^)
  goto :build
)

call :ensure go GoLang.Go
call :ensure yt-dlp yt-dlp.yt-dlp
call :ensure ffmpeg Gyan.FFmpeg
call :ensure python Python.Python.3

REM Go is needed to build. If we just installed it, it isn't on PATH yet.
where go >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Go was just installed — close this window and run start.bat again so it's on your PATH.
  pause
  exit /b 0
)

:build
echo Building...
go build -mod=vendor -o server.exe .
if %ERRORLEVEL% NEQ 0 (
  echo Build failed.
  pause
  exit /b 1
)
echo Running on http://localhost:8081
server.exe
pause
exit /b

:ensure
where %1 >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo   %1 not found — installing...
  winget install --id %2 -e --accept-source-agreements --accept-package-agreements
  echo   ^(reopen this window afterwards so Seekify can see %1^)
)
exit /b 0

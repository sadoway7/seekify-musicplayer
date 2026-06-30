@echo off
echo Stopping Music (Windows)...
taskkill /IM server.exe /F >nul 2>&1
if %ERRORLEVEL%==0 (
  echo Stopped server.exe.
) else (
  echo Server is not running.
)
pause

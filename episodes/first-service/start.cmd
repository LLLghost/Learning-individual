@echo off
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.13+ is required. Install it and run this file again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4180 in your browser.
node episodes/first-service/server.mjs
if errorlevel 1 pause

@echo off
title Ludo with Landmines - online
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Download the LTS version from https://nodejs.org , install it, then double-click this file again.
  echo.
  pause
  exit /b
)
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Installing the free Cloudflare tunnel tool - this happens only once...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo  Done. Please CLOSE this window and double-click this file again.
  echo.
  pause
  exit /b
)
start "Ludo server - keep open" cmd /k node server.js
timeout /t 2 >nul
echo.
echo  ==================================================================
echo   Wait a few seconds for a link ending in  .trycloudflare.com
echo   Open THAT link yourself, create a room, and share the invite.
echo   Keep both windows open while you play. Close them to stop.
echo  ==================================================================
echo.
cloudflared tunnel --url http://localhost:3000
pause

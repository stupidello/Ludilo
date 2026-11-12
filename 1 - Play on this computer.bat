@echo off
title Ludo with Landmines - server
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
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause

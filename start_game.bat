@echo off
echo Starting Doom Game Servers...

:: Start Backend Server
start "Game Server (Port 3000)" cmd /k "node server.js"

:: Start Frontend Server
start "Vite Frontend (Port 5173)" cmd /k "npm run dev"

echo.
echo Servers are starting...
echo 1. Keep the two new black windows OPEN.
echo 2. Go to: http://localhost:5173 to play.
echo 3. For LAN, find your IP (ipconfig) and use http://YOUR_IP:5173
echo.
pause

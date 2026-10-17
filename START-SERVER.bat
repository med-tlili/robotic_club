@echo off
title ISIGK Robotics Club - Server
cd /d "%~dp0platform\server"
echo ============================================================
echo    ISIGK Robotics Club - SERVER (this PC hosts the site)
echo.
echo    Members of the club open the address printed below
echo    in their browser (same WiFi/network as this PC).
echo.
echo    Keep this window open while they use the site.
echo    Press Ctrl+C or close it to stop.
echo ============================================================
echo.
if not exist node_modules (
  echo First run - installing dependencies, please wait...
  call npm install
)
npm start
pause

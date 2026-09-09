@echo off
title OneBrain
cd /d "%~dp0frontend"

if not exist "node_modules\.bin" (
  echo First run: installing dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Install failed. Make sure Node.js is installed, then double-click again.
    pause
    exit /b 1
  )
)

echo.
echo  Starting OneBrain at http://localhost:3000
echo  FIRST TIME OR SEEING A BROKEN PAGE? Hard-refresh: Ctrl+Shift+R
echo  (or open in an Incognito window)
echo  Close this window or press Ctrl+C to stop the server.
echo.
if exist ".next" rmdir /s /q ".next"
call npm run dev
echo.
echo Server stopped (or failed to start - see error above).
pause

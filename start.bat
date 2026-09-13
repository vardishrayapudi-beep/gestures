@echo off
cd /d "%~dp0"
where node >nul 2>&1
if %errorlevel%==0 (
  start "Medication Gesture Server" cmd /k "cd /d %~dp0 && node server.js"
) else (
  where py >nul 2>&1
  if %errorlevel%==0 (
    start "Medication Gesture Server" cmd /k "cd /d %~dp0 && py -m http.server 5500"
  ) else (
    start "Medication Gesture Server" cmd /k "cd /d %~dp0 && python -m http.server 5500"
  )
)
timeout /t 1 /nobreak >nul
start "Medication Gesture Verification" http://localhost:5500

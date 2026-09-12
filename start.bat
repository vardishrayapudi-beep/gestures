@echo off
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  start "Medication Gesture Server" cmd /k "cd /d %~dp0 && py -m http.server 8000"
) else (
  start "Medication Gesture Server" cmd /k "cd /d %~dp0 && python -m http.server 8000"
)
timeout /t 1 /nobreak >nul
start "Medication Gesture Verification" http://localhost:8000

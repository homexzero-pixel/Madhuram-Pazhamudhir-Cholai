@echo off
rem Opens the REAL store database. Keep this window open while the shop is billing.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run Setup_Windows.bat first.
  pause
  exit /b 1
)
set MPC_MODE=store
title Madhuram STORE - keep this window open
start "" cmd /c "timeout /t 4 >nul & (start msedge --app=http://127.0.0.1:8765/billing/ || start http://127.0.0.1:8765/billing/)"
.venv\Scripts\python.exe manage.py serve --port 8765 --no-browser
pause

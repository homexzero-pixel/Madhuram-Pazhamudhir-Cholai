@echo off
rem Opens the PRACTICE database (separate file). Nothing here touches the real store.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Run Setup_Windows.bat first.
  pause
  exit /b 1
)
set MPC_MODE=demo
rem Use the bundled practice database the first time, if the download includes one.
if not exist "%LOCALAPPDATA%\MadhuramPOS\demo\madhuram.sqlite3" if exist practice_database\madhuram.sqlite3 (
  mkdir "%LOCALAPPDATA%\MadhuramPOS\demo" 2>nul
  copy practice_database\madhuram.sqlite3 "%LOCALAPPDATA%\MadhuramPOS\demo\madhuram.sqlite3" >nul
)
title Madhuram PRACTICE
.venv\Scripts\python.exe manage.py migrate -v0
.venv\Scripts\python.exe manage.py shell -c "from accounts.models import User; import sys; sys.exit(0 if User.objects.exists() else 3)"
if errorlevel 3 (
  echo Building practice data - about 30 seconds the first time...
  .venv\Scripts\python.exe manage.py seed_demo
)
start "" cmd /c "timeout /t 4 >nul & (start msedge --app=http://127.0.0.1:8766/ || start http://127.0.0.1:8766/)"
.venv\Scripts\python.exe manage.py serve --port 8766 --no-browser
pause

@echo off
rem Madhuram store system - one-time setup on the counter PC.
rem Needs Python 3.10 or newer from python.org (tick "Add python.exe to PATH" and "py launcher").
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.12 from https://www.python.org/downloads/windows/ and run this again.
  pause
  exit /b 1
)
if not exist .venv (
  echo Creating the program environment...
  py -3 -m venv .venv || goto failed
)
call .venv\Scripts\activate.bat
if exist wheels (
  echo Installing from the bundled wheels folder - no internet needed...
  python -m pip install --no-index --find-links wheels -r requirements.txt || goto failed
) else (
  echo Installing from the internet...
  python -m pip install -r requirements.txt || goto failed
)
python manage.py migrate || goto failed
set MPC_MODE=demo
python manage.py migrate || goto failed
echo.
echo Setup finished.
echo   1. Run Create_Owner.bat once to create the owner login for the real store.
echo   2. Run Try_Demo.bat to practise, or Start_Store.bat to open the real store.
if not defined MPC_NOPAUSE pause
exit /b 0
:failed
echo Setup failed. Take a photo of this window for support.
pause
exit /b 1

@echo off
rem Makes a checked backup of the REAL store database on this PC AND in Google Drive, then shows what it contains.
cd /d "%~dp0"
set MPC_MODE=store
.venv\Scripts\python.exe manage.py auto_backup --label now
.venv\Scripts\python.exe manage.py verify_backup --latest
echo Backups on this PC: %LOCALAPPDATA%\MadhuramPOS\store\backups
echo Backups in Google Drive: My Drive\Madhuram backups\store
pause

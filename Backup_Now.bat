@echo off
rem Makes a checked backup of the REAL store database and shows what it contains.
cd /d "%~dp0"
set MPC_MODE=store
.venv\Scripts\python.exe manage.py verify_backup
echo Backups are in %LOCALAPPDATA%\MadhuramPOS\store\backups
pause

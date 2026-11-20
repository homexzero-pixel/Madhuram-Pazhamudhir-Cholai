@echo off
rem Restores a backup into the REAL store database. Close Start_Store.bat first.
cd /d "%~dp0"
set MPC_MODE=store
set /p FILE=Drag the backup file into this window and press Enter: 
.venv\Scripts\python.exe manage.py restore_backup %FILE%
pause

@echo off
rem Creates the first owner login for the REAL store database.
cd /d "%~dp0"
set MPC_MODE=store
.venv\Scripts\python.exe manage.py migrate -v0
.venv\Scripts\python.exe manage.py reset_owner
pause

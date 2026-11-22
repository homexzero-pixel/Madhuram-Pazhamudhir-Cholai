@echo off
rem Forgot the owner password? Double-click this on the shop PC to set a new password and PIN (typing is visible).
cd /d "%~dp0"
title Madhuram - reset owner password
set MPC_MODE=store
.venv\Scripts\python.exe manage.py reset_owner
echo.
pause

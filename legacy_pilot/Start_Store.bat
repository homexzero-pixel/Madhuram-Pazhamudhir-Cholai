@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto pythonfallback
py -3 counter.py
if errorlevel 1 pause
exit /b
:pythonfallback
python counter.py
if errorlevel 1 pause

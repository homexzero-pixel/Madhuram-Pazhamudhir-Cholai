@echo off
rem Copies products, barcodes, stock, bills and shifts from the earlier pilot counter (counter.sqlite).
cd /d "%~dp0"
set MPC_MODE=store
set PILOT=%LOCALAPPDATA%\MadhuramPOS\store\counter.sqlite
if not exist "%PILOT%" set /p PILOT=Pilot database not found at the usual place. Drag counter.sqlite here and press Enter: 
.venv\Scripts\python.exe manage.py migrate -v0
.venv\Scripts\python.exe manage.py import_pilot "%PILOT%" --dry-run
set /p OK=Import this for real? Type YES: 
if /i "%OK%"=="YES" .venv\Scripts\python.exe manage.py import_pilot "%PILOT%"
pause

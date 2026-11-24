@echo off
rem Makes madhuram_cloud_export.json.gz on the desktop for the cloud edition (Settings ^& backup - Bring data from the shop PC).
cd /d "%~dp0"
set MPC_MODE=store
.venv\Scripts\python.exe manage.py export_for_cloud
echo.
echo Now open the cloud store, log in as owner, go to Settings ^& backup and choose this file.
pause

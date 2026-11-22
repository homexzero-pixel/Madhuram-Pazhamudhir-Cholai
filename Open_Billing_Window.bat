@echo off
rem Opens the billing window (Microsoft Edge in app mode) a few seconds after the store starts.
rem --kiosk-printing: every bill prints straight to the Windows DEFAULT printer (the thermal printer), no print dialog.
rem A separate Edge profile is used so these settings always apply, even if Edge is already open for other work.
timeout /t 4 >nul
set "PROFILE=%LOCALAPPDATA%\MadhuramPOS\edge-billing"
start "" msedge --app=http://127.0.0.1:%1/billing/ --kiosk-printing --no-first-run --user-data-dir="%PROFILE%"
if errorlevel 1 start "" http://127.0.0.1:%1/billing/
exit /b 0

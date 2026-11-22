@echo off
rem DOUBLE BACKUP SETUP: 1) on this PC  2) in Google Drive (free, 15 GB).
rem Finds Google Drive for desktop, installs it if missing, makes a nightly 21:30 backup task,
rem then makes and checks the first double backup.
cd /d "%~dp0"
title Madhuram - backup setup
set MPC_MODE=store
echo.
echo  Madhuram - setting up the two automatic backups
echo  -----------------------------------------------
.venv\Scripts\python.exe -c "import django,os;os.environ.setdefault('DJANGO_SETTINGS_MODULE','cholai.settings');django.setup();from core.backup import detect_google_drive as d;import sys;sys.exit(0 if d() else 4)"
if errorlevel 4 (
  echo  Google Drive for desktop is not installed or not signed in.
  choice /C YN /M "  Install Google Drive for desktop now (free, from Google)"
  if not errorlevel 2 (
    winget install -e --id Google.GoogleDrive --accept-package-agreements --accept-source-agreements
    echo.
    echo  NOW: open Google Drive from the Start menu, sign in with the SHOP's Google account,
    echo  wait until a "Google Drive (G:)" drive appears in File Explorer, then press any key.
    pause
  )
)
.venv\Scripts\python.exe manage.py setup_backups
echo.
echo  Creating the nightly backup task (every day 21:30, or at the next switch-on if the PC was off)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$a=New-ScheduledTaskAction -Execute '%~dp0.venv\Scripts\pythonw.exe' -Argument 'manage.py auto_backup' -WorkingDirectory '%~dp0';" ^
  "$t=New-ScheduledTaskTrigger -Daily -At 21:30;" ^
  "$s=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30);" ^
  "Register-ScheduledTask -TaskName 'Madhuram Nightly Backup' -Action $a -Trigger $t -Settings $s -Force | Out-Null; 'Nightly task: OK'"
echo.
echo  Done. Check anytime: Store app - Settings - Backups (both cards should be green).
if not defined MPC_NOPAUSE pause
exit /b 0

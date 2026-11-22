@echo off
rem ONE-CLICK UPDATE of the Madhuram store system.
rem  1. Download the new Madhuram_Store_System.zip into Downloads (no need to unzip).
rem  2. Double-click "Madhuram Update" on the desktop (this file).
rem It closes the store, makes both backups, saves the current program, installs the new one, checks it and
rem starts the store again. If anything fails, the previous program and data are put back automatically.
rem You can also drag a ZIP onto this file, or run this file from an unzipped new version.
setlocal
cd /d "%~dp0"
title Madhuram - program update
if not exist "%~dp0scripts\updater.py" (
  echo  Unzip the update first: right-click the ZIP, Extract All, then run Update_Madhuram.bat inside it.
  pause
  exit /b 1
)
where py >nul 2>nul
if errorlevel 1 (
  echo  Python was not found. Run Install_Madhuram.bat first.
  pause
  exit /b 1
)
copy /y "%~dp0scripts\updater.py" "%TEMP%\madhuram_updater.py" >nul
rem The rest is on ONE line on purpose: this file itself may be replaced during the update.
py -3 "%TEMP%\madhuram_updater.py" --here "%~dp0." %* & echo. & pause & exit /b

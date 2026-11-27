@echo off
rem ONE-CLICK INSTALL for the Madhuram store system on the counter PC.
rem Installs Python if missing, sets up the program, asks for the owner login,
rem sets up backups on this PC + Google Drive, adds desktop shortcuts, starts automatically with Windows, and opens the store.
cd /d "%~dp0"
title Madhuram - installing
echo.
echo  Madhuram Pazhamudhir Solai - store system installer
echo  ----------------------------------------------------
where py >nul 2>nul
if errorlevel 1 (
  echo  Python not found. Installing Python 3.12 with winget...
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  if errorlevel 1 (
    echo  Could not install Python automatically.
    echo  Install it from https://www.python.org/downloads/windows/ ^(tick "Add python.exe to PATH"^) and run this again.
    pause
    exit /b 1
  )
  echo  Python installed. Close this window and double-click Install_Madhuram.bat again.
  pause
  exit /b 0
)
set MPC_NOPAUSE=1
call Setup_Windows.bat
if errorlevel 1 exit /b 1
set MPC_MODE=store
.venv\Scripts\python.exe manage.py shell -c "from accounts.models import User; import sys; sys.exit(0 if User.objects.filter(is_active=True).exists() else 3)"
if errorlevel 3 (
  echo.
  echo  Create the OWNER login now.
  .venv\Scripts\python.exe manage.py reset_owner
)
echo.
echo  Setting up the two automatic backups (this PC + Google Drive)...
call Setup_Backups.bat
echo  Adding shortcuts...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell; $d=[Environment]::GetFolderPath('Desktop'); $s=[Environment]::GetFolderPath('Startup');" ^
  "foreach($p in @(@($d,'Madhuram Store','Start_Store.bat'),@($d,'Madhuram Practice','Try_Demo.bat'),@($d,'Madhuram Backup Now','Backup_Now.bat'),@($d,'Madhuram Update','Update_Madhuram.bat'),@($s,'Madhuram Store','Start_Store.bat'))){" ^
  "$l=$w.CreateShortcut((Join-Path $p[0] ($p[1]+'.lnk'))); $l.TargetPath=(Join-Path '%~dp0' $p[2]); $l.WorkingDirectory='%~dp0'; $l.WindowStyle=7; $l.Save()}"
echo.
echo  Installed. Desktop shortcuts: "Madhuram Store", "Madhuram Practice", "Madhuram Backup Now", "Madhuram Update".
echo  The store also starts by itself when Windows starts.
echo  Opening the store now...
start "" Start_Store.bat
exit /b 0

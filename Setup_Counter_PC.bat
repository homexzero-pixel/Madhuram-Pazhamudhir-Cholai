@echo off
rem Run on each EXTRA counter PC (Counter 2, 3, 4...). Nothing is installed: the billing window opens the shop server.
rem Only this file is needed on the counter PC.
title Madhuram - counter PC setup
echo.
echo  Madhuram - set up this PC as a billing counter
echo  ---------------------------------------------
set /p SERVER= Shop server address (the number shown by Setup_Shop_Server, e.g. 192.168.1.20): 
set /p NUM= Counter number for THIS PC (2, 3, 4, 5, 6 ...): 
set "URL=http://%SERVER%:8765/counter/%NUM%/"
set "PROFILE=%LOCALAPPDATA%\MadhuramPOS\edge-counter"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Startup'))){" ^
  "$e=(Get-Command msedge -ErrorAction SilentlyContinue).Source; if(-not $e){$e='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'};" ^
  "$l=$w.CreateShortcut((Join-Path $d 'Madhuram Counter %NUM%.lnk')); $l.TargetPath=$e;" ^
  "$l.Arguments='--app=\"%URL%\" --kiosk-printing --no-first-run --user-data-dir=\"%PROFILE%\"'; $l.Save()}"
echo.
echo  Done. Desktop shortcut: "Madhuram Counter %NUM%" (it also opens when Windows starts).
echo  Make this PC's receipt printer the Windows DEFAULT printer - bills print to it straight away.
echo  Opening the billing window now...
start "" msedge --app="%URL%" --kiosk-printing --no-first-run --user-data-dir="%PROFILE%"
pause

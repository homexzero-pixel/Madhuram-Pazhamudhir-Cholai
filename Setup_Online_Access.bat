@echo off
rem Run ONCE on the shop server PC to make the store reachable from the internet through a free Cloudflare Tunnel:
rem the owner opens it from home / mobile, and customers order online. No router changes, no fixed IP needed.
rem Before this: create the tunnel in the Cloudflare dashboard and copy its token (see docs\MULTI_COUNTER_AND_ONLINE.md).
cd /d "%~dp0"
title Madhuram - online access
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo  Installing Cloudflare's tunnel program (free)...
  winget install -e --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
)
echo.
set /p TOKEN= Paste the tunnel token from the Cloudflare dashboard (right-click to paste) and press Enter: 
if "%TOKEN%"=="" (
  echo  No token entered. Nothing was changed.
  pause
  exit /b 1
)
echo  Installing the tunnel as a Windows service (Windows asks for permission - click Yes)...
powershell -NoProfile -Command "$c=(Get-Command cloudflared -ErrorAction SilentlyContinue).Source; if(-not $c){$c='C:\Program Files (x86)\cloudflared\cloudflared.exe'}; Start-Process $c -Verb RunAs -Wait -ArgumentList 'service','install','%TOKEN%'"
echo.
echo  Done. The tunnel starts with Windows. Now in the store: Settings - Counters ^& online shop:
echo    Public web address = https://your.address  (the one you chose in Cloudflare), then restart Madhuram Store.
echo  Test from your mobile phone using mobile data (not the shop Wi-Fi).
pause

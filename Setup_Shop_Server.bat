@echo off
rem Run ONCE on the PC that keeps the database (the "shop server" - usually Counter 1).
rem Lets the other counter PCs on the shop Wi-Fi / network open the store, and shows the address they need.
cd /d "%~dp0"
title Madhuram - shop server setup
echo.
echo  Allowing the other counter PCs to connect (Windows asks for permission - click Yes)...
powershell -NoProfile -Command "Start-Process netsh -Verb RunAs -Wait -ArgumentList 'advfirewall firewall add rule name=\"Madhuram store\" dir=in action=allow protocol=TCP localport=8765 profile=private,domain'"
echo.
echo  This PC's address on the shop network (write it down):
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { '      http://' + $_.IPAddress + ':8765   (' + $_.InterfaceAlias + ')' }"
echo.
echo  Next:
echo   1. Keep "Madhuram Store" running on THIS PC whenever the shop is open.
echo   2. On every other counter PC, copy Setup_Counter_PC.bat and run it. Type the number above (e.g. 192.168.1.20).
echo   3. Ask whoever set up your Wi-Fi router to give THIS PC a fixed address (DHCP reservation), so it never changes.
echo   4. Windows Settings - Network: set the shop network to "Private".
pause

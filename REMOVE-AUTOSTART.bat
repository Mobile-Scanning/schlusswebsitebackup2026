@echo off
title SCHLUSS - stop running by itself
cd /d "%~dp0"
echo.
echo  Stopping the SCHLUSS website and removing it from Windows start-up...
echo.
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\SCHLUSS website.vbs"
if exist "%VBS%" del "%VBS%"
rem Stop the background runner first (so it does not restart the website), then the website itself.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*START-BACKGROUND.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":4200 .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
echo  Done. The website no longer runs by itself.
echo  Your data is untouched. Use START.bat when you want to run it, or INSTALL-AUTOSTART.bat to switch this back on.
echo.
pause

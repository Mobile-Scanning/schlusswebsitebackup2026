@echo off
title SCHLUSS backup
cd /d "%~dp0"
echo.
echo  SCHLUSS - backing up your database and uploaded files...
echo.
if not exist "server\cli\backup.cjs" (
  echo  This folder does not have the backup tool yet.
  echo  Put BACKUP.bat inside the SCHLUSS project folder of version 10.8 or newer ^(the folder that contains package.json^).
  echo.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo  Installing packages first ^(one time^)...
  call npm install
)
call npm run backup
echo.
if errorlevel 1 (
  echo  The backup did NOT complete. Make sure MySQL is running, then try again.
) else (
  echo  Done. Your backup is in the "backups" folder next to this file.
  echo  Copy that folder to a USB stick or OneDrive as well.
  start "" "%~dp0backups"
)
echo.
pause

@echo off
rem Runs the SCHLUSS website quietly in the background and keeps it running.
rem Started automatically when you sign in to Windows (after INSTALL-AUTOSTART.bat). You never need to run this yourself.
title SCHLUSS-background
cd /d "%~dp0"
set PORT=4200
if not exist "storage" mkdir "storage"
if not exist "storage\logs" mkdir "storage\logs"

:check
node server\cli\is-running.cjs >nul 2>nul
if not errorlevel 1 exit /b 0

:database
echo [%date% %time%] checking database >> "storage\logs\website.log"
call npm run db:migrate >> "storage\logs\website.log" 2>&1
if not errorlevel 1 goto run
rem The database is not up yet (for example straight after switching the computer on) - try again shortly.
ping -n 11 127.0.0.1 >nul
goto database

:run
echo [%date% %time%] starting website >> "storage\logs\website.log"
node dist\schluss\server\server.mjs >> "storage\logs\website.log" 2>&1
echo [%date% %time%] website stopped - restarting >> "storage\logs\website.log"
ping -n 6 127.0.0.1 >nul
goto check

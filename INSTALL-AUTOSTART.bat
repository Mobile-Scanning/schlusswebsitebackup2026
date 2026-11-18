@echo off
title SCHLUSS - set the website to run by itself
cd /d "%~dp0"
echo.
echo  This sets the SCHLUSS website to run by itself in the background,
echo  now and every time you sign in to Windows.
echo  After this, double-clicking index.html just opens the website.
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist ".env" goto noenv

rem If it is already running in another window, that window has to be closed first.
if exist "node_modules\express" node server\cli\is-running.cjs >nul 2>nul
if exist "node_modules\express" if not errorlevel 1 goto alreadyrunning

if exist "node_modules\express" goto havepackages
echo  Installing packages - first time only, a few minutes...
call npm install
if errorlevel 1 goto failinstall
:havepackages

if exist "dist\schluss\server\server.mjs" goto havebuild
echo  Building the website - first time only, a few minutes...
call npm run build
if errorlevel 1 goto failbuild
:havebuild

echo  Checking the database...
call npm run db:migrate >"%TEMP%\schluss-migrate.log" 2>&1
if errorlevel 1 goto faildb

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\SCHLUSS website.vbs"
if not exist "%STARTUP%" mkdir "%STARTUP%"
echo ' Starts the SCHLUSS website quietly when you sign in to Windows. Delete this file to stop that.> "%VBS%"
echo Set sh = CreateObject("WScript.Shell")>> "%VBS%"
echo sh.CurrentDirectory = "%~dp0">> "%VBS%"
echo sh.Run "cmd /c START-BACKGROUND.bat", 0, False>> "%VBS%"
if not exist "%VBS%" goto failstartup

echo  Starting the website in the background...
wscript "%VBS%"

set TRIES=0
:waitup
node server\cli\is-running.cjs >nul 2>nul
if not errorlevel 1 goto up
set /a TRIES+=1
if %TRIES% GEQ 30 goto failup
ping -n 3 127.0.0.1 >nul
goto waitup

:up
echo.
echo  Done. The website is running at http://localhost:4200
echo  It now starts by itself whenever you sign in to Windows - there is no window to keep open.
echo  From now on just double-click index.html.
echo.
echo  To stop this later, double-click REMOVE-AUTOSTART.bat.
echo.
start "" "http://localhost:4200/"
pause
exit /b 0

:alreadyrunning
echo  The website is already running in another window on this computer
echo  - the one where you typed "npm start", or the black START.bat window.
echo  Close that window first, then double-click INSTALL-AUTOSTART.bat again.
goto end
:nonode
echo  Node.js is not installed on this computer.
echo  Install the LTS version from https://nodejs.org and run this again.
goto end
:noenv
echo  The settings file .env is missing from this folder. Copy your .env here and run this again.
goto end
:failinstall
echo  The packages could not be installed. Check the internet connection and run this again.
goto end
:failbuild
echo  The website could not be built. Send a photo of this window for help.
goto end
:faildb
echo  The database could not be reached. Make sure MySQL is running and the DB_ lines in .env are correct.
echo.
type "%TEMP%\schluss-migrate.log"
goto end
:failstartup
echo  The start-up entry could not be created in:
echo    %STARTUP%
goto end
:failup
echo  The website did not start within a minute. The reason is at the end of this file:
echo    %~dp0storage\logs\website.log
goto end
:end
echo.
pause
exit /b 1

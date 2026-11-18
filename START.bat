@echo off
title SCHLUSS website - keep this window open
cd /d "%~dp0"
echo.
echo  Starting the SCHLUSS website...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed on this computer.
  echo  Install the LTS version from https://nodejs.org and double-click START.bat again.
  echo.
  pause
  exit /b 1
)
if not exist ".env" (
  echo  The settings file .env is missing from this folder.
  echo  Copy your .env file into this folder and double-click START.bat again.
  echo.
  pause
  exit /b 1
)
rem Already running? Then just open it.
node server\cli\is-running.cjs >nul 2>nul
if not errorlevel 1 (
  echo  The website is already running. Opening it...
  start "" "http://localhost:4200/"
  timeout /t 3 >nul
  exit /b 0
)
if not exist "node_modules\express" (
  echo  Installing packages ^(first time only, a few minutes^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo  The packages could not be installed. Check the internet connection and try again.
    pause
    exit /b 1
  )
)
if not exist "dist\schluss\server\server.mjs" (
  echo  Building the website ^(first time only, a few minutes^)...
  call npm run build
  if errorlevel 1 (
    echo.
    echo  The website could not be built. Send a photo of this window for help.
    pause
    exit /b 1
  )
)
echo  Checking the database...
call npm run db:migrate >"%TEMP%\schluss-migrate.log" 2>&1
if errorlevel 1 (
  echo.
  echo  The database could not be reached. Make sure MySQL is running on this computer
  echo  and that the DB_ lines in .env are correct, then double-click START.bat again.
  echo.
  type "%TEMP%\schluss-migrate.log"
  echo.
  pause
  exit /b 1
)
set PORT=4200
echo.
echo  The website is starting at http://localhost:4200
echo  KEEP THIS WINDOW OPEN while you use the website. Close it to stop the website.
echo.
start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:4200/"
node dist\schluss\server\server.mjs
echo.
echo  The website has stopped.
pause

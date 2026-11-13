@echo off
rem ---------------------------------------------------------------------------
rem  The Midnight Gate - double-click this file to open the board.
rem
rem  It finds Node.js, starts the BBS, and opens your browser at the web
rem  terminal. The telnet port is started at the same time. Close this window or
rem  press Ctrl-C to shut the board down.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"
title The Midnight Gate BBS

set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  echo.
  echo   Node.js was not found on this PC.
  echo.
  echo   Install Node.js 18 or newer from https://nodejs.org/
  echo   then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo            T H E   M I D N I G H T   G A T E
echo   ============================================
echo.
echo   Starting the board. Your browser will open when
echo   the line is up. Press Ctrl-C here to hang up.
echo.

start "" /min "%NODE%" "tools\open-board.js"
"%NODE%" server.js
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
  echo   The board stopped unexpectedly ^(exit code %CODE%^).
  echo   Check the messages above before closing this window.
) else (
  echo   The board has shut down.
)
echo.
pause

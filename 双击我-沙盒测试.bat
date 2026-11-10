@echo off
chcp 65001 >nul
title FocusCET - Sandbox
cd /d "%~dp0"
node build\dev.js --sandbox %*
if errorlevel 1 (
  echo.
  echo [ERROR] above is the reason. press any key to close.
  pause >nul
)

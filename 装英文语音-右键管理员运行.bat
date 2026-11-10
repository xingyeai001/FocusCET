@echo off
setlocal
title Install English (US) voice for CET app
echo.
echo   Downloading the English (US) speech package, about 20 MB.
echo   This window must run as administrator.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-WindowsCapability -Online -Name Language.TextToSpeech~~~en-US~0.0.1.0"
echo.
echo   Done. Go back to the app - Settings - Word pronunciation - Test.
echo   If it still says no English voice, open Windows Settings - Time and language - Speech.
echo.
pause

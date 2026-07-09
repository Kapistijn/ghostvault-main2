@echo off
title GhostVault - Stopping...
cd /d "%~dp0"

echo ========================================
echo   GhostVault - Stop
echo ========================================
echo.

echo [STOP] Stopping GhostVault...
taskkill /F /IM node.exe >nul 2>nul
if errorlevel 1 (
    echo [INFO] Geen GhostVault processen gevonden
) else (
    echo [OK] GhostVault gestopt
)
echo.
pause

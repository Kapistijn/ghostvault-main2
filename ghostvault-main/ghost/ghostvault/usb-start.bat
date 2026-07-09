@echo off
title GhostVault - USB Portable Start
cd /d "%~dp0"

echo ========================================
echo   GhostVault - USB Portable
echo ========================================
echo.
echo [LOG] Start tijd: %date% %time%
echo [LOG] Start directory: %cd%
echo.

REM Set up temp directory on USB
set "TEMP_DIR=%~dp0ghostvault_temp"
if not exist "%TEMP_DIR%" (
    echo [SETUP] Creating temp directory on USB...
    mkdir "%TEMP_DIR%"
)
echo [INFO] Using temp directory: %TEMP_DIR%
echo [INFO] Temp files will persist for faster startup

REM Read version from package.json
set "APP_VERSION=2.5"
set "APP_LOGS_DIR=%TEMP_DIR%\app logs"

if exist "package.json" (
    REM Try to read version from package.json using PowerShell
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content 'package.json' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }"') do (
        if not "%%v"=="" set "APP_VERSION=%%v"
    )
)

REM Set up app logs directory
if not exist "%APP_LOGS_DIR%" (
    mkdir "%APP_LOGS_DIR%"
)
echo [INFO] App logs directory: %APP_LOGS_DIR%
echo [DEBUG] Logs komen in: %APP_LOGS_DIR%\ghostvault_%APP_VERSION%
echo [DEBUG] App versie: %APP_VERSION%

REM Set environment variables to use USB temp
set TEMP=%TEMP_DIR%
set TMP=%TEMP_DIR%
set NODE_ENV=production

REM Check for updates - read version from package.json
set "USB_PATH=%~dp0"
set "INSTALL_PATH=%~dp0"

if exist "%INSTALL_PATH%\package.json" (
    REM Try to read version from package.json using PowerShell
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content 'package.json' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }"') do (
        if not "%%v"=="" set "INSTALLED_VERSION=%%v"
    )
    if defined INSTALLED_VERSION (
        echo [INFO] Geïnstalleerde versie: %INSTALLED_VERSION%
    ) else (
        echo [INFO] Geen versie info gevonden in package.json
    )
) else (
    echo [INFO] Geen package.json gevonden
)

echo.

REM Check if Node.js is in current directory
if exist "node.exe" (
    echo [OK] Using portable Node.js (local)
    set PATH=%~dp0;%PATH%
) else if exist "..\node.exe" (
    echo [OK] Using portable Node.js (parent)
    set PATH=%~dp0..;%PATH%
) else (
    REM Check if Node.js is installed on system
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Node.js not found!
        echo.
        echo Please place node.exe in this directory or parent directory for portable use,
        echo or install Node.js from https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
    echo [OK] Using system Node.js
)

node --version
echo.

REM Check if dependencies are installed
cd apps\web
if not exist "node_modules" (
    echo [SETUP] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies already installed
)
cd ..

REM Core is now embedded in web app, no separate core build needed
echo [INFO] Core library is embedded in web app

echo.
echo [START] Starting GhostVault (USB Portable)...
echo [INFO] All temporary files will be stored on USB
echo [INFO] Temp files persist for faster startup on next run
echo.

REM Start the development server
cd apps\web
start "" cmd /k "set APP_LOGS_DIR=%APP_LOGS_DIR% && set APP_VERSION=%APP_VERSION% && npm run dev"

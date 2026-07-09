@echo off
title GhostVault - Starting...
cd /d "%~dp0"

echo ========================================
echo   GhostVault - Start
echo ========================================
echo.
echo [LOG] Start tijd: %date% %time%
echo [LOG] Start directory: %cd%
echo.

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

REM Check if Node.js is installed
if exist "node.exe" (
    echo [OK] Using portable Node.js (local)
    set PATH=%~dp0;%PATH%
) else if exist "..\node.exe" (
    echo [OK] Using portable Node.js (parent)
    set PATH=%~dp0..;%PATH%
) else (
    where node >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERROR] Node.js is not installed!
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
echo [START] Starting GhostVault...
echo.

REM Start the development server
cd apps\web

REM Read version from package.json
set "APP_VERSION=2.5"
set "APP_LOGS_DIR=C:\ghostvault-main\ghost\ghostvault_temp\app logs"

if exist "..\package.json" (
    REM Try to read version from package.json using PowerShell
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '..\package.json' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }"') do (
        if not "%%v"=="" set "APP_VERSION=%%v"
    )
)

if not exist "%APP_LOGS_DIR%" (
    mkdir "%APP_LOGS_DIR%"
)
echo [DEBUG] Logs komen in: %APP_LOGS_DIR%\ghostvault_%APP_VERSION%
echo [DEBUG] App versie: %APP_VERSION%
start "" cmd /k "set APP_LOGS_DIR=%APP_LOGS_DIR% && set APP_VERSION=%APP_VERSION% && npm run dev"

REM Create desktop shortcut
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\GhostVault.lnk"
if not exist "%SHORTCUT_PATH%" (
    echo [SETUP] Creating desktop shortcut...
    powershell -NoProfile -Command "try { $ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%~dp0start.bat'; $s.WorkingDirectory = '%~dp0'; $s.Save(); exit 0 } catch { exit 1 }" >nul 2>nul
    if errorlevel 1 (
        echo [WARN] Kon desktop shortcut niet maken (mogelijk geen permissies)
    ) else (
        echo [OK] Desktop shortcut created
    )
)

REM Wait for server to start
timeout /t 5 /nobreak >nul

REM Open browser
echo [INFO] Opening GhostVault in browser...
start http://localhost:3000

echo [INFO] GhostVault is running at http://localhost:3000
echo [INFO] Press Ctrl+C in the server window to stop
echo.
pause

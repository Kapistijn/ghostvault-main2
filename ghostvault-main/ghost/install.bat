@echo off
setlocal enabledelayedexpansion
title GhostVault - Setup Menu v2

:: Config
set "INSTALL_PATH=C:\ghostvault"
set "USB_PATH=%~dp0"
:: Remove trailing backslash
if "%USB_PATH:~-1%"=="\" set "USB_PATH=%USB_PATH:~0,-1%"
:: Set temp base path dynamically
set "TEMP_BASE=%USB_PATH%\ghostvault_temp"

:menu
cls
echo ========================================
echo   GhostVault - Setup Menu
echo ========================================
echo.

:: Check if logs exist before showing option
set "SHOW_LOGS=0"
if exist "%INSTALL_PATH%\logs" (
    dir "%INSTALL_PATH%\logs" /B >nul 2>nul
    if !errorlevel! equ 0 (
        set "SHOW_LOGS=1"
    )
)

echo 1. Installeren / Updaten
echo 2. Verwijderen
echo 3. Health Check
echo 4. USB Portable Run (geen installatie, geen data achterlaten)
echo 5. Verwijder Tijdelijke Bestanden (logs, cache, temp)
echo 6. Verifieer Installatie
echo 7. Repair (herstel ontbrekende bestanden)
echo 8. Clean Installatie (verwijder logs en tijdelijke bestanden)
echo 9. Afsluiten
echo.
echo ========================================
echo   Systeem Info
echo ========================================
echo.

:: Check installed version - read from package.json
if exist "%INSTALL_PATH%\package.json" (
    set "INSTALLED_VERSION="
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '%INSTALL_PATH%\package.json' -Raw | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }" 2^>nul') do (
        if not "%%v"=="" set "INSTALLED_VERSION=%%v"
    )
    if defined INSTALLED_VERSION (
        echo [INSTALLED] Versie: !INSTALLED_VERSION!
    ) else (
        echo [INSTALLED] Niet geinstalleerd (package.json beschadigd)
    )
) else (
    echo [INSTALLED] Niet geinstalleerd
)

:: Check USB version - read from package.json
if exist "%USB_PATH%\ghostvault\package.json" (
    set "USB_VERSION="
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '%USB_PATH%\ghostvault\package.json' -Raw | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }" 2^>nul') do (
        if not "%%v"=="" set "USB_VERSION=%%v"
    )
    if defined USB_VERSION (
        echo [USB] Versie: !USB_VERSION!
    ) else (
        echo [USB] Geen versie info in package.json
    )
) else (
    echo [USB] Geen package.json gevonden
)

:: Check Node.js
where node >nul 2>nul
if %errorlevel% equ 0 (
    for /f "tokens=*" %%i in ('node --version') do echo [NODE] %%i
) else (
    echo [NODE] Niet geinstalleerd
)

echo.
echo ========================================
echo.

set /p userchoice="Kies een optie (1-9): "

if "!userchoice!"=="1" goto install
if "!userchoice!"=="2" goto uninstall
if "!userchoice!"=="3" goto health
if "!userchoice!"=="4" goto usb_run
if "!userchoice!"=="5" goto clear_temp_files
if "!userchoice!"=="6" goto verify_installation
if "!userchoice!"=="7" goto repair
if "!userchoice!"=="8" goto clean_installation
if "!userchoice!"=="9" goto end
echo [ERROR] Ongeldige optie, probeer opnieuw...
timeout /t 2 /nobreak >nul
goto menu

:install
cls
echo ========================================
echo   GhostVault - Installeren / Updaten
echo ========================================
echo.
echo [INFO] Starten van installatieproces...
echo [INFO] Dit kan enkele minuten duren
echo.
echo [INFO] USB Pad: %USB_PATH%
echo [INFO] Installatie Pad: %INSTALL_PATH%
echo.

:: Check Node.js
echo [CHECK] Controleren van Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js niet gevonden!
    echo.
    echo Installeer Node.js van https://nodejs.org/
    echo.
    pause
    goto menu
)
echo [OK] Node.js gevonden
for /f "tokens=*" %%i in ('node --version') do echo [INFO] Node.js versie: %%i
echo.

:: Stop GhostVault if running
echo [INFO] Stoppen van GhostVault...
taskkill /F /IM node.exe >nul 2>nul
timeout /t 2 /nobreak >nul

:: Check if already installed
if exist "%INSTALL_PATH%" (
    echo [INFO] Bestaande installatie gevonden - updaten...
    echo [INFO] Nieuwe bestanden worden gekopieerd...
    
    if exist "%USB_PATH%\ghostvault" (
        xcopy "%USB_PATH%\ghostvault\*" "%INSTALL_PATH%\" /E /I /H /Y
        if errorlevel 1 (
            echo [ERROR] Update mislukt
            echo.
            pause
            goto menu
        )
        echo [OK] Bestanden gekopieerd
    ) else (
        echo [ERROR] ghostvault map niet gevonden op USB
        echo.
        pause
        goto menu
    )
    echo [OK] Update voltooid
) else (
    echo [INFO] Nieuwe installatie op C:\ghostvault
    echo [INFO] Kopiëren van bestanden van USB naar C:\ghostvault...
    
    if not exist "%USB_PATH%\ghostvault" (
        echo [ERROR] ghostvault map niet gevonden op USB
        echo.
        pause
        goto menu
    )
    
    xcopy "%USB_PATH%\ghostvault\*" "%INSTALL_PATH%\" /E /I /H /Y
    if errorlevel 1 (
        echo [ERROR] Kopiëren mislukt
        echo.
        pause
        goto menu
    )
    echo [OK] Bestanden gekopieerd
)

echo [INFO] Bestanden gekopieerd, doorgaan met installatie...
echo.
echo [INFO] Druk op een toets om door te gaan met de installatie...
pause

:: Copy node.exe if present
echo [INFO] Controleren op node.exe...
if exist "%USB_PATH%\node.exe" (
    copy "%USB_PATH%\node.exe" "%INSTALL_PATH%\" /Y >nul 2>nul
    echo [OK] node.exe gekopieerd
) else (
    echo [INFO] Geen node.exe gevonden op USB
)

:: Copy package.json if present
echo [INFO] Controleren op package.json...
if exist "%USB_PATH%\ghostvault\package.json" (
    copy "%USB_PATH%\ghostvault\package.json" "%INSTALL_PATH%\" /Y >nul 2>nul
    echo [OK] package.json gekopieerd
) else (
    echo [INFO] Geen package.json gevonden op USB
)

:: Create app logs directory
echo.
echo [CONFIG] Configureren van logging...
set "APP_LOGS_DIR=%TEMP_BASE%\app logs"
if not exist "%APP_LOGS_DIR%" (
    mkdir "%APP_LOGS_DIR%"
    echo [OK] App logs directory aangemaakt: %APP_LOGS_DIR%
) else (
    echo [OK] App logs directory bestaat al: %APP_LOGS_DIR%
)

:: Install dependencies
echo.
echo [INSTALL] Dependencies installeren...
cd /d "%INSTALL_PATH%\apps\web"
if not exist "package.json" (
    echo [ERROR] package.json niet gevonden
    echo.
    pause
    goto menu
)

if not exist "node_modules" (
    echo [INSTALL] npm install uitvoeren (dit kan enkele minuten duren)...
    call npm install
    if errorlevel 1 (
        echo [WARN] npm install mislukt, probeer met --legacy-peer-deps...
        call npm install --legacy-peer-deps
    )
    if errorlevel 1 (
        echo [ERROR] Dependencies installatie mislukt
        echo.
        pause
        goto menu
    )
    echo [OK] Dependencies geinstalleerd
) else (
    echo [SKIP] Dependencies al geinstalleerd
)

:: Build core library
echo.
echo [BUILD] Building core library...
cd /d "%INSTALL_PATH%\core"
if not exist "dist" (
    if not exist "node_modules" (
        call npm install
    )
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Core build mislukt
        echo.
        pause
        goto menu
    )
    echo [OK] Core library built
) else (
    echo [SKIP] Core library al gebouwd
)

cd /d "%INSTALL_PATH%"

:: Create start.bat
echo.
echo [SETUP] Creating start.bat...
(
echo @echo off
echo cd /d "%INSTALL_PATH%\apps\web"
echo set GHOST_LOGS_DIR=%INSTALL_PATH%\logs
echo set APP_LOGS_DIR=%INSTALL_PATH%\logs
echo set APP_VERSION=2.5
echo set NODE_ENV=production
echo start "" cmd /k "npm run dev"
) > "%INSTALL_PATH%\start.bat"
echo [OK] start.bat created

:: Create stop.bat
echo [SETUP] Creating stop.bat...
(
echo @echo off
echo taskkill /F /IM node.exe
) > "%INSTALL_PATH%\stop.bat"
echo [OK] stop.bat created

:: Create desktop shortcut
echo [SETUP] Creating desktop shortcut...
powershell -NoProfile -Command "try { $s = New-Object -ComObject WScript.Shell; $s.CreateShortcut('%USERPROFILE%\Desktop\GhostVault.lnk').TargetPath = '%INSTALL_PATH%\start.bat'; $s.CreateShortcut('%USERPROFILE%\Desktop\GhostVault.lnk').WorkingDirectory = '%INSTALL_PATH%'; $s.CreateShortcut('%USERPROFILE%\Desktop\GhostVault.lnk').Save(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo [WARN] Kon desktop shortcut niet maken
) else (
    echo [OK] Desktop shortcut gemaakt
)

:: Create start menu shortcut
echo [SETUP] Creating start menu shortcut...
powershell -NoProfile -Command "try { $s = New-Object -ComObject WScript.Shell; $s.CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\GhostVault.lnk').TargetPath = '%INSTALL_PATH%\start.bat'; $s.CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\GhostVault.lnk').WorkingDirectory = '%INSTALL_PATH%'; $s.CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\GhostVault.lnk').Save(); exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo [WARN] Kon start menu shortcut niet maken
) else (
    echo [OK] Start menu shortcut gemaakt
)

echo.
echo ========================================
echo   INSTALLATIE SUCCESVOL
echo ========================================
echo.
echo [INFO] GhostVault geinstalleerd op: %INSTALL_PATH%
echo [INFO] Start via: C:\ghostvault\start.bat
echo [INFO] Of via desktop/start menu shortcut
echo.
echo [INFO] Druk op een toets om terug te gaan naar het menu...

:: Installation verification
echo [VERIFY] Controleren van installatie...
set "VERIFY_ERRORS=0"

if not exist "%INSTALL_PATH%\start.bat" (
    echo [ERROR] start.bat ontbreekt
    set VERIFY_ERRORS=1
)

if not exist "%INSTALL_PATH%\stop.bat" (
    echo [ERROR] stop.bat ontbreekt
    set VERIFY_ERRORS=1
)

if not exist "%INSTALL_PATH%\apps\web\package.json" (
    echo [ERROR] package.json ontbreekt
    set VERIFY_ERRORS=1
)

if not exist "%INSTALL_PATH%\apps\web\node_modules" (
    echo [ERROR] node_modules ontbreekt
    set VERIFY_ERRORS=1
)

if %VERIFY_ERRORS%==0 (
    echo [OK] Installatie verificatie geslaagd
) else (
    echo [WARN] Installatie verificatie heeft fouten gevonden
)
echo.
echo [INFO] Druk op een toets om terug te gaan naar het menu...
pause
goto menu

:uninstall
cls
echo ========================================
echo   GhostVault - Verwijderen
echo ========================================
echo.

if not exist "%INSTALL_PATH%" (
    echo [INFO] GhostVault is niet geinstalleerd op C:\ghostvault
    echo.
    pause
    goto menu
)

echo [WARNING] Dit verwijdert GhostVault van C:\ghostvault
echo.
choice /C YN /M "Weet je zeker dat je GhostVault wilt verwijderen?"
if errorlevel 2 (
    echo [INFO] Verwijderen geannuleerd
    echo.
    pause
    goto menu
)

echo [INFO] Stoppen van GhostVault...
taskkill /F /IM node.exe >nul 2>nul
timeout /t 2 /nobreak >nul

echo [INFO] Verwijderen van bestanden...
rmdir /S /Q "%INSTALL_PATH%"
if errorlevel 1 (
    echo [ERROR] Verwijderen mislukt
    echo.
    pause
    goto menu
)

echo [OK] GhostVault succesvol verwijderd
echo.
pause
goto menu

:clear_temp_files
cls
echo ========================================
echo   GhostVault - Verwijder Tijdelijke Bestanden
echo ========================================
echo.
echo [INFO] Dit verwijdert bestanden en subdirectories
echo [INFO] Hoofdmappen worden behouden
echo.

set "TEMP_BASE=%USB_PATH%\ghostvault_temp"
set "DIRS_TO_CLEAN=%TEMP_BASE%\app logs %TEMP_BASE%\logs %TEMP_BASE%\node-compile-cache %TEMP_BASE%\temp"

echo [INFO] Mappen die worden schoongemaakt:
for %%d in (%DIRS_TO_CLEAN%) do (
    if exist "%%d" (
        echo   - %%d
    ) else (
        echo   - %%d (bestaat niet)
    )
)
echo.

choice /C YN /M "Wil je doorgaan met het verwijderen van alle bestanden en subdirectories?"
if errorlevel 2 (
    echo [INFO] Geannuleerd
    echo.
    pause
    goto menu
)

echo.
echo [CLEAN] Verwijderen van bestanden en subdirectories...

for %%d in (%DIRS_TO_CLEAN%) do (
    if exist "%%d" (
        echo [CLEAN] Verwijderen van bestanden en subdirectories in: %%d
        del /Q "%%d\*" >nul 2>nul
        for /f "delims=" %%i in ('dir /ad /b "%%d"') do (
            rmdir /Q /S "%%d\%%i" >nul 2>nul
        )
        echo [OK] Bestanden en subdirectories verwijderd in: %%d
    )
)

echo.
echo [OK] Alle tijdelijke bestanden en subdirectories zijn verwijderd
echo [INFO] Hoofdmappen zijn behouden
echo.
pause
goto menu

:health
cls
echo ========================================
echo   GhostVault - Health Check
echo ========================================
echo.

set "HEALTH_ERRORS=0"
set "HEALTH_WARNINGS=0"

:: Check if installed
if not exist "%INSTALL_PATH%" (
    echo [ERROR] GhostVault is niet geinstalleerd
    echo Run optie 1 om te installeren
    echo.
    set HEALTH_ERRORS=1
) else (
    echo [OK] GhostVault is geinstalleerd op: %INSTALL_PATH%
)

:: Check version - read from package.json
if exist "%INSTALL_PATH%\package.json" (
    set "INSTALLED_VERSION="
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '%INSTALL_PATH%\package.json' -Raw | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }" 2^>nul') do (
        if not "%%v"=="" set "INSTALLED_VERSION=%%v"
    )
    if defined INSTALLED_VERSION (
        echo [OK] Geinstalleerde versie: !INSTALLED_VERSION!
    ) else (
        echo [WARN] Geen versie info in package.json
        set HEALTH_WARNINGS=1
    )
) else (
    echo [WARN] Geen package.json bestand
    set HEALTH_WARNINGS=1
)

:: Check package.json
if exist "%INSTALL_PATH%\apps\web\package.json" (
    echo [OK] package.json bestaat
) else (
    echo [ERROR] package.json ontbreekt
    set HEALTH_ERRORS=1
)

:: Check node_modules
if exist "%INSTALL_PATH%\apps\web\node_modules" (
    echo [OK] Dependencies geinstalleerd
) else (
    echo [WARN] Dependencies niet geinstalleerd
    echo [ACTION] Run optie 1 om te installeren
    set HEALTH_WARNINGS=1
)

:: Check Node.js
where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Node.js is geinstalleerd
    for /f "tokens=*" %%i in ('node --version') do echo [INFO] Node.js versie: %%i
) else (
    echo [ERROR] Node.js is niet geinstalleerd
    set HEALTH_ERRORS=1
)

:: Check if GhostVault is running
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I /N "node.exe">nul
if %errorlevel% equ 0 (
    echo [INFO] GhostVault draait momenteel
) else (
    echo [INFO] GhostVault draait niet
)

echo.
if %HEALTH_ERRORS%==1 (
    echo [ERROR] Er zijn fouten gevonden
) else if %HEALTH_WARNINGS%==1 (
    echo [WARN] Er zijn waarschuwingen gevonden
) else (
    echo [OK] Alle checks zijn geslaagd
)
echo.
pause
goto menu

:usb_run
cls
echo ========================================
echo   GhostVault - USB Portable Run
echo ========================================
echo.
echo [INFO] Starten van GhostVault in USB mode...
echo [INFO] Geen installatie, geen data achterlaten
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js niet gevonden!
    echo.
    echo Installeer Node.js van https://nodejs.org/
    echo.
    pause
    goto menu
)
echo [OK] Node.js gevonden

:: Set temp directory
set "TEMP_DIR=%TEMP_BASE%"
mkdir "%TEMP_DIR%\temp" 2>nul
mkdir "%TEMP_DIR%\logs" 2>nul
mkdir "%TEMP_DIR%\app logs" 2>nul

:: Copy ghostvault to temp
echo [COPY] Kopiëren van bestanden naar temp directory...
if not exist "%USB_PATH%\ghostvault" (
    echo [ERROR] ghostvault map niet gevonden op USB
    echo.
    pause
    goto menu
)

xcopy "%USB_PATH%\ghostvault\*" "%TEMP_DIR%\temp\" /E /I /H /Y >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Kopiëren mislukt
    echo.
    pause
    goto menu
)
echo [OK] Bestanden gekopieerd

:: Install dependencies
echo [INSTALL] Dependencies installeren...
cd /d "%TEMP_DIR%\temp\apps\web"
if not exist "node_modules" (
    echo [INSTALL] npm install uitvoeren (dit kan enkele minuten duren)...
    call npm install
    if errorlevel 1 (
        echo [WARN] npm install mislukt, probeer met --legacy-peer-deps...
        call npm install --legacy-peer-deps
    )
    if errorlevel 1 (
        echo [ERROR] Dependencies installatie mislukt
        echo.
        pause
        goto menu
    )
    echo [OK] Dependencies geinstalleerd
) else (
    echo [SKIP] Dependencies al geinstalleerd
)

:: Build core library
echo [BUILD] Building core library...
cd /d "%TEMP_DIR%\temp\core"
if not exist "dist" (
    if not exist "node_modules" (
        call npm install
    )
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Core build mislukt
        echo.
        pause
        goto menu
    )
    echo [OK] Core library built
) else (
    echo [SKIP] Core library al gebouwd
)

:: Start GhostVault
echo.
echo [START] Starting GhostVault...
cd /d "%TEMP_DIR%\temp\apps\web"

REM Read version from package.json
set "APP_VERSION=2.5"
set "APP_LOGS_DIR=%TEMP_DIR%\app logs"

if exist "%USB_PATH%\ghostvault\package.json" (
    REM Try to read version from package.json using PowerShell
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '%USB_PATH%\ghostvault\package.json' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }"') do (
        if not "%%v"=="" set "APP_VERSION=%%v"
    )
)

if exist "%USB_PATH%\package.json" (
    REM Try to read version from package.json using PowerShell
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '%USB_PATH%\package.json' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }"') do (
        if not "%%v"=="" set "APP_VERSION=%%v"
    )
)

REM Use temp directory if APP_LOGS_DIR not set from config
if "%APP_LOGS_DIR%"=="%TEMP_DIR%\app logs" (
    set "APP_LOGS_DIR=%TEMP_DIR%\app logs"
)

set "GHOST_LOGS_DIR=%TEMP_DIR%\logs"
start "" cmd /k "set GHOST_LOGS_DIR=%TEMP_DIR%\logs && set APP_LOGS_DIR=%APP_LOGS_DIR% && set APP_VERSION=%APP_VERSION% && set NODE_ENV=production && npm run dev"

echo [INFO] GhostVault is gestart in USB mode
echo [INFO] Temp directory: %TEMP_DIR%
echo [INFO] Logs directory: %TEMP_DIR%\logs
echo [INFO] App logs directory: %TEMP_DIR%\app logs
echo [INFO] App versie: %APP_VERSION%
echo [INFO] Logs komen in: %TEMP_DIR%\app logs\ghostvault_%APP_VERSION%
echo [INFO] Sluit het venster om GhostVault te stoppen
echo [INFO] De temp directory wordt niet automatisch verwijderd
echo.
pause
goto menu

:view_logs
cls
echo ========================================
echo   GhostVault - Bekijk Installatie Logs
echo ========================================
echo.

set "LOG_DIR=%INSTALL_PATH%\logs"
if not exist "%LOG_DIR%" (
    echo [INFO] Geen logs gevonden
    echo.
    pause
    goto menu
)

dir "%LOG_DIR%" /B
echo.
set /p logfile="Kies een log bestand om te bekijken (of druk enter om terug te gaan): "
if "%logfile%"=="" goto menu

if exist "%LOG_DIR%\%logfile%" (
    type "%LOG_DIR%\%logfile%"
) else (
    echo [ERROR] Bestand niet gevonden
)
echo.
pause
goto menu

:verify_installation
cls
echo ========================================
echo   GhostVault - Verifieer Installatie
echo ========================================
echo.

set "VERIFY_ERRORS=0"
set "VERIFY_WARNINGS=0"

:: Check if installed
if not exist "%INSTALL_PATH%" (
    echo [ERROR] GhostVault is niet geinstalleerd
    echo Run optie 1 om te installeren
    echo.
    set VERIFY_ERRORS=1
) else (
    echo [OK] GhostVault is geinstalleerd op: %INSTALL_PATH%
)

:: Check version - read from package.json
if exist "%INSTALL_PATH%\package.json" (
    set "INSTALLED_VERSION="
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content '%INSTALL_PATH%\package.json' -Raw | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }" 2^>nul') do (
        if not "%%v"=="" set "INSTALLED_VERSION=%%v"
    )
    if defined INSTALLED_VERSION (
        echo [OK] Geinstalleerde versie: !INSTALLED_VERSION!
    ) else (
        echo [WARN] Geen versie info in package.json
        set VERIFY_WARNINGS=1
    )
) else (
    echo [WARN] Geen package.json bestand
    set VERIFY_WARNINGS=1
)

:: Check package.json
if exist "%INSTALL_PATH%\apps\web\package.json" (
    echo [OK] package.json bestaat
) else (
    echo [ERROR] package.json ontbreekt
    set VERIFY_ERRORS=1
)

:: Check node_modules
if exist "%INSTALL_PATH%\apps\web\node_modules" (
    echo [OK] Dependencies geinstalleerd
) else (
    echo [WARN] Dependencies niet geinstalleerd
    echo [ACTION] Run optie 1 om te installeren
    set VERIFY_WARNINGS=1
)

:: Check Node.js
where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Node.js is geinstalleerd
    for /f "tokens=*" %%i in ('node --version') do echo [INFO] Node.js versie: %%i
) else (
    echo [ERROR] Node.js is niet geinstalleerd
    set VERIFY_ERRORS=1
)

echo.
if %VERIFY_ERRORS%==1 (
    echo [ERROR] Er zijn fouten gevonden
) else if %VERIFY_WARNINGS%==1 (
    echo [WARN] Er zijn waarschuwingen gevonden
) else (
    echo [OK] Installatie is correct
)
echo.
pause
goto menu

:clean_installation
cls
echo ========================================
echo   GhostVault - Clean Installatie
echo ========================================
echo.
echo [INFO] Verwijderen van logs en tijdelijke bestanden...
echo.

:: Check if installed
if not exist "%INSTALL_PATH%" (
    echo [INFO] GhostVault is niet geinstalleerd
    echo.
    pause
    goto menu
)

:: Remove logs
echo [CLEAN] Verwijderen van logs...
if exist "%INSTALL_PATH%\logs" (
    rmdir /S /Q "%INSTALL_PATH%\logs"
    if errorlevel 1 (
        echo [WARN] Kon logs niet verwijderen
    ) else (
        echo [OK] Logs verwijderd
    )
) else (
    echo [INFO] Geen logs gevonden
)

:: Remove temp directories
echo [CLEAN] Verwijderen van tijdelijke bestanden...
if exist "%INSTALL_PATH%\apps\web\node_modules\.cache" (
    rmdir /S /Q "%INSTALL_PATH%\apps\web\node_modules\.cache"
    echo [OK] NPM cache verwijderd
)

if exist "%INSTALL_PATH%\apps\web\dist" (
    rmdir /S /Q "%INSTALL_PATH%\apps\web\dist"
    echo [OK] Build bestanden verwijderd
)

if exist "%INSTALL_PATH%\core\dist" (
    rmdir /S /Q "%INSTALL_PATH%\core\dist"
    echo [OK] Core build bestanden verwijderd
)

:: Remove ghosttrusted (localStorage data)
echo [CLEAN] Verwijderen van ghosttrusted data...
if exist "%INSTALL_PATH%\ghosttrusted" (
    rmdir /S /Q "%INSTALL_PATH%\ghosttrusted"
    echo [OK] ghosttrusted verwijderd
) else (
    echo [INFO] Geen ghosttrusted gevonden
)

:: Remove temp directories from USB
echo [CLEAN] Verwijderen van temp directories op USB...
for /d %%d in ("%USB_PATH%\ghostvault_temp_*") do (
    rmdir /S /Q "%%d"
    echo [OK] Temp directory verwijderd: %%d
)

:: Remove .next directory if exists
if exist "%INSTALL_PATH%\apps\web\.next" (
    rmdir /S /Q "%INSTALL_PATH%\apps\web\.next"
    echo [OK] .next directory verwijderd
)

:: Remove .turbo directory if exists
if exist "%INSTALL_PATH%\apps\web\.turbo" (
    rmdir /S /Q "%INSTALL_PATH%\apps\web\.turbo"
    echo [OK] .turbo directory verwijderd
)

echo.
echo ========================================
echo   CLEAN INSTALLATIE VOLTOOID
echo ========================================
echo.
echo [INFO] Alle logs en tijdelijke bestanden zijn verwijderd
echo [INFO] GhostVault installatie blijft behouden
echo.
pause
goto menu

:repair
cls
echo ========================================
echo   GhostVault - Repair
echo ========================================
echo.
echo [INFO] Controleren op ontbrekende bestanden...
echo.

:: Check if installed
if not exist "%INSTALL_PATH%" (
    echo [ERROR] GhostVault is niet geinstalleerd
    echo.
    pause
    goto menu
)

:: Check if USB ghostvault exists
if not exist "%USB_PATH%\ghostvault" (
    echo [ERROR] ghostvault map niet gevonden op USB
    echo.
    pause
    goto menu
)

:: Get versions
set "INSTALLED_VERSION="
if exist "%INSTALL_PATH%\package.json" (
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content ''%INSTALL_PATH%\package.json'' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }" 2^>nul') do (
        if not "%%v"=="" set "INSTALLED_VERSION=%%v"
    )
)

set "USB_VERSION="
if exist "%USB_PATH%\ghostvault\package.json" (
    for /f "tokens=*" %%v in ('powershell -NoProfile -Command "try { $pkg = Get-Content ''%USB_PATH%\ghostvault\package.json'' | ConvertFrom-Json; Write-Output $pkg.version } catch { Write-Output '' }" 2^>nul') do (
        if not "%%v"=="" set "USB_VERSION=%%v"
    )
)

echo [INFO] Geïnstalleerde versie: !INSTALLED_VERSION!
echo [INFO] USB versie: !USB_VERSION!
echo.

:: Check if versions match
if not defined INSTALLED_VERSION (
    echo [WARN] Kan geïnstalleerde versie niet bepalen
    echo [INFO] Volledige update wordt uitgevoerd...
    goto install
)

if not defined USB_VERSION (
    echo [WARN] Kan USB versie niet bepalen
    echo [INFO] Volledige update wordt uitgevoerd...
    goto install
)

if not "!INSTALLED_VERSION!"=="!USB_VERSION!" (
    echo [INFO] Versies komen niet overeen
    echo [INFO] Update wordt uitgevoerd...
    echo.
    set /p confirm="Wil je doorgaan met update naar !USB_VERSION!? (j/n): "
    if /i not "!confirm!"=="j" (
        echo [INFO] Update geannuleerd
        echo.
        pause
        goto menu
    )
    goto install
)

:: Versions match - repair missing files
echo [INFO] Versies komen overeen - repair modus
echo [INFO] Controleren op ontbrekende bestanden...
echo.

set "MISSING_FILES=0"
set "REPAIRED_FILES=0"

:: Check core directory
if not exist "%INSTALL_PATH%\core" (
    echo [MISSING] core directory
    set "MISSING_FILES=1"
)

:: Check apps directory
if not exist "%INSTALL_PATH%\apps" (
    echo [MISSING] apps directory
    set "MISSING_FILES=1"
)

:: Check specific important files
if not exist "%INSTALL_PATH%\core\package.json" (
    echo [MISSING] core\package.json
    set "MISSING_FILES=1"
)

if not exist "%INSTALL_PATH%\apps\web\package.json" (
    echo [MISSING] apps\web\package.json
    set "MISSING_FILES=1"
)

if not exist "%INSTALL_PATH%\core\src" (
    echo [MISSING] core\src directory
    set "MISSING_FILES=1"
)

if not exist "%INSTALL_PATH%\apps\web\src" (
    echo [MISSING] apps\web\src directory
    set "MISSING_FILES=1"
)

if !MISSING_FILES!==0 (
    echo [OK] Geen ontbrekende bestanden gevonden
    echo [INFO] Installatie lijkt compleet
    echo.
    pause
    goto menu
)

echo.
echo [INFO] Ontbrekende bestanden gevonden - starten met repair...
echo.

:: Stop GhostVault if running
echo [INFO] Stoppen van GhostVault...
taskkill /F /IM node.exe >nul 2>nul
timeout /t 2 /nobreak >nul

:: Copy missing files
echo [INFO] Kopiëren van ontbrekende bestanden...
xcopy "%USB_PATH%\ghostvault\*" "%INSTALL_PATH%\" /E /I /H /Y
if errorlevel 1 (
    echo [ERROR] Repair mislukt
    echo.
    pause
    goto menu
)

echo [OK] Repair voltooid
echo [INFO] Alle bestanden zijn nagekeken en gerepaired
echo.

:: Copy node.exe if present
if exist "%USB_PATH%\node.exe" (
    copy "%USB_PATH%\node.exe" "%INSTALL_PATH%\" /Y >nul 2>nul
    echo [OK] node.exe gekopieerd
)

:: Copy package.json if present
if exist "%USB_PATH%\ghostvault\package.json" (
    copy "%USB_PATH%\ghostvault\package.json" "%INSTALL_PATH%\" /Y >nul 2>nul
    echo [OK] package.json gekopieerd
)

echo.
echo ========================================
echo   REPAIR VOLTOOID
echo ========================================
echo.
echo [INFO] Ontbrekende bestanden zijn hersteld
echo [INFO] GhostVault is weer compleet
echo.
pause
goto menu

:end
cls
echo [INFO] Bedankt voor het gebruiken van GhostVault
echo.
timeout /t 2 /nobreak >nul
exit /b 0

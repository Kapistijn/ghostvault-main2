# GhostVault Configuratie Opties

Dit bestand bevat uitleg over alle configuratie opties in `config.json`.

## Root Level

- `version`: Versie van de applicatie - wordt gebruikt voor log directory naam en versie tracking
- `environment`: Omgeving: production, development, of test - bepaalt welke config overrides worden geladen

## app

- `name`: Naam van de applicatie
- `description`: Beschrijving van de applicatie
- `author`: Auteur van de applicatie
- `homepage`: URL van de homepage
- `license`: Licentie van de applicatie

## logging

- `enableFileLogging`: Schakel bestands logging in of uit
- `logDirectory`: Map waar log bestanden worden opgeslagen
- `minLevel`: Minimum log level: debug, info, warn, error, critical, success, action
- `enableConsole`: Schakel console logging in of uit
- `enableStorage`: Schakel localStorage logging in of uit
- `enableStructuredLogging`: Schakel gestructureerde (JSON) logging in of uit
- `logFormat`: Log formaat: text of json
- `maxFileSize`: Maximum grootte van een log bestand in bytes (default: 10MB)
- `maxFiles`: Maximum aantal log bestanden om te bewaren
- `compressOldLogs`: Comprimeer oude log bestanden om ruimte te besparen
- `compressAfterDays`: Comprimeer log bestanden ouder dan X dagen
- `enableLogRotation`: Schakel log rotatie in of uit
- `rotationInterval`: Rotatie interval: daily, weekly, of monthly
- `modules`: Module-specifieke log levels voor verschillende onderdelen
- `enableLogFiltering`: Schakel log filtering functionaliteit in
- `enableLogSearch`: Schakel log zoek functionaliteit in
- `enableLogExport`: Schakel log export functionaliteit in
- `logRetentionDays`: Aantal dagen om logs te bewaren

## paths

- `tempBase`: Basis map voor tijdelijke bestanden
- `tempDir`: Map voor tijdelijke bestanden
- `logsDir`: Map voor algemene logs
- `appLogsDir`: Map voor applicatie logs
- `nodeCompileCache`: Map voor Node.js compile cache
- `dataDir`: Map voor applicatie data
- `backupDir`: Map voor back-ups
- `cacheDir`: Map voor cache bestanden

## installer

- `installPath`: Standaard installatie pad
- `usbPath`: Pad voor USB portable mode
- `createDesktopShortcut`: Maak desktop shortcut tijdens installatie
- `createStartMenuShortcut`: Maak start menu shortcut tijdens installatie
- `autoUpdate`: Schakel automatische updates in
- `updateCheckInterval`: Interval voor update checks in uren

## defaults

- `compressionLevel`: Standaard compressie niveau (0-9)
- `enableCompression`: Schakel compressie in of uit
- `enableDeduplication`: Schakel deduplicatie in of uit
- `enableChecksum`: Schakel checksum validatie in
- `emitGhostKey`: Genereer GhostKey bij encryptie
- `enableChunking`: Schakel bestand chunking in
- `chunkSize`: Grootte van chunks in bytes
- `enableStreamingDecrypt`: Schakel streaming decryptie in
- `enableMemoryWipe`: Wis geheugen na operatie
- `defaultEncryptionAlgorithm`: Standaard encryptie algoritme
- `defaultCompressionAlgorithm`: Standaard compressie algoritme

## features

- `enableGhostTrusted`: Schakel GhostTrusted functionaliteit in
- `enableDoubleEncryption`: Schakel dubbele encryptie in
- `enableSelfDestruct`: Schakel zelfdestruct functionaliteit in
- `enableDecoyChunks`: Schakel decoy chunks in
- `enableHiddenMetadata`: Schakel verborgen metadata in
- `enableAutoDelete`: Schakel automatische verwijdering in
- `enableMaxOpens`: Schakel maximum aantal keer openen in
- `enableTimeLock`: Schakel tijdslot in
- `enablePasswordRecovery`: Schakel wachtwoord herstel in
- `enableFileIntegrityCheck`: Schakel bestandsintegriteitscontrole in

## security

- `minPasswordLength`: Minimum wachtwoord lengte
- `maxPasswordLength`: Maximum wachtwoord lengte
- `requireSpecialChars`: Vereis speciale tekens in wachtwoord
- `requireNumbers`: Vereis nummers in wachtwoord
- `requireUppercase`: Vereis hoofdletters in wachtwoord
- `enablePasswordStrengthCheck`: Schakel wachtwoord sterkte check in
- `enablePasswordHistory`: Schakel wachtwoord geschiedenis in
- `passwordHistoryCount`: Aantal wachtwoorden in geschiedenis
- `maxFailedAttempts`: Maximum aantal mislukte pogingen
- `lockoutDuration`: Duur van lockout in minuten
- `enableTwoFactorAuth`: Schakel twee-factor authenticatie in

## performance

- `maxConcurrentOperations`: Maximum aantal gelijktijdige operaties
- `enableMemoryOptimization`: Schakel geheugenoptimalisatie in
- `enableStreaming`: Schakel streaming in
- `enablePerformanceLogging`: Schakel performance logging in
- `performanceSampleInterval`: Interval voor performance samples in ms
- `enableCaching`: Schakel caching in
- `cacheMaxSize`: Maximum cache grootte in MB
- `enableLazyLoading`: Schakel lazy loading in
- `enableWebWorkers`: Schakel Web Workers in

## ui

- `theme`: UI thema: dark, light, of auto
- `language`: Taal van de interface
- `showAdvancedOptions`: Toon geavanceerde opties standaard
- `enableAnimations`: Schakel animaties in
- `enableDebugPanel`: Schakel debug panel in
- `enableNotifications`: Schakel notificaties in
- `notificationDuration`: Duur van notificaties in ms
- `enableTooltips`: Schakel tooltips in
- `enableKeyboardShortcuts`: Schakel keyboard shortcuts in
- `maxFileSizeDisplay`: Maximum bestandsgrootte voor display in MB

## network

- `enableTelemetry`: Schakel telemetrie in
- `telemetryEndpoint`: URL voor telemetrie endpoint
- `enableCrashReporting`: Schakel crash reporting in
- `crashReportingEndpoint`: URL voor crash reporting endpoint
- `enableAutoUpdateCheck`: Schakel automatische update check in
- `updateEndpoint`: URL voor update endpoint
- `requestTimeout`: Timeout voor requests in ms
- `maxRetries`: Maximum aantal retries voor requests

## storage

- `enableLocalStorage`: Schakel localStorage in
- `enableIndexedDB`: Schakel IndexedDB in
- `enableFileSystemAccess`: Schakel File System Access API in
- `maxStorageSize`: Maximum opslag grootte in MB
- `enableStorageQuotaManagement`: Schakel storage quota management in
- `autoCleanupOldFiles`: Automatisch opruimen van oude bestanden
- `oldFileThresholdDays`: Aantal dagen voordat bestanden als oud worden beschouwd

## debug

- `enableDebugMode`: Schakel debug mode in
- `enableVerboseLogging`: Schakel verbose logging in
- `enableProfiling`: Schakel profiling in
- `enableMemoryProfiling`: Schakel geheugen profiling in
- `enablePerformanceProfiling`: Schakel performance profiling in
- `debugPort`: Poort voor debug server
- `enableSourceMaps`: Schakel source maps in

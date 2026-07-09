import { useState, memo, useMemo } from 'react';

interface ConfigEditorProps {
  config: any;
  setConfig: (config: any) => void;
}

const CONFIG_DESCRIPTIONS: Record<string, Record<string, string>> = {
  version: { version: 'Versie van de applicatie' },
  environment: { environment: 'Omgeving: production, development, of test' },
  app: {
    name: 'Naam van de applicatie',
    description: 'Beschrijving van de applicatie',
    author: 'Auteur van de applicatie',
    homepage: 'Homepage URL',
    license: 'Licentie type'
  },
  logging: {
    enableFileLogging: 'Schakel bestandslogging in',
    logDirectory: 'Map voor logbestanden',
    minLevel: 'Minimum log level (debug, info, warn, error)',
    enableConsole: 'Schakel console logging in',
    enableStorage: 'Schakel localStorage logging in',
    enableStructuredLogging: 'Schakel gestructureerde logging in',
    logFormat: 'Log formaat (text of json)',
    maxFileSize: 'Maximum bestandsgrootte in bytes',
    maxFiles: 'Maximum aantal logbestanden',
    compressOldLogs: 'Comprimeer oude logbestanden',
    compressAfterDays: 'Comprimeer logs ouder dan X dagen',
    enableLogRotation: 'Schakel log rotatie in',
    rotationInterval: 'Rotatie interval (daily, weekly, monthly)',
    modules: 'Module-specifieke log levels',
    enableLogFiltering: 'Schakel log filtering in',
    enableLogSearch: 'Schakel log zoeken in',
    enableLogExport: 'Schakel log export in',
    logRetentionDays: 'Aantal dagen om logs te bewaren'
  },
  paths: {
    tempBase: 'Basis temp map',
    tempDir: 'Temp map',
    logsDir: 'Logs map',
    appLogsDir: 'App logs map',
    nodeCompileCache: 'Node compile cache map',
    dataDir: 'Data map',
    backupDir: 'Backup map',
    cacheDir: 'Cache map'
  },
  installer: {
    installPath: 'Installatie pad',
    usbPath: 'USB pad',
    createDesktopShortcut: 'Maak desktop shortcut',
    createStartMenuShortcut: 'Maak start menu shortcut',
    autoUpdate: 'Automatische updates',
    updateCheckInterval: 'Update check interval in uren'
  },
  defaults: {
    compressionLevel: 'Compressie level (1-9, 9 = beste compressie)',
    enableCompression: 'Schakel compressie in',
    compressionAlgorithm: 'Compressie algoritme (gzip, deflate, brotli)',
    compressionThreshold: 'Minimum grootte voor compressie in bytes',
    enableParallelCompression: 'Schakel parallelle compressie in',
    maxCompressionThreads: 'Maximum compressie threads',
    enableDeduplication: 'Schakel deduplicatie in',
    enableChecksum: 'Schakel checksum in',
    emitGhostKey: 'Emit ghost key',
    enableChunking: 'Schakel chunking in',
    chunkSize: 'Chunk size in bytes',
    enableStreamingDecrypt: 'Schakel streaming decrypt in',
    enableMemoryWipe: 'Schakel memory wipe in',
    defaultEncryptionAlgorithm: 'Standaard encryptie algoritme',
    defaultCompressionAlgorithm: 'Standaard compressie algoritme'
  },
  features: {
    enableGhostTrusted: 'Schakel GhostTrusted in',
    enableDoubleEncryption: 'Schakel dubbele encryptie in',
    enableSelfDestruct: 'Schakel self-destruct in',
    enableDecoyChunks: 'Schakel decoy chunks in',
    enableHiddenMetadata: 'Schakel verborgen metadata in',
    enableAutoDelete: 'Schakel auto-delete in',
    enableMaxOpens: 'Schakel max opens in',
    enableTimeLock: 'Schakel time lock in',
    enablePasswordRecovery: 'Schakel wachtwoord herstel in',
    enableFileIntegrityCheck: 'Schakel file integrity check in'
  },
  security: {
    minPasswordLength: 'Minimum wachtwoord lengte (minimaal 12 aanbevolen)',
    maxPasswordLength: 'Maximum wachtwoord lengte',
    requireSpecialChars: 'Vereis speciale tekens (!@#$%^&*)',
    requireNumbers: 'Vereis nummers',
    requireUppercase: 'Vereis hoofdletters',
    requireLowercase: 'Vereis kleine letters',
    enablePasswordStrengthCheck: 'Schakel wachtwoord sterkte check in',
    enablePasswordHistory: 'Schakel wachtwoord geschiedenis in',
    passwordHistoryCount: 'Aantal wachtwoorden in geschiedenis',
    maxFailedAttempts: 'Maximum aantal mislukte pogingen',
    lockoutDuration: 'Lockout duur in seconden',
    enableTwoFactorAuth: 'Schakel 2FA in',
    passwordExpiryDays: 'Wachtwoord verloop in dagen (0 = nooit)',
    forbidCommonPasswords: 'Verbied veelgebruikte wachtwoorden',
    forbidPersonalInfo: 'Verbied persoonlijke informatie in wachtwoord',
    enablePasswordHashing: 'Schakel wachtwoord hashing in',
    hashingAlgorithm: 'Hashing algoritme (argon2, bcrypt, scrypt)',
    hashIterations: 'Hash iteraties',
    enableSalt: 'Schakel salt in',
    saltLength: 'Salt lengte in bytes'
  },
  performance: {
    maxConcurrentOperations: 'Maximum aantal gelijktijdige operaties',
    enableMemoryOptimization: 'Schakel memory optimalisatie in',
    enableStreaming: 'Schakel streaming in',
    enablePerformanceLogging: 'Schakel performance logging in',
    performanceSampleInterval: 'Performance sample interval in ms',
    enableCaching: 'Schakel caching in',
    cacheMaxSize: 'Maximum cache grootte',
    enableLazyLoading: 'Schakel lazy loading in',
    enableWebWorkers: 'Schakel web workers in'
  },
  ui: {
    theme: 'Thema (dark, light, auto)',
    language: 'Taal',
    showAdvancedOptions: 'Toon geavanceerde opties',
    enableAnimations: 'Schakel animaties in',
    enableDebugPanel: 'Schakel debug panel in',
    enableNotifications: 'Schakel notificaties in',
    notificationDuration: 'Notificatie duur in ms',
    enableTooltips: 'Schakel tooltips in',
    enableKeyboardShortcuts: 'Schakel keyboard shortcuts in',
    maxFileSizeDisplay: 'Maximum bestandsgrootte voor display'
  },
  network: {
    enableTelemetry: 'Schakel telemetry in',
    telemetryEndpoint: 'Telemetry endpoint',
    enableCrashReporting: 'Schakel crash reporting in',
    crashReportingEndpoint: 'Crash reporting endpoint',
    enableAutoUpdateCheck: 'Schakel auto update check in',
    updateEndpoint: 'Update endpoint',
    requestTimeout: 'Request timeout in ms',
    maxRetries: 'Maximum aantal retries'
  },
  storage: {
    enableLocalStorage: 'Schakel localStorage in',
    enableIndexedDB: 'Schakel IndexedDB in',
    enableFileSystemAccess: 'Schakel File System Access API in',
    maxStorageSize: 'Maximum opslag grootte in MB',
    enableStorageQuotaManagement: 'Schakel storage quota management in',
    autoCleanupOldFiles: 'Automatisch oude files opschonen',
    oldFileThresholdDays: 'Oude file threshold in dagen'
  },
  debug: {
    enableDebugMode: 'Schakel debug mode in',
    enableVerboseLogging: 'Schakel verbose logging in',
    enableProfiling: 'Schakel profiling in',
    enableMemoryProfiling: 'Schakel memory profiling in',
    enablePerformanceProfiling: 'Schakel performance profiling in',
    debugPort: 'Debug poort',
    enableSourceMaps: 'Schakel source maps in'
  }
};

const ConfigEditor = memo(function ConfigEditor({ config, setConfig }: ConfigEditorProps) {
  const [activeSection, setActiveSection] = useState<string>('app');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  const [originalConfig, setOriginalConfig] = useState<any>(JSON.parse(JSON.stringify(config)));
  const [configHistory, setConfigHistory] = useState<any[]>([JSON.parse(JSON.stringify(config))]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const [showDiff, setShowDiff] = useState<boolean>(false);

  const CONFIG_CATEGORIES: Record<string, string[]> = {
    'General': ['app', 'version', 'environment'],
    'Security': ['security'],
    'Performance': ['performance', 'defaults'],
    'Logging': ['logging'],
    'Network': ['network'],
    'Paths': ['paths'],
    'Installer': ['installer'],
    'Features': ['features'],
    'Storage': ['storage'],
    'UI': ['ui'],
    'Debug': ['debug'],
    'Other': []
  };

  const getCategory = (section: string): string => {
    for (const [category, sections] of Object.entries(CONFIG_CATEGORIES)) {
      if (sections.includes(section)) return category;
    }
    return 'Other';
  };

  const getConfigDiff = () => {
    const diff: { path: string[]; oldValue: any; newValue: any }[] = [];
    
    const compareObjects = (obj1: any, obj2: any, path: string[] = []) => {
      const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);
      
      keys.forEach(key => {
        const currentPath = [...path, key];
        const val1 = obj1?.[key];
        const val2 = obj2?.[key];
        
        if (JSON.stringify(val1) !== JSON.stringify(val2)) {
          if (typeof val1 === 'object' && typeof val2 === 'object' && val1 !== null && val2 !== null) {
            compareObjects(val1, val2, currentPath);
          } else {
            diff.push({ path: currentPath, oldValue: val1, newValue: val2 });
          }
        }
      });
    };
    
    compareObjects(originalConfig, config);
    return diff;
  };

  const configDiff = useMemo(() => getConfigDiff(), [config, originalConfig]);

  const CONFIG_PRESETS = {
    development: {
      environment: 'development',
      logging: { minLevel: 'debug', enableConsole: true },
      debug: { enableDebugMode: true, enableProfiling: true }
    },
    production: {
      environment: 'production',
      logging: { minLevel: 'info', enableConsole: false },
      debug: { enableDebugMode: false, enableProfiling: false }
    },
    test: {
      environment: 'test',
      logging: { minLevel: 'debug', enableConsole: true },
      debug: { enableDebugMode: true, enableProfiling: false }
    }
  };

  const updateConfig = (path: string[], value: any) => {
    const newConfig = { ...config };
    let current = newConfig;
    
    for (let i = 0; i < path.length - 1; i++) {
      if (!current[path[i]]) {
        current[path[i]] = {};
      }
      current = current[path[i]];
    }
    
    current[path[path.length - 1]] = value;
    
    // Add to history
    const newHistory = configHistory.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newConfig)));
    setConfigHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    setConfig(newConfig);
    setHasChanges(JSON.stringify(newConfig) !== JSON.stringify(originalConfig));
  };

  const applyPreset = (preset: keyof typeof CONFIG_PRESETS) => {
    const presetConfig = CONFIG_PRESETS[preset];
    const newConfig = { ...config };
    
    // Apply preset values
    Object.entries(presetConfig).forEach(([key, value]) => {
      if (typeof value === 'object' && value !== null) {
        newConfig[key] = { ...newConfig[key], ...value };
      } else {
        newConfig[key] = value;
      }
    });
    
    // Add to history
    const newHistory = configHistory.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newConfig)));
    setConfigHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    setConfig(newConfig);
    setHasChanges(true);
  };

  const undoConfig = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setConfig(JSON.parse(JSON.stringify(configHistory[newIndex])));
      setHasChanges(JSON.stringify(configHistory[newIndex]) !== JSON.stringify(originalConfig));
    }
  };

  const redoConfig = () => {
    if (historyIndex < configHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setConfig(JSON.parse(JSON.stringify(configHistory[newIndex])));
      setHasChanges(JSON.stringify(configHistory[newIndex]) !== JSON.stringify(originalConfig));
    }
  };

  const resetConfig = () => {
    const newConfig = JSON.parse(JSON.stringify(originalConfig));
    
    // Add to history
    const newHistory = configHistory.slice(0, historyIndex + 1);
    newHistory.push(newConfig);
    setConfigHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    setConfig(newConfig);
    setHasChanges(false);
  };

  const resetToDefaults = () => {
    // Reset to the original config that was passed in
    const defaultConfig = JSON.parse(JSON.stringify(originalConfig));
    
    // Add to history
    const newHistory = configHistory.slice(0, historyIndex + 1);
    newHistory.push(defaultConfig);
    setConfigHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    
    setConfig(defaultConfig);
    setHasChanges(false);
    alert('Config gereset naar originele waarden');
  };

  const saveConfig = () => {
    try {
      // Validate config before saving
      const validationErrors: string[] = [];
      
      // Check required fields
      if (!config.version) validationErrors.push('Version is vereist');
      if (!config.environment) validationErrors.push('Environment is vereist');
      if (!config.app?.name) validationErrors.push('App name is vereist');
      
      // Check cross-field validation
      if (configValidation.errors.length > 0) {
        validationErrors.push(...configValidation.errors);
      }
      
      if (validationErrors.length > 0) {
        alert(`Validatiefouten:\n${validationErrors.join('\n')}`);
        return;
      }

      // Save to localStorage
      localStorage.setItem('ghostvault_config', JSON.stringify(config));
      setHasChanges(false);
      
      // Update original config
      setOriginalConfig(JSON.parse(JSON.stringify(config)));
      
      alert('Config opgeslagen!');
    } catch (error) {
      console.error('Fout bij opslaan config:', error);
      alert(`Fout bij opslaan config: ${error instanceof Error ? error.message : 'Onbekende fout'}`);
    }
  };

  const exportConfig = () => {
    const configStr = JSON.stringify(config, null, 2);
    const blob = new Blob([configStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ghostvault_config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedConfig = JSON.parse(e.target?.result as string);
        setConfig(importedConfig);
        setHasChanges(true);
        alert('Config geïmporteerd! Klik op Opslaan om te bewaren.');
      } catch (error) {
        alert('Fout bij importeren van config: Ongeldig JSON formaat');
      }
    };
    reader.readAsText(file);
  };

  const validateValue = (key: string, value: any, section: string): { valid: boolean; message?: string } => {
    // Basic validation rules
    if (section === 'security') {
      if (key === 'minPasswordLength' && (value < 8 || value > 128)) {
        return { valid: false, message: 'Moet tussen 8 en 128 zijn (12+ aanbevolen)' };
      }
      if (key === 'maxPasswordLength' && (value < 8 || value > 256)) {
        return { valid: false, message: 'Moet tussen 8 en 256 zijn' };
      }
      if (key === 'passwordHistoryCount' && (value < 0 || value > 50)) {
        return { valid: false, message: 'Moet tussen 0 en 50 zijn' };
      }
      if (key === 'maxFailedAttempts' && (value < 1 || value > 20)) {
        return { valid: false, message: 'Moet tussen 1 en 20 zijn' };
      }
      if (key === 'lockoutDuration' && (value < 60 || value > 86400)) {
        return { valid: false, message: 'Moet tussen 60s en 24u zijn' };
      }
      if (key === 'passwordExpiryDays' && (value < 0 || value > 365)) {
        return { valid: false, message: 'Moet tussen 0 en 365 dagen zijn' };
      }
      if (key === 'hashIterations' && (value < 1000 || value > 1000000)) {
        return { valid: false, message: 'Moet tussen 1000 en 1M zijn' };
      }
      if (key === 'saltLength' && (value < 16 || value > 128)) {
        return { valid: false, message: 'Moet tussen 16 en 128 bytes zijn' };
      }
      if (key === 'hashingAlgorithm' && !['argon2', 'bcrypt', 'scrypt', 'pbkdf2'].includes(value)) {
        return { valid: false, message: 'Moet argon2, bcrypt, scrypt of pbkdf2 zijn' };
      }
      if (key === 'minPasswordLength' && config.security?.maxPasswordLength && value > config.security.maxPasswordLength) {
        return { valid: false, message: 'Min mag niet groter zijn dan max' };
      }
      // Security recommendations
      if (key === 'minPasswordLength' && value < 12) {
        return { valid: true, message: 'Waarschuwing: 12+ karakters aanbevolen voor sterke wachtwoorden' };
      }
    }

    if (section === 'performance') {
      if (key === 'maxConcurrentOperations' && (value < 1 || value > 100)) {
        return { valid: false, message: 'Moet tussen 1 en 100 zijn' };
      }
      if (key === 'cacheMaxSize' && (value < 0 || value > 1024)) {
        return { valid: false, message: 'Moet tussen 0 en 1024 MB zijn' };
      }
    }

    if (section === 'defaults') {
      if (key === 'compressionLevel' && (value < 1 || value > 9)) {
        return { valid: false, message: 'Moet tussen 1 en 9 zijn (9 = beste compressie)' };
      }
      if (key === 'compressionThreshold' && (value < 0 || value > 10485760)) {
        return { valid: false, message: 'Moet tussen 0 en 10MB zijn' };
      }
      if (key === 'maxCompressionThreads' && (value < 1 || value > 16)) {
        return { valid: false, message: 'Moet tussen 1 en 16 zijn' };
      }
      if (key === 'chunkSize' && (value < 1024 || value > 104857600)) {
        return { valid: false, message: 'Moet tussen 1KB en 100MB zijn' };
      }
      if (key === 'compressionAlgorithm' && !['gzip', 'deflate', 'brotli', 'none'].includes(value)) {
        return { valid: false, message: 'Moet gzip, deflate, brotli of none zijn' };
      }
      // Optimal chunk size recommendation based on file size
      if (key === 'chunkSize' && config.defaults?.compressionLevel >= 7 && value < 65536) {
        return { valid: true, message: 'Tip: Grotere chunks (64KB+) voor betere compressie bij level 7+' };
      }
    }

    if (section === 'logging') {
      if (key === 'maxFileSize' && (value < 1024 || value > 1073741824)) {
        return { valid: false, message: 'Moet tussen 1KB en 1GB zijn' };
      }
      if (key === 'maxFiles' && (value < 1 || value > 100)) {
        return { valid: false, message: 'Moet tussen 1 en 100 zijn' };
      }
      if (key === 'logRetentionDays' && (value < 1 || value > 365)) {
        return { valid: false, message: 'Moet tussen 1 en 365 dagen zijn' };
      }
    }

    if (section === 'network') {
      if (key === 'timeout' && (value < 1000 || value > 300000)) {
        return { valid: false, message: 'Moet tussen 1s en 5min zijn' };
      }
      if (key === 'retryAttempts' && (value < 0 || value > 10)) {
        return { valid: false, message: 'Moet tussen 0 en 10 zijn' };
      }
    }

    return { valid: true };
  };

  const validateConfig = () => {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Cross-field validation
    if (config.security?.minPasswordLength > config.security?.maxPasswordLength) {
      errors.push('Min password length mag niet groter zijn dan max password length');
    }
    
    if (config.performance?.maxConcurrentOperations < 1) {
      errors.push('Max concurrent operations moet minimaal 1 zijn');
    }
    
    if (config.logging?.maxFiles < 1) {
      errors.push('Max files moet minimaal 1 zijn');
    }
    
    // Warnings
    if (config.logging?.minLevel === 'debug' && config.environment === 'production') {
      warnings.push('Debug logging in production is niet aanbevolen');
    }
    
    if (config.debug?.enableDebugMode && config.environment === 'production') {
      warnings.push('Debug mode in production is niet aanbevolen');
    }
    
    return { errors, warnings };
  };

  const configValidation = useMemo(() => validateConfig(), [config]);

  const renderValue = (key: string, value: any, path: string[]) => {
    const section = path[0];

    if (typeof value === 'boolean') {
      return (
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value}
              onChange={(e) => updateConfig(path, e.target.checked)}
              className="w-4 h-4 accent-neon-cyan"
            />
            <span className="text-ghost-300">{value ? 'Aan' : 'Uit'}</span>
          </label>
        </div>
      );
    }

    if (typeof value === 'number') {
      const validation = validateValue(key, value, section);
      return (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => updateConfig(path, parseInt(e.target.value) || 0)}
            className={`bg-void border rounded px-3 py-1 text-ghost-300 w-32 font-mono text-sm ${
              !validation.valid ? 'border-red-500' : 'border-ghost-500/30'
            }`}
          />
          {!validation.valid && (
            <span className="text-red-400 text-xs">{validation.message}</span>
          )}
        </div>
      );
    }

    if (typeof value === 'string') {
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => updateConfig(path, e.target.value)}
          className="bg-void border border-ghost-500/30 rounded px-3 py-1 text-ghost-300 w-full font-mono text-sm"
        />
      );
    }

    if (typeof value === 'object' && value !== null) {
      return (
        <div className="text-ghost-500 text-sm italic">
          (Object - zie subsectie)
        </div>
      );
    }

    return <span className="text-ghost-500 text-sm">{String(value)}</span>;
  };

  const renderSection = (sectionKey: string, sectionData: any, path: string[] = []) => {
    // Handle primitive values at the top level (like version, environment)
    if (typeof sectionData !== 'object' || sectionData === null) {
      const description = CONFIG_DESCRIPTIONS[sectionKey] || '';
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="font-mono text-sm text-ghost-300">
              {sectionKey}
            </label>
            {renderValue(sectionKey, sectionData, path)}
          </div>
          {description && (
            <p className="text-xs text-ghost-600">{String(description)}</p>
          )}
        </div>
      );
    }

    const entries = Object.entries(sectionData);
    
    // Filter based on search query
    const filteredEntries = searchQuery 
      ? entries.filter(([key, value]) => {
          const description = CONFIG_DESCRIPTIONS[path[0]]?.[key] || CONFIG_DESCRIPTIONS[key] || '';
          const searchLower = searchQuery.toLowerCase();
          const valueStr = typeof value === 'string' ? value : String(value);
          return (
            key.toLowerCase().includes(searchLower) ||
            String(description).toLowerCase().includes(searchLower) ||
            valueStr.toLowerCase().includes(searchLower)
          );
        })
      : entries;

    if (filteredEntries.length === 0) {
      return (
        <div className="text-ghost-500 text-sm italic">
          Geen resultaten gevonden
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {filteredEntries.map(([key, value]) => {
          const currentPath = [...path, key];
          const description = CONFIG_DESCRIPTIONS[path[0]]?.[key] || CONFIG_DESCRIPTIONS[key] || '';

          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return (
              <div key={key} className="border-l-2 border-ghost-500/30 pl-4">
                <h4 className="font-display text-neon-cyan text-sm mb-2 capitalize">
                  {key}
                </h4>
                {renderSection(key, value, currentPath)}
              </div>
            );
          }

          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="font-mono text-sm text-ghost-300">
                  {key}
                </label>
                {renderValue(key, value, currentPath)}
              </div>
              {description && (
                <p className="text-xs text-ghost-600">{String(description)}</p>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const sections = Object.keys(config || {}).filter(key => config[key] !== null && config[key] !== undefined);

  if (!config || Object.keys(config).length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="font-mono text-ghost-500">
          Config laden...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Search and Actions Bar */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Zoek config opties..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 font-mono text-sm text-ghost-200 bg-void border border-ghost-500/30 rounded px-3 py-2"
        />
        <button
          onClick={undoConfig}
          disabled={historyIndex === 0}
          className={`font-mono text-xs px-3 py-2 rounded border ${
            historyIndex === 0 
              ? 'text-ghost-600 border-ghost-500/10 cursor-not-allowed' 
              : 'text-ghost-300 hover:text-ghost-200 border-ghost-500/30'
          }`}
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          onClick={redoConfig}
          disabled={historyIndex === configHistory.length - 1}
          className={`font-mono text-xs px-3 py-2 rounded border ${
            historyIndex === configHistory.length - 1 
              ? 'text-ghost-600 border-ghost-500/10 cursor-not-allowed' 
              : 'text-ghost-300 hover:text-ghost-200 border-ghost-500/30'
          }`}
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
        <button
          onClick={resetConfig}
          disabled={!hasChanges}
          className={`font-mono text-xs px-4 py-2 rounded border ${
            hasChanges 
              ? 'text-ghost-300 hover:text-ghost-200 border-ghost-500/30' 
              : 'text-ghost-600 border-ghost-500/10 cursor-not-allowed'
          }`}
        >
          Reset
        </button>
        <button
          onClick={resetToDefaults}
          className="font-mono text-xs px-4 py-2 rounded border text-ghost-300 hover:text-ghost-200 border-ghost-500/30"
          title="Reset naar originele waarden"
        >
          Defaults
        </button>
        <button
          onClick={saveConfig}
          disabled={!hasChanges}
          className={`font-mono text-xs px-4 py-2 rounded border ${
            hasChanges 
              ? 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan hover:bg-neon-cyan/20' 
              : 'text-ghost-600 border-ghost-500/10 cursor-not-allowed'
          }`}
        >
          Opslaan
        </button>
        <button
          onClick={exportConfig}
          className="font-mono text-xs px-4 py-2 rounded border text-ghost-300 hover:text-ghost-200 border-ghost-500/30"
          title="Export config als JSON"
        >
          Export
        </button>
        <label className="font-mono text-xs px-4 py-2 rounded border text-ghost-300 hover:text-ghost-200 border-ghost-500/30 cursor-pointer">
          Import
          <input
            type="file"
            accept=".json"
            onChange={importConfig}
            className="hidden"
          />
        </label>
      </div>

      {/* Presets Bar */}
      <div className="flex gap-2">
        <span className="font-mono text-xs text-ghost-500 self-center">Presets:</span>
        <button
          onClick={() => applyPreset('development')}
          className="font-mono text-xs px-3 py-1 rounded border text-ghost-300 hover:text-neon-cyan border-ghost-500/30"
        >
          Development
        </button>
        <button
          onClick={() => applyPreset('production')}
          className="font-mono text-xs px-3 py-1 rounded border text-ghost-300 hover:text-neon-cyan border-ghost-500/30"
        >
          Production
        </button>
        <button
          onClick={() => applyPreset('test')}
          className="font-mono text-xs px-3 py-1 rounded border text-ghost-300 hover:text-neon-cyan border-ghost-500/30"
        >
          Test
        </button>
      </div>

      {hasChanges && (
        <div className="p-2 bg-amber-900/20 border border-amber-500/30 rounded text-amber-400 font-mono text-xs flex justify-between items-center">
          <span>⚠️ Je hebt onopgeslagen wijzigingen ({configDiff.length} changes)</span>
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="text-amber-400 hover:text-amber-300 underline"
          >
            {showDiff ? 'Hide Diff' : 'Show Diff'}
          </button>
        </div>
      )}

      {configValidation.errors.length > 0 && (
        <div className="p-2 bg-red-900/20 border border-red-500/30 rounded text-red-400 font-mono text-xs">
          ❌ Validatiefouten:
          <ul className="mt-1 ml-4 list-disc">
            {configValidation.errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {configValidation.warnings.length > 0 && (
        <div className="p-2 bg-yellow-900/20 border border-yellow-500/30 rounded text-yellow-400 font-mono text-xs">
          ⚠️ Waarschuwingen:
          <ul className="mt-1 ml-4 list-disc">
            {configValidation.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {showDiff && configDiff.length > 0 && (
        <div className="p-4 bg-void rounded border border-panel-border">
          <h4 className="font-mono text-sm text-neon-cyan mb-3">Config Changes</h4>
          <div className="space-y-2 font-mono text-xs max-h-48 overflow-auto">
            {configDiff.map((change, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-ghost-500 w-48 truncate">{change.path.join('.')}:</span>
                <span className="text-red-400 line-through">{String(change.oldValue)}</span>
                <span className="text-green-400">→</span>
                <span className="text-green-400">{String(change.newValue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-6 flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0">
          <h3 className="font-display text-sm text-ghost-500 mb-3">SECTIES</h3>
          <div className="space-y-4">
            {Object.entries(CONFIG_CATEGORIES).map(([category, categorySections]) => {
              const sections = Object.keys(config || {}).sort() as string[];
              const categorySectionsInConfig = sections.filter((s: string) => categorySections.includes(s) || (category === 'Other' && !categorySections.includes(s)));
              
              if (categorySectionsInConfig.length === 0) return null;
              
              return (
                <div key={category}>
                  <h4 className="font-mono text-xs text-neon-cyan mb-2">{category}</h4>
                  <div className="space-y-1">
                    {categorySectionsInConfig.map(section => (
                      <button
                        key={section}
                        onClick={() => setActiveSection(section)}
                        className={`w-full text-left px-3 py-2 rounded font-mono text-sm transition ${
                          activeSection === section
                            ? 'bg-neon-cyan/20 text-neon-cyan'
                            : 'text-ghost-500 hover:text-ghost-300 hover:bg-ghost-500/10'
                        }`}
                      >
                        {section}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <h3 className="font-display text-lg text-neon-cyan mb-4 capitalize">
            {activeSection}
          </h3>
          {renderSection(activeSection, config[activeSection], [activeSection])}
        </div>
      </div>
    </div>
  );
});

export default ConfigEditor;

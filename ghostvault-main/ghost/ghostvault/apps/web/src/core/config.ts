/**
 * Configuration loader for GhostVault
 * Reads configuration from config.json file
 */

export interface AppConfig {
  version: string;
  environment: 'production' | 'development' | 'test';
  app: {
    name: string;
    description: string;
    author: string;
    homepage: string;
    license: string;
  };
  logging: {
    enableFileLogging: boolean;
    logDirectory: string;
    minLevel: string;
    enableConsole: boolean;
    enableStorage: boolean;
    enableStructuredLogging: boolean;
    logFormat: 'text' | 'json';
    maxFileSize: number;
    maxFiles: number;
    compressOldLogs: boolean;
    compressAfterDays: number;
    enableLogRotation: boolean;
    rotationInterval: 'daily' | 'weekly' | 'monthly';
    modules: {
      [key: string]: string;
    };
    enableLogFiltering: boolean;
    enableLogSearch: boolean;
    enableLogExport: boolean;
    logRetentionDays: number;
  };
  paths: {
    tempBase: string;
    tempDir: string;
    logsDir: string;
    appLogsDir: string;
    nodeCompileCache: string;
    dataDir: string;
    backupDir: string;
    cacheDir: string;
  };
  installer: {
    installPath: string;
    usbPath: string;
    createDesktopShortcut: boolean;
    createStartMenuShortcut: boolean;
    autoUpdate: boolean;
    updateCheckInterval: number;
  };
  defaults: {
    compressionLevel: number;
    enableCompression: boolean;
    enableDeduplication: boolean;
    enableChecksum: boolean;
    emitGhostKey: boolean;
    enableChunking: boolean;
    chunkSize: number;
    enableStreamingDecrypt: boolean;
    enableMemoryWipe: boolean;
    defaultEncryptionAlgorithm: string;
    defaultCompressionAlgorithm: string;
  };
  features: {
    enableGhostTrusted: boolean;
    enableDoubleEncryption: boolean;
    enableSelfDestruct: boolean;
    enableDecoyChunks: boolean;
    enableHiddenMetadata: boolean;
    enableAutoDelete: boolean;
    enableMaxOpens: boolean;
    enableTimeLock: boolean;
    enablePasswordRecovery: boolean;
    enableFileIntegrityCheck: boolean;
  };
  security: {
    minPasswordLength: number;
    maxPasswordLength: number;
    requireSpecialChars: boolean;
    requireNumbers: boolean;
    requireUppercase: boolean;
    enablePasswordStrengthCheck: boolean;
    enablePasswordHistory: boolean;
    passwordHistoryCount: number;
    maxFailedAttempts: number;
    lockoutDuration: number;
    enableTwoFactorAuth: boolean;
  };
  performance: {
    maxConcurrentOperations: number;
    enableMemoryOptimization: boolean;
    enableStreaming: boolean;
    enablePerformanceLogging: boolean;
    performanceSampleInterval: number;
    enableCaching: boolean;
    cacheMaxSize: number;
    enableLazyLoading: boolean;
    enableWebWorkers: boolean;
  };
  ui: {
    theme: string;
    language: string;
    showAdvancedOptions: boolean;
    enableAnimations: boolean;
    enableDebugPanel: boolean;
    enableNotifications: boolean;
    notificationDuration: number;
    enableTooltips: boolean;
    enableKeyboardShortcuts: boolean;
    maxFileSizeDisplay: number;
  };
  network: {
    enableTelemetry: boolean;
    telemetryEndpoint: string;
    enableCrashReporting: boolean;
    crashReportingEndpoint: string;
    updateEndpoint: string;
    requestTimeout: number;
    maxRetries: number;
  };
  storage: {
    enableLocalStorage: boolean;
    enableIndexedDB: boolean;
    enableFileSystemAccess: boolean;
    maxStorageSize: number;
    enableStorageQuotaManagement: boolean;
    autoCleanupOldFiles: boolean;
    oldFileThresholdDays: number;
  };
  debug: {
    enableDebugMode: boolean;
    enableVerboseLogging: boolean;
    enableProfiling: boolean;
    enableMemoryProfiling: boolean;
    enablePerformanceProfiling: boolean;
    debugPort: number;
    enableSourceMaps: boolean;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  version: '2.5',
  environment: 'production',
  app: {
    name: 'GhostVault',
    description: 'Secure file encryption and decryption tool',
    author: 'GhostVault Team',
    homepage: 'https://ghostvault.example.com',
    license: 'MIT'
  },
  logging: {
    enableFileLogging: true,
    logDirectory: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\app logs',
    minLevel: 'debug',
    enableConsole: true,
    enableStorage: false,
    enableStructuredLogging: false,
    logFormat: 'text',
    maxFileSize: 10485760,
    maxFiles: 5,
    compressOldLogs: true,
    compressAfterDays: 7,
    enableLogRotation: true,
    rotationInterval: 'daily',
    modules: {
      app: 'debug',
      encrypt: 'info',
      decrypt: 'info',
      core: 'warn',
      ui: 'error'
    },
    enableLogFiltering: true,
    enableLogSearch: true,
    enableLogExport: true,
    logRetentionDays: 30
  },
  paths: {
    tempBase: 'C:\\ghostvault-main\\ghost\\ghostvault_temp',
    tempDir: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\temp',
    logsDir: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\logs',
    appLogsDir: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\app logs',
    nodeCompileCache: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\node-compile-cache',
    dataDir: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\data',
    backupDir: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\backups',
    cacheDir: 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\cache'
  },
  installer: {
    installPath: 'C:\\ghostvault',
    usbPath: '%~dp0',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    autoUpdate: false,
    updateCheckInterval: 24
  },
  defaults: {
    compressionLevel: 3,
    enableCompression: true,
    enableDeduplication: true,
    enableChecksum: true,
    emitGhostKey: true,
    enableChunking: true,
    chunkSize: 1048576,
    enableStreamingDecrypt: true,
    enableMemoryWipe: true,
    defaultEncryptionAlgorithm: 'AES-256-GCM',
    defaultCompressionAlgorithm: 'zstd'
  },
  features: {
    enableGhostTrusted: false,
    enableDoubleEncryption: false,
    enableSelfDestruct: false,
    enableDecoyChunks: true,
    enableHiddenMetadata: true,
    enableAutoDelete: false,
    enableMaxOpens: false,
    enableTimeLock: false,
    enablePasswordRecovery: false,
    enableFileIntegrityCheck: true
  },
  security: {
    minPasswordLength: 8,
    maxPasswordLength: 128,
    requireSpecialChars: false,
    requireNumbers: false,
    requireUppercase: false,
    enablePasswordStrengthCheck: true,
    enablePasswordHistory: false,
    passwordHistoryCount: 5,
    maxFailedAttempts: 5,
    lockoutDuration: 30,
    enableTwoFactorAuth: false
  },
  performance: {
    maxConcurrentOperations: 4,
    enableMemoryOptimization: true,
    enableStreaming: true,
    enablePerformanceLogging: true,
    performanceSampleInterval: 5000,
    enableCaching: true,
    cacheMaxSize: 100,
    enableLazyLoading: true,
    enableWebWorkers: true
  },
  ui: {
    theme: 'dark',
    language: 'nl',
    showAdvancedOptions: false,
    enableAnimations: true,
    enableDebugPanel: true,
    enableNotifications: true,
    notificationDuration: 3000,
    enableTooltips: true,
    enableKeyboardShortcuts: true,
    maxFileSizeDisplay: 1024
  },
  network: {
    enableTelemetry: false,
    telemetryEndpoint: '',
    enableCrashReporting: false,
    crashReportingEndpoint: '',
    updateEndpoint: '',
    requestTimeout: 30000,
    maxRetries: 3
  },
  storage: {
    enableLocalStorage: true,
    enableIndexedDB: true,
    enableFileSystemAccess: true,
    maxStorageSize: 1024,
    enableStorageQuotaManagement: true,
    autoCleanupOldFiles: true,
    oldFileThresholdDays: 30
  },
  debug: {
    enableDebugMode: false,
    enableVerboseLogging: false,
    enableProfiling: false,
    enableMemoryProfiling: false,
    enablePerformanceProfiling: false,
    debugPort: 9229,
    enableSourceMaps: false
  }
};

let config: AppConfig | null = null;

/**
 * Validate configuration object
 * Returns true if valid, false otherwise
 */
export function validateConfig(config: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate version
  if (!config.version || typeof config.version !== 'string') {
    errors.push('Invalid or missing version');
  }

  // Validate environment
  if (config.environment && !['production', 'development', 'test'].includes(config.environment)) {
    errors.push('Invalid environment (must be "production", "development", or "test")');
  }

  // Validate app section
  if (!config.app || typeof config.app !== 'object') {
    errors.push('Invalid or missing app section');
  } else {
    if (!config.app.name || typeof config.app.name !== 'string') {
      errors.push('Invalid or missing app.name');
    }
  }

  // Validate logging section
  if (!config.logging || typeof config.logging !== 'object') {
    errors.push('Invalid or missing logging section');
  } else {
    if (typeof config.logging.enableFileLogging !== 'boolean') {
      errors.push('Invalid logging.enableFileLogging');
    }
    if (typeof config.logging.minLevel !== 'string') {
      errors.push('Invalid logging.minLevel');
    }
    if (config.logging.logFormat && !['text', 'json'].includes(config.logging.logFormat)) {
      errors.push('Invalid logging.logFormat (must be "text" or "json")');
    }
    if (config.logging.rotationInterval && !['daily', 'weekly', 'monthly'].includes(config.logging.rotationInterval)) {
      errors.push('Invalid logging.rotationInterval (must be "daily", "weekly", or "monthly")');
    }
  }

  // Validate paths section
  if (!config.paths || typeof config.paths !== 'object') {
    errors.push('Invalid or missing paths section');
  }

  // Validate security section
  if (config.security && typeof config.security === 'object') {
    if (config.security.minPasswordLength && (typeof config.security.minPasswordLength !== 'number' || config.security.minPasswordLength < 1)) {
      errors.push('Invalid security.minPasswordLength');
    }
    if (config.security.maxPasswordLength && (typeof config.security.maxPasswordLength !== 'number' || config.security.maxPasswordLength < 1)) {
      errors.push('Invalid security.maxPasswordLength');
    }
  }

  // Validate performance section
  if (config.performance && typeof config.performance === 'object') {
    if (config.performance.maxConcurrentOperations && (typeof config.performance.maxConcurrentOperations !== 'number' || config.performance.maxConcurrentOperations < 1)) {
      errors.push('Invalid performance.maxConcurrentOperations');
    }
  }

  // Validate ui section
  if (config.ui && typeof config.ui === 'object') {
    if (config.ui.theme && !['dark', 'light', 'auto'].includes(config.ui.theme)) {
      errors.push('Invalid ui.theme (must be "dark", "light", or "auto")');
    }
  }

  // Validate debug section
  if (config.debug && typeof config.debug === 'object') {
    if (config.debug.debugPort && (typeof config.debug.debugPort !== 'number' || config.debug.debugPort < 1 || config.debug.debugPort > 65535)) {
      errors.push('Invalid debug.debugPort (must be between 1 and 65535)');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Load configuration from config.json file
 * Falls back to default configuration if file not found or invalid
 * Supports environment-specific overrides (config.dev.json, config.prod.json)
 */
export async function loadConfig(): Promise<AppConfig> {
  if (config) {
    return config;
  }

  let configValue: AppConfig = DEFAULT_CONFIG;

  try {
    // Check if running in Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isNode = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.versions?.node;

    if (isNode) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fs = (globalThis as any).require?.('fs') || (globalThis as any).require?.('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const path = (globalThis as any).require?.('path') || (globalThis as any).require?.('node:path');

      if (fs && path) {
        // Determine environment from NODE_ENV or default to production
        const nodeEnv = (process as any).env?.NODE_ENV || 'production';

        // Try to find config.json in various locations
        const possiblePaths = [
          path.join(process.cwd(), 'config.json'),
          path.join(process.cwd(), '..', 'config.json'),
          path.join(process.cwd(), 'ghostvault', 'config.json'),
        ];

        let baseConfig: any = null;
        let loadedFrom: string | null = null;

        // Load base config
        for (const configPath of possiblePaths) {
          if (fs.existsSync(configPath)) {
            try {
              const content = fs.readFileSync(configPath, 'utf8');
              baseConfig = JSON.parse(content);
              loadedFrom = configPath;
              break;
            } catch (error) {
              console.error(`[Config] Failed to parse ${configPath}:`, error);
            }
          }
        }

        // Load environment-specific override if exists
        const envConfigPath = loadedFrom ? loadedFrom.replace('config.json', `config.${nodeEnv}.json`) : null;
        if (envConfigPath && fs.existsSync(envConfigPath)) {
          try {
            const content = fs.readFileSync(envConfigPath, 'utf8');
            const envConfig = JSON.parse(content);
            baseConfig = { ...baseConfig, ...envConfig };
          } catch (error) {
            console.error(`[Config] Failed to parse ${envConfigPath}:`, error);
          }
        }

        // Validate configuration
        if (baseConfig) {
          const validation = validateConfig(baseConfig);
          if (!validation.valid) {
            console.error(`[Config] Configuration validation failed:`, validation.errors);
            configValue = DEFAULT_CONFIG;
            return configValue;
          }

          configValue = { ...DEFAULT_CONFIG, ...baseConfig };
          return configValue;
        }
      }
    }

    // Fallback to default config
    configValue = DEFAULT_CONFIG;
    return configValue;
  } catch (error) {
    console.error('[Config] Error loading configuration:', error);
    configValue = DEFAULT_CONFIG;
    return configValue;
  }
}

/**
 * Get current configuration
 */
export function getConfig(): AppConfig {
  return config || DEFAULT_CONFIG;
}

/**
 * Get specific configuration value
 */
export function getConfigValue<T extends keyof AppConfig>(key: T): AppConfig[T] {
  return getConfig()[key];
}

/**
 * Reload configuration from file
 */
export async function reloadConfig(): Promise<AppConfig> {
  config = null;
  return loadConfig();
}

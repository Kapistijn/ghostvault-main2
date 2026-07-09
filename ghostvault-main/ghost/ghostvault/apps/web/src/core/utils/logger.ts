/**
 * MODULE: Logger Utility
 *
 * Verantwoordelijkheid:
 *  - Gedetailleerde logging voor debugging
 *  - Log rotatie om ophoping te voorkomen
 *  - Structured logging met context
 *  - Browser en Node.js compatible
 *  - Secure logging (geen sensitive data)
 *
 * Gebruikt door:
 *  - Alle modules die logging nodig hebben
 *
 * Afhankelijk van:
 *  - Geen
 *
 * @module core/utils/logger
 */

// Sensitive data patterns to redact
const SENSITIVE_PATTERNS = [
  /password["\s:=]+[^\s"']+/gi,
  /pwd["\s:=]+[^\s"']+/gi,
  /token["\s:=]+[^\s"']+/gi,
  /secret["\s:=]+[^\s"']+/gi,
  /api[_-]?key["\s:=]+[^\s"']+/gi,
  /authorization["\s:=]+[^\s"']+/gi,
  /bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
  // Add more patterns for better coverage
  /["']?password["']?\s*[:=]\s*["']?[^\s"']+/gi,
  /["']?token["']?\s*[:=]\s*["']?[^\s"']+/gi,
  /["']?secret["']?\s*[:=]\s*["']?[^\s"']+/gi,
  /["']?key["']?\s*[:=]\s*["']?[^\s"']+/gi,
  // Match base64 encoded strings that might be sensitive (longer than 20 chars)
  /[A-Za-z0-9+/]{32,}={0,2}/g,
];

/**
 * Redact sensitive data from log messages
 */
function redactSensitiveData(message: string): string {
  if (!message || typeof message !== 'string') return message;
  
  let redacted = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  
  // Redact potential credit card numbers (basic pattern)
  redacted = redacted.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED_CC]');
  
  // Redact potential email addresses
  redacted = redacted.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[REDACTED_EMAIL]');
  
  // Redact potential IP addresses
  redacted = redacted.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]');
  
  return redacted;
}

/**
 * Redact sensitive data from context objects
 */
function redactContext(context?: Record<string, any>): Record<string, any> | undefined {
  if (!context) return context;
  
  const redacted: Record<string, any> = {};
  const sensitiveKeys = ['password', 'pwd', 'token', 'secret', 'apiKey', 'api_key', 'authorization', 'bearer'];
  
  for (const [key, value] of Object.entries(context)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      redacted[key] = redactSensitiveData(value);
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactContext(value);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
  SUCCESS = 5, // For successful operations
  ACTION = 6, // For user actions
}

export interface LogAlert {
  id: string;
  type: 'error_rate' | 'pattern_match' | 'level_threshold' | 'custom';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  data?: any;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, any>;
  stack?: string;
}

export interface LoggerOptions {
  module: string;
  enableConsole?: boolean;
  enableStorage?: boolean;
  enableFileLogging?: boolean;
  logDirectory?: string;
  version?: string; // App version for subdirectory
  maxStorageEntries?: number;
  minLevel?: LogLevel;
  maxAge?: number; // Maximum age of logs in milliseconds
  maxFileSize?: number; // Maximum file size in bytes before rotation
  maxFiles?: number; // Maximum number of log files to keep
  compressOldLogs?: boolean; // Compress old log files
  compressAfterDays?: number; // Compress logs older than X days
  logFormat?: 'text' | 'json'; // Log format
  enableStructuredLogging?: boolean; // Enable structured logging
  enableBuffering?: boolean; // Enable log buffering for performance
  bufferSize?: number; // Buffer size before flush
  enableCorrelationIds?: boolean; // Enable correlation IDs for tracing
  enableSampling?: boolean; // Enable log sampling for high-volume scenarios
  samplingRate?: number; // Sampling rate (0-1)
}

class Logger {
  private module: string;
  private enableConsole: boolean;
  private enableStorage: boolean;
  private enableFileLogging: boolean;
  private logDirectory: string | undefined;
  private version: string | undefined;
  private maxStorageEntries: number;
  private maxFileSize: number;
  private maxFiles: number;
  private compressOldLogs: boolean;
  private compressAfterDays: number;
  private logFormat: 'text' | 'json';
  private enableStructuredLogging: boolean;
  private enableBuffering: boolean;
  private bufferSize: number;
  private enableCorrelationIds: boolean;
  private enableSampling: boolean;
  private samplingRate: number;
  private storageKey: string;
  private minLevel: LogLevel;
  private maxAge: number;
  private logBuffer: LogEntry[] = [];
  private currentCorrelationId: string | null = null;

  constructor(options: LoggerOptions) {
    this.module = options.module;
    this.enableConsole = options.enableConsole ?? true;
    this.enableStorage = options.enableStorage ?? true;
    this.enableFileLogging = options.enableFileLogging ?? false;
    this.logDirectory = options.logDirectory;
    this.version = options.version;
    this.maxStorageEntries = options.maxStorageEntries ?? 1000;
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024; // 10MB default
    this.maxFiles = options.maxFiles ?? 5; // Keep 5 log files by default
    this.compressOldLogs = options.compressOldLogs ?? false;
    this.compressAfterDays = options.compressAfterDays ?? 7; // Compress after 7 days default
    this.logFormat = options.logFormat ?? 'text';
    this.enableStructuredLogging = options.enableStructuredLogging ?? false;
    this.enableBuffering = options.enableBuffering ?? false;
    this.bufferSize = options.bufferSize ?? 100;
    this.enableCorrelationIds = options.enableCorrelationIds ?? false;
    this.enableSampling = options.enableSampling ?? false;
    this.samplingRate = options.samplingRate ?? 1.0;
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
    this.maxAge = options.maxAge ?? 24 * 60 * 60 * 1000; // 24 hours default
    this.storageKey = `ghostvault_logs_${this.module}`;
  }

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private formatLevel(level: LogLevel): string {
    return LogLevel[level];
  }

  private createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      module: this.module,
      message: redactSensitiveData(message),
      context: redactContext(context),
    };

    if (error) {
      entry.stack = error.stack;
    }

    // Add correlation ID if enabled
    if (this.enableCorrelationIds && this.currentCorrelationId) {
      if (!entry.context) {
        entry.context = {};
      }
      entry.context.correlationId = this.currentCorrelationId;
    }

    return entry;
  }

  // Correlation ID methods for tracing
  setCorrelationId(id: string): void {
    this.currentCorrelationId = id;
  }

  clearCorrelationId(): void {
    this.currentCorrelationId = null;
  }

  generateCorrelationId(): string {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    this.currentCorrelationId = id;
    return id;
  }

  // Buffer management methods
  private flushBuffer(): void {
    if (this.logBuffer.length === 0) return;
    
    const entriesToFlush = [...this.logBuffer];
    this.logBuffer = [];
    
    entriesToFlush.forEach(entry => {
      this.logToStorage(entry);
      this.logToFile(entry);
      this.logToConsole(entry);
    });
  }

  private addToBuffer(entry: LogEntry): void {
    if (!this.enableBuffering) {
      this.logToStorage(entry);
      this.logToFile(entry);
      this.logToConsole(entry);
      return;
    }

    this.logBuffer.push(entry);

    if (this.logBuffer.length >= this.bufferSize) {
      this.flushBuffer();
    }
  }

  flush(): void {
    this.flushBuffer();
  }

  // Sampling check
  private shouldSample(): boolean {
    if (!this.enableSampling) return true;
    return Math.random() < this.samplingRate;
  }

  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.timestamp}] [${this.formatLevel(entry.level)}] [${entry.module}]`;
    const message = `${prefix} ${entry.message}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message, entry.context || '');
        break;
      case LogLevel.INFO:
        console.info(message, entry.context || '');
        break;
      case LogLevel.WARN:
        console.warn(message, entry.context || '');
        break;
      case LogLevel.ERROR:
      case LogLevel.CRITICAL:
        console.error(message, entry.context || '');
        if (entry.stack) {
          console.error('Stack trace:', entry.stack);
        }
        break;
      case LogLevel.SUCCESS:
        console.log(`%c${message}`, 'color: #4ade80; font-weight: bold;', entry.context || '');
        break;
      case LogLevel.ACTION:
        console.log(`%c${message}`, 'color: #60a5fa; font-weight: bold;', entry.context || '');
        break;
    }
  }

  private logToStorage(entry: LogEntry): void {
    if (!this.enableStorage) return;

    try {
      const logs = this.getStoredLogs();
      
      // Remove logs older than maxAge
      const now = new Date().getTime();
      const filteredLogs = logs.filter(log => {
        const logTime = new Date(log.timestamp).getTime();
        return now - logTime < this.maxAge;
      });
      
      filteredLogs.push(entry);

      // Limit storage size
      if (filteredLogs.length > this.maxStorageEntries) {
        filteredLogs.shift(); // Remove oldest entry
      }

      localStorage.setItem(this.storageKey, JSON.stringify(filteredLogs));
    } catch (error) {
      // If localStorage fails, just log to console
      console.error('Failed to write log to storage:', error);
    }
  }

  private logToFile(entry: LogEntry): void {
    if (!this.enableFileLogging || !this.logDirectory) return;

    // Check if running in Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isNode = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.versions?.node;
    
    if (isNode) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fs = (globalThis as any).require?.('fs') || (globalThis as any).require?.('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const path = (globalThis as any).require?.('path') || (globalThis as any).require?.('node:path');

        if (!fs || !path) return;

        // Check if log directory exists
        if (!fs.existsSync(this.logDirectory)) {
          return; // Don't log if directory doesn't exist
        }

        // Create version-specific subdirectory
        let versionDir = this.logDirectory;
        if (this.version) {
          versionDir = path.join(this.logDirectory, `ghostvault_${this.version}`);
          if (!fs.existsSync(versionDir)) {
            try {
              fs.mkdirSync(versionDir, { recursive: true });
            } catch (error) {
              // If we can't create the version directory, use the base directory
              versionDir = this.logDirectory;
            }
          }
        }

        // Create detailed log entry
        let logLine: string;
        if (this.logFormat === 'json' || this.enableStructuredLogging) {
          // JSON format
          const logObject: any = {
            timestamp: entry.timestamp,
            level: this.formatLevel(entry.level),
            module: entry.module,
            message: entry.message,
            context: entry.context || null,
            stack: entry.stack || null,
            version: this.version || null
          };
          
          // Add system information
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const processInfo = (globalThis as any).process;
          if (processInfo) {
            logObject.system = {
              platform: processInfo.platform,
              nodeVersion: processInfo.version,
              pid: processInfo.pid,
              memory: processInfo.memoryUsage()
            };
          }
          
          // Add performance metrics
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const perf = (globalThis as any).performance;
          if (perf && perf.now) {
            logObject.performance = perf.now().toFixed(2) + 'ms';
          }
          
          logLine = JSON.stringify(logObject) + '\n';
        } else {
          // Text format
          logLine = `[${entry.timestamp}] [${this.formatLevel(entry.level)}] [${entry.module}] ${entry.message}`;
          const contextLine = entry.context ? `\nContext: ${JSON.stringify(entry.context, null, 2)}` : '';
          const stackLine = entry.stack ? `\nStack Trace:\n${entry.stack}` : '';
          
          // Add system information
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const processInfo = (globalThis as any).process;
          const systemInfo = processInfo ? 
            `\nSystem Info:\n  Platform: ${processInfo.platform}\n  Node Version: ${processInfo.version}\n  PID: ${processInfo.pid}\n  Memory: ${JSON.stringify(processInfo.memoryUsage())}` : '';
          
          // Add performance metrics
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const perf = (globalThis as any).performance;
          const perfInfo = perf && perf.now ? `\nPerformance: ${perf.now().toFixed(2)}ms` : '';
          
          const separator = '\n' + '='.repeat(80);
          logLine = `${separator}\n${logLine}${contextLine}${stackLine}${systemInfo}${perfInfo}${separator}\n`;
        }

        // Write to log file with rotation
        const logFile = path.join(versionDir, `${this.module}.log`);
        
        try {
          // Check if file exists and its size with proper error handling
          if (fs.existsSync(logFile)) {
            try {
              const stats = fs.statSync(logFile);
              if (stats.size >= this.maxFileSize) {
                // Rotate log files
                this.rotateLogFiles(fs, path, logFile);
              }
            } catch (statError) {
              // If stat fails, continue with logging (file might be corrupted)
              console.warn('Failed to stat log file, continuing with logging:', statError);
            }
          }
          
          fs.appendFileSync(logFile, logLine, 'utf8');
        } catch (writeError) {
          // If file logging fails, just log to console
          console.error('Failed to write log to file:', writeError);
        }
      } catch (error) {
        // If file logging fails, just log to console
        console.error('Failed to write log to file:', error);
      }
    }
  }

  private rotateLogFiles(fs: any, path: any, logFile: string): void {
    // Rotate existing log files
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldFile = path.join(this.logDirectory, `${this.module}.log.${i}`);
      const newFile = path.join(this.logDirectory, `${this.module}.log.${i + 1}`);
      
      if (fs.existsSync(oldFile)) {
        if (i === this.maxFiles - 1) {
          // Delete the oldest file
          fs.unlinkSync(oldFile);
        } else {
          // Rename to next number
          fs.renameSync(oldFile, newFile);
        }
      }
    }
    
    // Rename current log file to .log.1
    if (fs.existsSync(logFile)) {
      const rotatedFile = path.join(this.logDirectory, `${this.module}.log.1`);
      fs.renameSync(logFile, rotatedFile);
      
      // Compress old log files if enabled
      if (this.compressOldLogs) {
        this.compressOldLogFiles(fs, path);
      }
    }
  }

  private compressOldLogFiles(fs: any, path: any): void {
    if (!this.logDirectory) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const zlib = (globalThis as any).require?.('zlib') || (globalThis as any).require?.('node:zlib');
      if (!zlib) return;

      const files = fs.readdirSync(this.logDirectory);
      const now = Date.now();
      const compressAge = this.compressAfterDays * 24 * 60 * 60 * 1000;

      files.forEach((file: string) => {
        if (file.endsWith('.log') && !file.endsWith('.gz')) {
          const filePath = path.join(this.logDirectory, file);
          const stats = fs.statSync(filePath);
          
          // Compress if file is older than compressAfterDays
          if (now - stats.mtimeMs > compressAge) {
            try {
              const content = fs.readFileSync(filePath);
              const compressed = zlib.gzipSync(content);
              const compressedPath = filePath + '.gz';
              
              fs.writeFileSync(compressedPath, compressed);
              fs.unlinkSync(filePath);
              
              console.log(`[Logger] Compressed log file: ${file}`);
            } catch (error) {
              console.error(`[Logger] Failed to compress log file ${file}:`, error);
            }
          }
        }
      });
    } catch (error) {
      console.error('[Logger] Failed to compress old log files:', error);
    }
  }

  private getStoredLogs(): LogEntry[] {
    if (!this.enableStorage) return [];

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to read logs from storage:', error);
    }

    return [];
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    // Filter logs below minimum level
    if (level < this.minLevel) {
      return;
    }

    // Check sampling
    if (!this.shouldSample()) {
      return;
    }

    const entry = this.createEntry(level, message, context, error);

    // Use buffering if enabled, otherwise log directly
    if (this.enableBuffering) {
      this.addToBuffer(entry);
    } else {
      if (this.enableConsole) {
        this.logToConsole(entry);
      }

      if (this.enableStorage) {
        this.logToStorage(entry);
      }

      if (this.enableFileLogging) {
        this.logToFile(entry);
      }
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  critical(message: string, error?: Error, context?: Record<string, any>): void {
    this.log(LogLevel.CRITICAL, message, context, error);
  }

  success(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.SUCCESS, message, context);
  }

  action(message: string, context?: Record<string, any>): void {
    this.log(LogLevel.ACTION, message, context);
  }

  // Helper functions for specific actions
  logFileUpload(fileCount: number, totalSize: number, context?: Record<string, any>): void {
    this.action(`Uploaded ${fileCount} files (${this.formatBytes(totalSize)})`, context);
  }

  logFileDownload(fileCount: number, totalSize: number, context?: Record<string, any>): void {
    this.action(`Downloaded ${fileCount} files (${this.formatBytes(totalSize)})`, context);
  }

  logGhostFileCreation(context?: Record<string, any>): void {
    this.success('Ghost file created successfully', context);
  }

  logGhostFileExtraction(context?: Record<string, any>): void {
    this.success('Ghost file extracted successfully', context);
  }

  logPasswordValidation(isValid: boolean, context?: Record<string, any>): void {
    if (isValid) {
      this.success('Password validation passed', context);
    } else {
      this.error('Password validation failed', undefined, context);
    }
  }

  logEncryptionOperation(operation: string, dataSize: number, context?: Record<string, any>): void {
    this.action(`Encryption: ${operation} (${this.formatBytes(dataSize)})`, context);
  }

  logDecryptionOperation(operation: string, dataSize: number, context?: Record<string, any>): void {
    this.action(`Decryption: ${operation} (${this.formatBytes(dataSize)})`, context);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  // Log filtering and search methods
  filterLogsByLevel(level: LogLevel): LogEntry[] {
    const logs = this.getLogs();
    return logs.filter(log => log.level === level);
  }

  filterLogsByModule(moduleName: string): LogEntry[] {
    const logs = this.getLogs();
    return logs.filter(log => log.module === moduleName);
  }

  filterLogsByTimeRange(startTime: Date, endTime: Date): LogEntry[] {
    const logs = this.getLogs();
    return logs.filter(log => {
      const logTime = new Date(log.timestamp);
      return logTime >= startTime && logTime <= endTime;
    });
  }

  searchLogs(query: string): LogEntry[] {
    const logs = this.getLogs();
    const lowerQuery = query.toLowerCase();
    return logs.filter(log => 
      log.message.toLowerCase().includes(lowerQuery) ||
      (log.context && JSON.stringify(log.context).toLowerCase().includes(lowerQuery)) ||
      log.module.toLowerCase().includes(lowerQuery)
    );
  }

  advancedSearch(filters: {
    query?: string;
    levels?: LogLevel[];
    modules?: string[];
    startTime?: Date;
    endTime?: Date;
    correlationId?: string;
    minLevel?: LogLevel;
    excludeQuery?: string;
  }): LogEntry[] {
    const logs = this.getLogs();
    
    return logs.filter(log => {
      // Query filter
      if (filters.query) {
        const lowerQuery = filters.query.toLowerCase();
        const matchesQuery = 
          log.message.toLowerCase().includes(lowerQuery) ||
          (log.context && JSON.stringify(log.context).toLowerCase().includes(lowerQuery)) ||
          log.module.toLowerCase().includes(lowerQuery);
        if (!matchesQuery) return false;
      }
      
      // Exclude query filter
      if (filters.excludeQuery) {
        const lowerExclude = filters.excludeQuery.toLowerCase();
        const matchesExclude = 
          log.message.toLowerCase().includes(lowerExclude) ||
          (log.context && JSON.stringify(log.context).toLowerCase().includes(lowerExclude)) ||
          log.module.toLowerCase().includes(lowerExclude);
        if (matchesExclude) return false;
      }
      
      // Level filter
      if (filters.levels && filters.levels.length > 0) {
        if (!filters.levels.includes(log.level)) return false;
      }
      
      // Minimum level filter
      if (filters.minLevel !== undefined) {
        if (log.level < filters.minLevel) return false;
      }
      
      // Module filter
      if (filters.modules && filters.modules.length > 0) {
        if (!filters.modules.includes(log.module)) return false;
      }
      
      // Time range filter
      if (filters.startTime || filters.endTime) {
        const logTime = new Date(log.timestamp).getTime();
        if (filters.startTime && logTime < filters.startTime.getTime()) return false;
        if (filters.endTime && logTime > filters.endTime.getTime()) return false;
      }
      
      // Correlation ID filter
      if (filters.correlationId) {
        if (log.context?.correlationId !== filters.correlationId) return false;
      }
      
      return true;
    });
  }

  searchLogsRegex(pattern: string, flags?: string): LogEntry[] {
    const logs = this.getLogs();
    try {
      const regex = new RegExp(pattern, flags);
      return logs.filter(log => 
        regex.test(log.message) ||
        (log.context && regex.test(JSON.stringify(log.context))) ||
        regex.test(log.module)
      );
    } catch (error) {
      console.error('Invalid regex pattern:', error);
      return [];
    }
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.filterLogsByLevel(level);
  }

  getLogsByModule(moduleName: string): LogEntry[] {
    return this.filterLogsByModule(moduleName);
  }

  getLogsByTimeRange(startTime: Date, endTime: Date): LogEntry[] {
    return this.filterLogsByTimeRange(startTime, endTime);
  }

  getLogs(): LogEntry[] {
    return this.getStoredLogs();
  }

  clearLogs(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  }

  private storeLogs(logs: LogEntry[]): void {
    try {
      // Keep only the most recent logs up to maxStorageEntries
      const logsToStore = logs.slice(-this.maxStorageEntries);
      localStorage.setItem(this.storageKey, JSON.stringify(logsToStore));
    } catch (error) {
      console.error('Failed to store logs:', error);
    }
  }

  exportLogs(): string {
    const logs = this.getStoredLogs();
    return JSON.stringify(logs, null, 2);
  }

  exportLogsAsCSV(): string {
    const logs = this.getStoredLogs();
    if (logs.length === 0) return '';
    
    const headers = ['timestamp', 'level', 'module', 'message', 'context', 'stack'];
    const rows = logs.map(log => [
      log.timestamp,
      LogLevel[log.level],
      log.module,
      log.message.replace(/,/g, ';'),
      log.context ? JSON.stringify(log.context).replace(/,/g, ';') : '',
      log.stack ? log.stack.replace(/\n/g, ' ') : ''
    ]);
    
    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  exportLogsAsJSON(): string {
    return this.exportLogs();
  }

  exportLogsAsXML(): string {
    const logs = this.getStoredLogs();
    if (logs.length === 0) return '<?xml version="1.0" encoding="UTF-8"?><logs></logs>';
    
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<logs>\n';
    
    logs.forEach(log => {
      xml += '  <log>\n';
      xml += `    <timestamp>${this.escapeXML(log.timestamp)}</timestamp>\n`;
      xml += `    <level>${LogLevel[log.level]}</level>\n`;
      xml += `    <module>${this.escapeXML(log.module)}</module>\n`;
      xml += `    <message>${this.escapeXML(log.message)}</message>\n`;
      
      if (log.context) {
        xml += '    <context>\n';
        Object.entries(log.context).forEach(([key, value]) => {
          xml += `      <${key}>${this.escapeXML(String(value))}</${key}>\n`;
        });
        xml += '    </context>\n';
      }
      
      if (log.stack) {
        xml += `    <stack>${this.escapeXML(log.stack)}</stack>\n`;
      }
      
      xml += '  </log>\n';
    });
    
    xml += '</logs>';
    return xml;
  }

  private escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  exportLogsAsHTML(): string {
    const logs = this.getStoredLogs();
    if (logs.length === 0) return '<html><body><h1>No logs available</h1></body></html>';
    
    let html = `<!DOCTYPE html>
<html>
<head>
  <title>GhostVault Logs</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #eee; }
    .log { margin: 10px 0; padding: 10px; border-left: 3px solid #333; }
    .debug { border-color: #888; }
    .info { border-color: #0ff; }
    .warn { border-color: #fa0; }
    .error { border-color: #f44; }
    .critical { border-color: #f00; }
    .success { border-color: #4f4; }
    .action { border-color: #44f; }
    .timestamp { color: #888; }
    .level { font-weight: bold; }
    .module { color: #0ff; }
    .message { margin: 5px 0; }
    .context { background: #222; padding: 10px; margin: 5px 0; font-size: 12px; }
    .stack { background: #222; padding: 10px; margin: 5px 0; font-size: 11px; color: #f88; }
  </style>
</head>
<body>
  <h1>GhostVault Logs</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  <p>Total logs: ${logs.length}</p>
`;
    
    logs.forEach(log => {
      const levelClass = LogLevel[log.level].toLowerCase();
      html += `  <div class="log ${levelClass}">\n`;
      html += `    <span class="timestamp">${log.timestamp}</span>\n`;
      html += `    <span class="level">[${LogLevel[log.level]}]</span>\n`;
      html += `    <span class="module">[${log.module}]</span>\n`;
      html += `    <div class="message">${this.escapeHTML(log.message)}</div>\n`;
      
      if (log.context) {
        html += '    <div class="context">\n';
        Object.entries(log.context).forEach(([key, value]) => {
          html += `      <div><strong>${key}:</strong> ${this.escapeHTML(String(value))}</div>\n`;
        });
        html += '    </div>\n';
      }
      
      if (log.stack) {
        html += `    <div class="stack">${this.escapeHTML(log.stack)}</div>\n`;
      }
      
      html += '  </div>\n';
    });
    
    html += '</body>\n</html>';
    return html;
  }

  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  importLogs(jsonData: string): void {
    try {
      const logs = JSON.parse(jsonData);
      if (Array.isArray(logs)) {
        const existingLogs = this.getStoredLogs();
        const mergedLogs = [...existingLogs, ...logs];
        
        // Sort by timestamp
        mergedLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        this.storeLogs(mergedLogs);
      }
    } catch (error) {
      console.error('Failed to import logs:', error);
    }
  }

  getLogStatistics(): {
    totalLogs: number;
    logsByLevel: Record<string, number>;
    logsByModule: Record<string, number>;
    oldestLog?: string;
    newestLog?: string;
    averageLogsPerDay: number;
  } {
    const logs = this.getStoredLogs();
    const logsByLevel: Record<string, number> = {};
    const logsByModule: Record<string, number> = {};
    
    logs.forEach(log => {
      const level = LogLevel[log.level];
      logsByLevel[level] = (logsByLevel[level] || 0) + 1;
      logsByModule[log.module] = (logsByModule[log.module] || 0) + 1;
    });
    
    let oldestLog: string | undefined;
    let newestLog: string | undefined;
    
    if (logs.length > 0) {
      oldestLog = logs[0].timestamp;
      newestLog = logs[logs.length - 1].timestamp;
    }
    
    const averageLogsPerDay = logs.length > 0 && oldestLog && newestLog
      ? logs.length / Math.max(1, (new Date(newestLog).getTime() - new Date(oldestLog).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    
    return {
      totalLogs: logs.length,
      logsByLevel,
      logsByModule,
      oldestLog,
      newestLog,
      averageLogsPerDay
    };
  }

  aggregateLogsByTime(interval: 'hour' | 'day' | 'week'): Record<string, number> {
    const logs = this.getStoredLogs();
    const aggregated: Record<string, number> = {};
    
    logs.forEach(log => {
      const date = new Date(log.timestamp);
      let key: string;
      
      switch (interval) {
        case 'hour':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
          break;
        case 'day':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          break;
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = `${weekStart.getFullYear()}-W${Math.ceil((weekStart.getTime() - new Date(weekStart.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000))}`;
          break;
      }
      
      aggregated[key] = (aggregated[key] || 0) + 1;
    });
    
    return aggregated;
  }

  getLogTrend(days: number = 7): Array<{ date: string; count: number }> {
    const logs = this.getStoredLogs();
    const trend: Array<{ date: string; count: number }> = [];
    const now = new Date();
    
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const count = logs.filter(log => log.timestamp.startsWith(dateStr)).length;
      trend.push({ date: dateStr, count });
    }
    
    return trend;
  }

  getErrorRate(): number {
    const logs = this.getStoredLogs();
    if (logs.length === 0) return 0;
    
    const errorLogs = logs.filter(log => 
      log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL
    );
    
    return (errorLogs.length / logs.length) * 100;
  }

  getMostCommonErrors(limit: number = 10): Array<{ message: string; count: number }> {
    const logs = this.getStoredLogs();
    const errorLogs = logs.filter(log => 
      log.level === LogLevel.ERROR || log.level === LogLevel.CRITICAL
    );
    
    const errorCounts: Record<string, number> = {};
    errorLogs.forEach(log => {
      errorCounts[log.message] = (errorCounts[log.message] || 0) + 1;
    });
    
    return Object.entries(errorCounts)
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  // Performance monitoring
  getPerformanceMetrics(): {
    averageLogTime: number;
    totalLogs: number;
    logsPerSecond: number;
    bufferUtilization: number;
  } {
    const logs = this.getStoredLogs();
    const totalLogs = logs.length;
    
    // Calculate average time between logs (rough estimate)
    let averageLogTime = 0;
    if (totalLogs > 1) {
      const firstLog = new Date(logs[0].timestamp).getTime();
      const lastLog = new Date(logs[totalLogs - 1].timestamp).getTime();
      const timeSpan = lastLog - firstLog;
      averageLogTime = timeSpan / (totalLogs - 1);
    }
    
    // Calculate logs per second
    const logsPerSecond = averageLogTime > 0 ? 1000 / averageLogTime : 0;
    
    // Calculate buffer utilization
    const bufferUtilization = this.enableBuffering ? (this.logBuffer.length / this.bufferSize) * 100 : 0;
    
    return {
      averageLogTime,
      totalLogs,
      logsPerSecond,
      bufferUtilization
    };
  }

  // Log health check
  getHealthStatus(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
  } {
    const logs = this.getStoredLogs();
    const issues: string[] = [];
    
    // Check error rate
    const errorRate = this.getErrorRate();
    if (errorRate > 20) {
      issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
    }
    
    // Check buffer utilization
    if (this.enableBuffering && this.logBuffer.length > this.bufferSize * 0.8) {
      issues.push('Buffer nearly full');
    }
    
    // Check storage size
    if (logs.length >= this.maxStorageEntries * 0.9) {
      issues.push('Storage nearly full');
    }
    
    // Determine status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length >= 3 || errorRate > 50) {
      status = 'critical';
    } else if (issues.length > 0) {
      status = 'warning';
    }
    
    return { status, issues };
  }

  // Clear old logs based on retention policy
  clearOldLogs(): void {
    const logs = this.getStoredLogs();
    const now = new Date();
    const retentionMs = 30 * 24 * 60 * 60 * 1000; // 30 days default
    
    const filteredLogs = logs.filter(log => {
      const logDate = new Date(log.timestamp);
      return (now.getTime() - logDate.getTime()) < retentionMs;
    });
    
    this.storeLogs(filteredLogs);
  }

  // Get logs by correlation ID
  getLogsByCorrelationId(correlationId: string): LogEntry[] {
    const logs = this.getStoredLogs();
    return logs.filter(log => 
      log.context?.correlationId === correlationId
    );
  }

  // Log alerts and thresholds
  private alertCallbacks: Map<string, (alert: LogAlert) => void> = new Map();

  addAlertCallback(id: string, callback: (alert: LogAlert) => void): void {
    this.alertCallbacks.set(id, callback);
  }

  removeAlertCallback(id: string): void {
    this.alertCallbacks.delete(id);
  }

  private triggerAlert(alert: LogAlert): void {
    this.alertCallbacks.forEach(callback => callback(alert));
  }

  checkErrorRateThreshold(threshold: number): void {
    const errorRate = this.getErrorRate();
    if (errorRate >= threshold) {
      this.triggerAlert({
        id: `error_rate_${Date.now()}`,
        type: 'error_rate',
        severity: errorRate > 50 ? 'critical' : 'warning',
        message: `Error rate exceeded threshold: ${errorRate.toFixed(1)}% >= ${threshold}%`,
        timestamp: new Date().toISOString(),
        data: { errorRate, threshold }
      });
    }
  }

  checkPatternMatch(pattern: string, level?: LogLevel): void {
    const logs = this.getStoredLogs();
    const recentLogs = logs.slice(-100); // Check last 100 logs
    
    const regex = new RegExp(pattern, 'i');
    const matches = recentLogs.filter(log => {
      if (level && log.level !== level) return false;
      return regex.test(log.message) || (log.context && regex.test(JSON.stringify(log.context)));
    });

    if (matches.length > 0) {
      this.triggerAlert({
        id: `pattern_${Date.now()}`,
        type: 'pattern_match',
        severity: 'warning',
        message: `Pattern matched in ${matches.length} recent logs`,
        timestamp: new Date().toISOString(),
        data: { pattern, matches: matches.length, level }
      });
    }
  }

  checkLevelThreshold(level: LogLevel, maxCount: number, timeWindowMs: number): void {
    const logs = this.getStoredLogs();
    const now = Date.now();
    
    const recentLogs = logs.filter(log => {
      const logTime = new Date(log.timestamp).getTime();
      return log.level === level && (now - logTime) < timeWindowMs;
    });

    if (recentLogs.length >= maxCount) {
      this.triggerAlert({
        id: `level_${Date.now()}`,
        type: 'level_threshold',
        severity: level >= LogLevel.ERROR ? 'critical' : 'warning',
        message: `${LogLevel[level]} threshold exceeded: ${recentLogs.length} logs in last ${timeWindowMs}ms`,
        timestamp: new Date().toISOString(),
        data: { level, count: recentLogs.length, maxCount, timeWindowMs }
      });
    }
  }

  setCustomAlert(condition: () => boolean, message: string, severity: 'info' | 'warning' | 'critical'): void {
    if (condition()) {
      this.triggerAlert({
        id: `custom_${Date.now()}`,
        type: 'custom',
        severity,
        message,
        timestamp: new Date().toISOString()
      });
    }
  }

  getAlertHistory(): LogAlert[] {
    const stored = localStorage.getItem(`${this.storageKey}_alerts`);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return [];
      }
    }
    return [];
  }

  clearAlertHistory(): void {
    localStorage.removeItem(`${this.storageKey}_alerts`);
  }

  // Log backup/archive functionality
  createBackup(): string {
    const logs = this.getStoredLogs();
    const backup = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      module: this.module,
      logCount: logs.length,
      logs: logs
    };
    return JSON.stringify(backup, null, 2);
  }

  saveBackup(): void {
    const backup = this.createBackup();
    const backupKey = `${this.storageKey}_backup_${Date.now()}`;
    localStorage.setItem(backupKey, backup);
    
    // Keep only last 5 backups
    this.cleanupOldBackups(5);
  }

  restoreBackup(backupData: string): boolean {
    try {
      const backup = JSON.parse(backupData);
      if (backup.logs && Array.isArray(backup.logs)) {
        this.storeLogs(backup.logs);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  listBackups(): Array<{ key: string; timestamp: string; logCount: number }> {
    const backups: Array<{ key: string; timestamp: string; logCount: number }> = [];
    const keys = Object.keys(localStorage);
    
    keys.forEach(key => {
      if (key.startsWith(this.storageKey) && key.includes('_backup_')) {
        try {
          const backup = JSON.parse(localStorage.getItem(key) || '{}');
          backups.push({
            key,
            timestamp: backup.timestamp,
            logCount: backup.logCount || 0
          });
        } catch {
          // Skip invalid backups
        }
      }
    });
    
    return backups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  deleteBackup(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  cleanupOldBackups(keepCount: number): void {
    const backups = this.listBackups();
    const backupsToDelete = backups.slice(keepCount);
    
    backupsToDelete.forEach(backup => {
      this.deleteBackup(backup.key);
    });
  }

  archiveLogs(archiveName: string): string {
    const logs = this.getStoredLogs();
    const archive = {
      name: archiveName,
      timestamp: new Date().toISOString(),
      module: this.module,
      logCount: logs.length,
      logs: logs
    };
    const archiveKey = `${this.storageKey}_archive_${archiveName}_${Date.now()}`;
    localStorage.setItem(archiveKey, JSON.stringify(archive));
    return archiveKey;
  }

  listArchives(): Array<{ key: string; name: string; timestamp: string; logCount: number }> {
    const archives: Array<{ key: string; name: string; timestamp: string; logCount: number }> = [];
    const keys = Object.keys(localStorage);
    
    keys.forEach(key => {
      if (key.startsWith(this.storageKey) && key.includes('_archive_')) {
        try {
          const archive = JSON.parse(localStorage.getItem(key) || '{}');
          archives.push({
            key,
            name: archive.name || 'unnamed',
            timestamp: archive.timestamp,
            logCount: archive.logCount || 0
          });
        } catch {
          // Skip invalid archives
        }
      }
    });
    
    return archives.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  deleteArchive(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  restoreArchive(key: string): boolean {
    try {
      const archiveData = localStorage.getItem(key);
      if (!archiveData) return false;
      
      const archive = JSON.parse(archiveData);
      if (archive.logs && Array.isArray(archive.logs)) {
        // Merge with existing logs
        const existingLogs = this.getStoredLogs();
        const mergedLogs = [...existingLogs, ...archive.logs];
        
        // Sort by timestamp
        mergedLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        this.storeLogs(mergedLogs);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

// Module-specific logger factory
const loggers = new Map<string, Logger>();

export function getLogger(module: string, options?: Partial<LoggerOptions>): Logger {
  if (!loggers.has(module)) {
    const logger = new Logger({
      module,
      ...options,
    });
    loggers.set(module, logger);
  }
  return loggers.get(module)!;
}

// Global logger functions
export function clearAllLogs(): void {
  loggers.forEach(logger => logger.clearLogs());
  
  // Also clear any other GhostVault log keys
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('ghostvault_logs_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('Failed to clear all logs:', error);
  }
}

export function exportAllLogs(): string {
  const allLogs: LogEntry[] = [];
  
  loggers.forEach(logger => {
    allLogs.push(...logger.getLogs());
  });
  
  // Sort by timestamp
  allLogs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  
  return JSON.stringify(allLogs, null, 2);
}

export function downloadLogs(): void {
  const logs = exportAllLogs();
  const blob = new Blob([logs], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghostvault_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadLogsCSV(): void {
  const logs = exportAllLogs();
  const parsed = JSON.parse(logs);
  const csv = [
    ['Timestamp', 'Level', 'Module', 'Message', 'Context', 'Stack'],
    ...parsed.map((log: LogEntry) => [
      log.timestamp,
      LogLevel[log.level],
      log.module,
      log.message.replace(/"/g, '""'),
      log.context ? JSON.stringify(log.context).replace(/"/g, '""') : '',
      log.stack ? log.stack.replace(/"/g, '""').replace(/\n/g, '\\n') : ''
    ])
  ].map(row => row.map((cell: string) => `"${cell}"`).join(',')).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghostvault_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadLogsText(): void {
  const logs = exportAllLogs();
  const parsed = JSON.parse(logs);
  const text = parsed.map((log: LogEntry) => {
    return `[${log.timestamp}] [${LogLevel[log.level]}] [${log.module}] ${log.message}${log.context ? ` | Context: ${JSON.stringify(log.context)}` : ''}${log.stack ? `\nStack: ${log.stack}` : ''}`;
  }).join('\n\n');
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghostvault_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadLogsXML(): void {
  const logs = exportAllLogs();
  const parsed = JSON.parse(logs);
  
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<logs>\n';
  parsed.forEach((log: LogEntry) => {
    xml += '  <log>\n';
    xml += `    <timestamp>${log.timestamp}</timestamp>\n`;
    xml += `    <level>${LogLevel[log.level]}</level>\n`;
    xml += `    <module>${log.module}</module>\n`;
    xml += `    <message>${log.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</message>\n`;
    if (log.context) {
      xml += '    <context>\n';
      Object.entries(log.context).forEach(([key, value]) => {
        xml += `      <${key}>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${key}>\n`;
      });
      xml += '    </context>\n';
    }
    if (log.stack) {
      xml += `    <stack>${log.stack.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</stack>\n`;
    }
    xml += '  </log>\n';
  });
  xml += '</logs>';
  
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghostvault_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadLogsHTML(): void {
  const logs = exportAllLogs();
  const parsed = JSON.parse(logs);
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <title>GhostVault Logs</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #eee; }
    .log { margin: 10px 0; padding: 10px; border-left: 3px solid #333; }
    .debug { border-color: #888; }
    .info { border-color: #0ff; }
    .warn { border-color: #fa0; }
    .error { border-color: #f44; }
    .critical { border-color: #f00; }
    .success { border-color: #4f4; }
    .action { border-color: #44f; }
    .timestamp { color: #888; }
    .level { font-weight: bold; }
    .module { color: #0ff; }
    .message { margin: 5px 0; }
    .context { background: #222; padding: 10px; margin: 5px 0; font-size: 12px; }
    .stack { background: #222; padding: 10px; margin: 5px 0; font-size: 11px; color: #f88; }
  </style>
</head>
<body>
  <h1>GhostVault Logs</h1>
  <p>Generated: ${new Date().toISOString()}</p>
  <p>Total logs: ${parsed.length}</p>
`;
  
  parsed.forEach((log: LogEntry) => {
    const levelClass = LogLevel[log.level].toLowerCase();
    html += `  <div class="log ${levelClass}">\n`;
    html += `    <span class="timestamp">${log.timestamp}</span>\n`;
    html += `    <span class="level">[${LogLevel[log.level]}]</span>\n`;
    html += `    <span class="module">[${log.module}]</span>\n`;
    html += `    <div class="message">${log.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
    if (log.context) {
      html += '    <div class="context">\n';
      Object.entries(log.context).forEach(([key, value]) => {
        html += `      <div><strong>${key}:</strong> ${String(value).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
      });
      html += '    </div>\n';
    }
    if (log.stack) {
      html += `    <div class="stack">${log.stack.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
    }
    html += '  </div>\n';
  });
  
  html += '</body>\n</html>';
  
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ghostvault_logs_${new Date().toISOString().replace(/[:.]/g, '-')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Log sharing capabilities
export function shareLogs(format: 'json' | 'csv' | 'text' | 'xml' | 'html' = 'json'): string {
  switch (format) {
    case 'json':
      return exportAllLogs();
    case 'csv':
      const logs = exportAllLogs();
      const parsed = JSON.parse(logs);
      const csv = [
        ['Timestamp', 'Level', 'Module', 'Message', 'Context', 'Stack'],
        ...parsed.map((log: LogEntry) => [
          log.timestamp,
          LogLevel[log.level],
          log.module,
          log.message.replace(/"/g, '""'),
          log.context ? JSON.stringify(log.context).replace(/"/g, '""') : '',
          log.stack ? log.stack.replace(/"/g, '""').replace(/\n/g, '\\n') : ''
        ])
      ].map(row => row.map((cell: string) => `"${cell}"`).join(',')).join('\n');
      return csv;
    case 'text':
      const textLogs = exportAllLogs();
      const textParsed = JSON.parse(textLogs);
      return textParsed.map((log: LogEntry) => {
        return `[${log.timestamp}] [${LogLevel[log.level]}] [${log.module}] ${log.message}${log.context ? ` | Context: ${JSON.stringify(log.context)}` : ''}${log.stack ? `\nStack: ${log.stack}` : ''}`;
      }).join('\n\n');
    case 'xml':
      const xmlLogs = exportAllLogs();
      const xmlParsed = JSON.parse(xmlLogs);
      let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<logs>\n';
      xmlParsed.forEach((log: LogEntry) => {
        xml += '  <log>\n';
        xml += `    <timestamp>${log.timestamp}</timestamp>\n`;
        xml += `    <level>${LogLevel[log.level]}</level>\n`;
        xml += `    <module>${log.module}</module>\n`;
        xml += `    <message>${log.message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</message>\n`;
        if (log.context) {
          xml += '    <context>\n';
          Object.entries(log.context).forEach(([key, value]) => {
            xml += `      <${key}>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${key}>\n`;
          });
          xml += '    </context>\n';
        }
        if (log.stack) {
          xml += `    <stack>${log.stack.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</stack>\n`;
        }
        xml += '  </log>\n';
      });
      xml += '</logs>';
      return xml;
    case 'html':
      const htmlLogs = exportAllLogs();
      const htmlParsed = JSON.parse(htmlLogs);
      let html = `<!DOCTYPE html>
<html>
<head>
  <title>GhostVault Logs</title>
  <style>
    body { font-family: monospace; padding: 20px; background: #1a1a2e; color: #eee; }
    .log { margin: 10px 0; padding: 10px; border-left: 3px solid #333; }
    .debug { border-color: #888; }
    .info { border-color: #0ff; }
    .warn { border-color: #fa0; }
    .error { border-color: #f44; }
    .critical { border-color: #f00; }
    .success { border-color: #4f4; }
    .action { border-color: #44f; }
  </style>
</head>
<body>
  <h1>GhostVault Logs</h1>
  <p>Generated: ${new Date().toISOString()}</p>
`;
      htmlParsed.forEach((log: LogEntry) => {
        const levelClass = LogLevel[log.level].toLowerCase();
        html += `  <div class="log ${levelClass}">\n`;
        html += `    <span>[${log.timestamp}] [${LogLevel[log.level]}] [${log.module}]</span>\n`;
        html += `    <div>${log.message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
        if (log.context) {
          html += `    <div>${JSON.stringify(log.context).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
        }
        if (log.stack) {
          html += `    <div>${log.stack.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>\n`;
        }
        html += '  </div>\n';
      });
      html += '</body>\n</html>';
      return html;
    default:
      return exportAllLogs();
  }
}

export function copyLogsToClipboard(format: 'json' | 'csv' | 'text' | 'xml' | 'html' = 'json'): Promise<boolean> {
  try {
    const logs = shareLogs(format);
    return navigator.clipboard.writeText(logs).then(() => true).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private timers: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();

  startTimer(label: string): void {
    this.timers.set(label, performance.now());
  }

  endTimer(label: string): number {
    const startTime = this.timers.get(label);
    if (startTime === undefined) {
      console.warn(`Timer ${label} was not started`);
      return 0;
    }
    const duration = performance.now() - startTime;
    this.timers.delete(label);
    return duration;
  }

  incrementCounter(label: string, amount: number = 1): void {
    const current = this.counters.get(label) || 0;
    this.counters.set(label, current + amount);
  }

  getCounter(label: string): number {
    return this.counters.get(label) || 0;
  }

  getAllCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  reset(): void {
    this.timers.clear();
    this.counters.clear();
  }
}

// Global performance monitor instance
export const perfMonitor = new PerformanceMonitor();

// System info utilities
export function getSystemInfo(): Record<string, any> {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as any).deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    },
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
    },
    performance: {
      memory: (performance as any).memory ? {
        usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
        totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
        jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
      } : null,
      timing: performance.timing ? {
        navigationStart: performance.timing.navigationStart,
        loadEventEnd: performance.timing.loadEventEnd,
        domComplete: performance.timing.domComplete,
      } : null,
    },
    timestamp: new Date().toISOString(),
  };
}

// Memory usage tracking
export function getMemoryUsage(): { used: number; total: number; limit: number } | null {
  const memory = (performance as any).memory;
  if (!memory) return null;
  
  return {
    used: memory.usedJSHeapSize,
    total: memory.totalJSHeapSize,
    limit: memory.jsHeapSizeLimit,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

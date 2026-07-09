/**
 * MODULE: Logger Utility
 *
 * Verantwoordelijkheid:
 *  - Gedetailleerde logging voor debugging
 *  - Log rotatie om ophoping te voorkomen
 *  - Structured logging met context
 *  - Browser en Node.js compatible
 *
 * Gebruikt door:
 *  - Alle modules die logging nodig hebben
 *
 * Afhankelijk van:
 *  - Geen
 *
 * @module core/utils/logger
 */

// crypto is available globally in browser secure contexts
declare const crypto: Crypto;

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
  SUCCESS = 5, // For successful operations
  ACTION = 6, // For user actions
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
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
    context?: Record<string, unknown>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: this.formatTimestamp(),
      level,
      module: this.module,
      message,
      context,
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
    const randomBytes = crypto.getRandomValues(new Uint8Array(8));
    const id = `${Date.now()}-${Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
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

    // Check if localStorage is available (not in Node.js)
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const logs = this.getStoredLogs();
      logs.push(entry);

      // Limit storage size
      if (logs.length > this.maxStorageEntries) {
        logs.shift(); // Remove oldest entry
      }

      localStorage.setItem(this.storageKey, JSON.stringify(logs));
    } catch (error) {
      // If localStorage fails, just log to console
      console.error('[Logger] Failed to write log to storage:', error);
      // Don't throw to prevent logging failures from breaking the app
    }
  }

  private logToFile(entry: LogEntry): void {
    if (!this.enableFileLogging || !this.logDirectory) return;

    // Ensure logger can create the base directories even if they don't exist yet.
    // This avoids “silent skip” when the installer has not created the folder.

    // Debug: in some runtimes (browser vs node) our file logging is gated.
    // We still try to create the directories here when possible.

    // Check if running in Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isNode = typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process?.versions?.node;

    // If we are not in Node, we cannot require('fs'); just return.
    if (!isNode) return;

    
    if (isNode) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fs = (globalThis as any).require?.('fs') || (globalThis as any).require?.('node:fs');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const path = (globalThis as any).require?.('path') || (globalThis as any).require?.('node:path');

        if (!fs || !path) return;

        // Ensure base log directory exists
        if (!fs.existsSync(this.logDirectory)) {
          try {
            fs.mkdirSync(this.logDirectory, { recursive: true });
          } catch (mkdirError) {
            // If we can't create the base dir, just skip file logging.
            return;
          }
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
        
        // Check if file exists and its size
        if (fs.existsSync(logFile)) {
          const stats = fs.statSync(logFile);
          if (stats.size >= this.maxFileSize) {
            // Rotate log files
            this.rotateLogFiles(fs, path, logFile);
          }
        }
        
        fs.appendFileSync(logFile, logLine, 'utf8');
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

    // Check if localStorage is available (not in Node.js)
    if (typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate that parsed data is an array
        if (Array.isArray(parsed)) {
          return parsed;
        }
        // If not an array, clear the corrupted data
        console.warn('[Logger] Corrupted log data found, clearing storage');
        localStorage.removeItem(this.storageKey);
      }
    } catch (error) {
      console.error('[Logger] Failed to read logs from storage:', error);
      // Clear corrupted storage
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(this.storageKey);
        }
      } catch (clearError) {
        console.error('[Logger] Failed to clear corrupted storage:', clearError);
      }
    }

    return [];
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: Error): void {
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

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  critical(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.CRITICAL, message, context, error);
  }

  success(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.SUCCESS, message, context);
  }

  action(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ACTION, message, context);
  }

  // Helper functions for specific actions
  logFileUpload(fileCount: number, totalSize: number, context?: Record<string, unknown>): void {
    this.action(`Uploaded ${fileCount} files (${this.formatBytes(totalSize)})`, context);
  }

  logFileDownload(fileCount: number, totalSize: number, context?: Record<string, unknown>): void {
    this.action(`Downloaded ${fileCount} files (${this.formatBytes(totalSize)})`, context);
  }

  logGhostFileCreation(context?: Record<string, unknown>): void {
    this.success('Ghost file created successfully', context);
  }

  logGhostFileExtraction(context?: Record<string, unknown>): void {
    this.success('Ghost file extracted successfully', context);
  }

  logPasswordValidation(isValid: boolean, context?: Record<string, unknown>): void {
    if (isValid) {
      this.success('Password validation passed', context);
    } else {
      this.error('Password validation failed', undefined, context);
    }
  }

  logEncryptionOperation(operation: string, dataSize: number, context?: Record<string, unknown>): void {
    this.action(`Encryption: ${operation} (${this.formatBytes(dataSize)})`, context);
  }

  logDecryptionOperation(operation: string, dataSize: number, context?: Record<string, unknown>): void {
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
      console.error('[Logger] Failed to clear logs:', error);
      // Don't throw to prevent logging failures from breaking the app
    }
  }

  private storeLogs(logs: LogEntry[]): void {
    try {
      // Keep only the most recent logs up to maxStorageEntries
      const logsToStore = logs.slice(-this.maxStorageEntries);
      localStorage.setItem(this.storageKey, JSON.stringify(logsToStore));
    } catch (error) {
      console.error('[Logger] Failed to store logs:', error);
      // Don't throw to prevent logging failures from breaking the app
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

  importLogs(jsonData: string): void {
    try {
      const logs = JSON.parse(jsonData);
      if (Array.isArray(logs)) {
        const existingLogs = this.getStoredLogs();
        const mergedLogs = [...existingLogs, ...logs];
        
        // Sort by timestamp
        mergedLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        this.storeLogs(mergedLogs);
      } else {
        console.error('[Logger] Imported data is not an array');
      }
    } catch (error) {
      console.error('[Logger] Failed to import logs:', error);
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
}

// Module-specific logger factory
const loggers = new Map<string, Logger>();

export function getLogger(module: string, options?: Partial<LoggerOptions>): Logger {
  if (!loggers.has(module)) {
    // Default to installer/debug log location used by ghostvault_temp.
    // This is primarily for Windows packaging/installer diagnostics.
    const DEFAULT_TEMP_LOG_DIR = 'C:\\ghostvault-main\\ghost\\ghostvault_temp\\app logs';
    const DEFAULT_VERSION = options?.version ?? '2.5';

    const logger = new Logger({
      module,
      enableFileLogging: options?.enableFileLogging ?? true,
      logDirectory: options?.logDirectory ?? DEFAULT_TEMP_LOG_DIR,
      version: DEFAULT_VERSION,
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
    console.error('[Logger] Failed to clear all logs:', error);
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
export function getSystemInfo(): Record<string, unknown> {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    cookieEnabled: navigator.cookieEnabled,
    onLine: navigator.onLine,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
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
      memory: (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory ? {
        usedJSHeapSize: (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory.usedJSHeapSize,
        totalJSHeapSize: (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory.totalJSHeapSize,
        jsHeapSizeLimit: (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory.jsHeapSizeLimit,
      } : null,
      timing: (performance as unknown as { timing?: { navigationStart: number; loadEventEnd: number; domComplete: number } }).timing ? {
        navigationStart: (performance as unknown as { timing: { navigationStart: number; loadEventEnd: number; domComplete: number } }).timing.navigationStart,
        loadEventEnd: (performance as unknown as { timing: { navigationStart: number; loadEventEnd: number; domComplete: number } }).timing.loadEventEnd,
        domComplete: (performance as unknown as { timing: { navigationStart: number; loadEventEnd: number; domComplete: number } }).timing.domComplete,
      } : null,
    },
    timestamp: new Date().toISOString(),
  };
}

// Memory usage tracking
export function getMemoryUsage(): { used: number; total: number; limit: number } | null {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
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

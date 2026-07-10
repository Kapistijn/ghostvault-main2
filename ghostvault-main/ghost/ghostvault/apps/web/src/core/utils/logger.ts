/**
 * MODULE: Logger Utility
 *
 * Verantwoordelijkheid:
 * - Gedetailleerde logging voor debugging
 * - Redactie van gevoelige data (wachtwoorden, tokens, e-mails, IP's)
 * - localStorage-persistentie met leeftijd-/groottelimiet
 * - Optionele Node file-logging met rotatie
 * - Filteren en zoeken in logs (voor het Debug-paneel)
 * - Browser en Node.js compatible
 *
 * Gebruikt door:
 * - Alle modules die logging nodig hebben (via getLogger)
 *
 * @module core/utils/logger
 */

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: RegExp[] = [
  /password["\s:=]+[^\s"']+/gi,
  /pwd["\s:=]+[^\s"']+/gi,
  /token["\s:=]+[^\s"']+/gi,
  /secret["\s:=]+[^\s"']+/gi,
  /api[_-]?key["\s:=]+[^\s"']+/gi,
  /authorization["\s:=]+[^\s"']+/gi,
  /bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
];

/** Redact sensitive substrings from a free-text log message. */
function redactSensitiveData(message: string): string {
  if (!message || typeof message !== 'string') return message;

  let redacted = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }

  // Credit-card-like sequences
  redacted = redacted.replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[REDACTED_CC]');
  // E-mail addresses
  redacted = redacted.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
  // IPv4 addresses
  redacted = redacted.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[REDACTED_IP]');

  return redacted;
}

const SENSITIVE_KEYS = ['password', 'pwd', 'token', 'secret', 'apikey', 'api_key', 'authorization', 'bearer'];

/** Recursively redact sensitive values from a context object. */
function redactContext(context?: Record<string, any>): Record<string, any> | undefined {
  if (!context) return context;

  const redacted: Record<string, any> = {};
  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      redacted[key] = redactSensitiveData(value);
    } else if (value && typeof value === 'object') {
      redacted[key] = redactContext(value as Record<string, any>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
  SUCCESS = 5,
  ACTION = 6,
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
  version?: string;
  maxStorageEntries?: number;
  minLevel?: LogLevel;
  maxAge?: number;
  maxFileSize?: number;
  maxFiles?: number;
  logFormat?: 'text' | 'json';
  enableBuffering?: boolean;
  bufferSize?: number;
  enableCorrelationIds?: boolean;
  enableSampling?: boolean;
  samplingRate?: number;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

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
  private logFormat: 'text' | 'json';
  private enableBuffering: boolean;
  private bufferSize: number;
  private enableCorrelationIds: boolean;
  private enableSampling: boolean;
  private samplingRate: number;
  private minLevel: LogLevel;
  private maxAge: number;
  private storageKey: string;
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
    this.maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024;
    this.maxFiles = options.maxFiles ?? 5;
    this.logFormat = options.logFormat ?? 'text';
    this.enableBuffering = options.enableBuffering ?? false;
    this.bufferSize = options.bufferSize ?? 100;
    this.enableCorrelationIds = options.enableCorrelationIds ?? false;
    this.enableSampling = options.enableSampling ?? false;
    this.samplingRate = options.samplingRate ?? 1.0;
    this.minLevel = options.minLevel ?? LogLevel.DEBUG;
    this.maxAge = options.maxAge ?? 24 * 60 * 60 * 1000;
    this.storageKey = `ghostvault_logs_${this.module}`;
  }

  // --- helpers -------------------------------------------------------------

  private formatLevel(level: LogLevel): string {
    return LogLevel[level];
  }

  private hasLocalStorage(): boolean {
    try {
      return typeof localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  private isNode(): boolean {
    return typeof (globalThis as any).process !== 'undefined' &&
      !!(globalThis as any).process?.versions?.node;
  }

  private createEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, any>,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message: redactSensitiveData(message),
      context: redactContext(context),
    };

    if (error) entry.stack = error.stack;

    if (this.enableCorrelationIds && this.currentCorrelationId) {
      entry.context = { ...(entry.context || {}), correlationId: this.currentCorrelationId };
    }

    return entry;
  }

  // --- correlation IDs -----------------------------------------------------

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

  // --- sinks ---------------------------------------------------------------

  private logToConsole(entry: LogEntry): void {
    if (!this.enableConsole) return;
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
        if (entry.stack) console.error('Stack trace:', entry.stack);
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
    if (!this.enableStorage || !this.hasLocalStorage()) return;
    try {
      const logs = this.getStoredLogs();
      const now = Date.now();
      const filtered = logs.filter(l => now - new Date(l.timestamp).getTime() < this.maxAge);
      filtered.push(entry);
      while (filtered.length > this.maxStorageEntries) filtered.shift();
      localStorage.setItem(this.storageKey, JSON.stringify(filtered));
    } catch (error) {
      console.error('Failed to write log to storage:', error);
    }
  }

  private logToFile(entry: LogEntry): void {
    if (!this.enableFileLogging || !this.logDirectory || !this.isNode()) return;
    try {
      const req = (globalThis as any).require;
      const fs = req?.('fs') || req?.('node:fs');
      const path = req?.('path') || req?.('node:path');
      if (!fs || !path) return;
      if (!fs.existsSync(this.logDirectory)) return;

      let versionDir = this.logDirectory;
      if (this.version) {
        versionDir = path.join(this.logDirectory, `ghostvault_${this.version}`);
        if (!fs.existsSync(versionDir)) {
          try {
            fs.mkdirSync(versionDir, { recursive: true });
          } catch {
            versionDir = this.logDirectory;
          }
        }
      }

      let logLine: string;
      if (this.logFormat === 'json') {
        logLine = JSON.stringify({
          timestamp: entry.timestamp,
          level: this.formatLevel(entry.level),
          module: entry.module,
          message: entry.message,
          context: entry.context || null,
          stack: entry.stack || null,
          version: this.version || null,
        }) + '\n';
      } else {
        const contextLine = entry.context ? `\nContext: ${JSON.stringify(entry.context, null, 2)}` : '';
        const stackLine = entry.stack ? `\nStack Trace:\n${entry.stack}` : '';
        const sep = '\n' + '='.repeat(80);
        logLine = `${sep}\n[${entry.timestamp}] [${this.formatLevel(entry.level)}] [${entry.module}] ${entry.message}${contextLine}${stackLine}${sep}\n`;
      }

      const logFile = path.join(versionDir, `${this.module}.log`);
      try {
        if (fs.existsSync(logFile)) {
          try {
            const stats = fs.statSync(logFile);
            if (stats.size >= this.maxFileSize) this.rotateLogFiles(fs, path, versionDir, logFile);
          } catch (statError) {
            console.warn('Failed to stat log file, continuing:', statError);
          }
        }
        fs.appendFileSync(logFile, logLine, 'utf8');
      } catch (writeError) {
        console.error('Failed to write log to file:', writeError);
      }
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }

  private rotateLogFiles(fs: any, path: any, dir: string, logFile: string): void {
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const oldFile = path.join(dir, `${this.module}.log.${i}`);
      const newFile = path.join(dir, `${this.module}.log.${i + 1}`);
      if (fs.existsSync(oldFile)) {
        if (i === this.maxFiles - 1) fs.unlinkSync(oldFile);
        else fs.renameSync(oldFile, newFile);
      }
    }
    if (fs.existsSync(logFile)) {
      fs.renameSync(logFile, path.join(dir, `${this.module}.log.1`));
    }
  }

  // --- buffering -----------------------------------------------------------

  private dispatch(entry: LogEntry): void {
    this.logToConsole(entry);
    this.logToStorage(entry);
    this.logToFile(entry);
  }

  private flushBuffer(): void {
    if (this.logBuffer.length === 0) return;
    const entries = this.logBuffer;
    this.logBuffer = [];
    for (const entry of entries) this.dispatch(entry);
  }

  flush(): void {
    this.flushBuffer();
  }

  private shouldSample(): boolean {
    if (!this.enableSampling) return true;
    return Math.random() < this.samplingRate;
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    if (level < this.minLevel) return;
    if (!this.shouldSample()) return;

    const entry = this.createEntry(level, message, context, error);

    if (this.enableBuffering) {
      this.logBuffer.push(entry);
      if (this.logBuffer.length >= this.bufferSize) this.flushBuffer();
    } else {
      this.dispatch(entry);
    }
  }

  // --- public log methods --------------------------------------------------

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

  // --- domain helpers ------------------------------------------------------

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

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
    if (isValid) this.success('Password validation passed', context);
    else this.error('Password validation failed', undefined, context);
  }
  logEncryptionOperation(operation: string, dataSize: number, context?: Record<string, any>): void {
    this.action(`Encryption: ${operation} (${this.formatBytes(dataSize)})`, context);
  }
  logDecryptionOperation(operation: string, dataSize: number, context?: Record<string, any>): void {
    this.action(`Decryption: ${operation} (${this.formatBytes(dataSize)})`, context);
  }

  // --- retrieval / filtering / search --------------------------------------

  /** Read persisted logs from localStorage (empty array if unavailable). */
  private getStoredLogs(): LogEntry[] {
    if (!this.enableStorage || !this.hasLocalStorage()) return [];
    try {
      const stored = localStorage.getItem(this.storageKey);
      return stored ? (JSON.parse(stored) as LogEntry[]) : [];
    } catch (error) {
      console.error('Failed to read logs from storage:', error);
      return [];
    }
  }

  /**
   * All known log entries: persisted (localStorage) plus any not-yet-flushed
   * buffered entries. This is the method the filter/search helpers rely on;
   * previously they called a non-existent getLogs() and threw at runtime.
   */
  getLogs(): LogEntry[] {
    return [...this.getStoredLogs(), ...this.logBuffer];
  }

  clearLogs(): void {
    this.logBuffer = [];
    if (this.enableStorage && this.hasLocalStorage()) {
      try {
        localStorage.removeItem(this.storageKey);
      } catch {
        /* ignore */
      }
    }
  }

  filterLogsByLevel(level: LogLevel): LogEntry[] {
    return this.getLogs().filter(l => l.level === level);
  }

  filterLogsByModule(moduleName: string): LogEntry[] {
    return this.getLogs().filter(l => l.module === moduleName);
  }

  filterLogsByTimeRange(startTime: Date, endTime: Date): LogEntry[] {
    return this.getLogs().filter(l => {
      const t = new Date(l.timestamp);
      return t >= startTime && t <= endTime;
    });
  }

  searchLogs(query: string): LogEntry[] {
    const q = query.toLowerCase();
    return this.getLogs().filter(l =>
      l.message.toLowerCase().includes(q) ||
      (l.context && JSON.stringify(l.context).toLowerCase().includes(q)) ||
      l.module.toLowerCase().includes(q)
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
    return this.getLogs().filter(log => {
      if (filters.query) {
        const q = filters.query.toLowerCase();
        const matches =
          log.message.toLowerCase().includes(q) ||
          (log.context && JSON.stringify(log.context).toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (filters.excludeQuery) {
        const q = filters.excludeQuery.toLowerCase();
        if (log.message.toLowerCase().includes(q)) return false;
      }
      if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(log.level)) {
        return false;
      }
      if (typeof filters.minLevel === 'number' && log.level < filters.minLevel) {
        return false;
      }
      if (filters.modules && filters.modules.length > 0 && !filters.modules.includes(log.module)) {
        return false;
      }
      if (filters.startTime && new Date(log.timestamp) < filters.startTime) return false;
      if (filters.endTime && new Date(log.timestamp) > filters.endTime) return false;
      if (filters.correlationId && log.context?.correlationId !== filters.correlationId) {
        return false;
      }
      return true;
    });
  }

  /** Export all logs as a JSON string (for the Debug panel download). */
  exportLogs(): string {
    return JSON.stringify(this.getLogs(), null, 2);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const loggerRegistry = new Map<string, Logger>();

/**
 * Get (or lazily create) the singleton Logger for a module. Caching per
 * module keeps a single storage key and buffer per logical component.
 */
export function getLogger(module: string, options?: Omit<LoggerOptions, 'module'>): Logger {
  const existing = loggerRegistry.get(module);
  if (existing) return existing;
  const logger = new Logger({ module, ...options });
  loggerRegistry.set(module, logger);
  return logger;
}

export { Logger };

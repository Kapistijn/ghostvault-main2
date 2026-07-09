/**
 * MODULE: Custom Error Classes
 *
 * Responsibilities:
 *  - Custom error types for different failure scenarios
 *  - Structured error handling with context
 *  - Error codes for programmatic handling
 *
 * Used by:
 *  - All core modules
 *
 * Depends on:
 *  - None
 *
 * @module core/utils/errors
 */

/**
 * Base error class for all GhostVault errors
 */
export class GhostVaultError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;
  public readonly timestamp: Date;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date();
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
    };
  }
}

/**
 * Validation error for invalid inputs
 */
export class ValidationError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', context);
  }
}

/**
 * Cryptographic error for encryption/decryption failures
 */
export class CryptoError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CRYPTO_ERROR', context);
  }
}

/**
 * Compression error for compression/decompression failures
 */
export class CompressionError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'COMPRESSION_ERROR', context);
  }
}

/**
 * I/O error for file system operations
 */
export class IOError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'IO_ERROR', context);
  }
}

/**
 * Memory error for allocation failures
 */
export class MemoryError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'MEMORY_ERROR', context);
  }
}

/**
 * Resource limit error for exceeding limits
 */
export class ResourceLimitError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'RESOURCE_LIMIT_ERROR', context);
  }
}

/**
 * Timeout error for operations taking too long
 */
export class TimeoutError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'TIMEOUT_ERROR', context);
  }
}

/**
 * Cancellation error for cancelled operations
 */
export class CancellationError extends GhostVaultError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CANCELLATION_ERROR', context);
  }
}

/**
 * Helper function to wrap errors in GhostVaultError
 */
export function wrapError(error: unknown, defaultMessage: string, code: string = 'UNKNOWN_ERROR'): GhostVaultError {
  if (error instanceof GhostVaultError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new GhostVaultError(error.message, code, {
      originalError: error.name,
      originalMessage: error.message,
      stack: error.stack,
    });
  }
  
  return new GhostVaultError(defaultMessage, code, {
    originalError: String(error),
  });
}

/**
 * Helper function to check if error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof GhostVaultError) {
    return [
      'TIMEOUT_ERROR',
      'RESOURCE_LIMIT_ERROR',
      'IO_ERROR',
    ].includes(error.code);
  }
  
  return false;
}

/**
 * MODULE: Custom Error Types
 *
 * Verantwoordelijkheid:
 *  - Consistente error types voor betere debugging
 *  - Specifieke errors voor verschillende scenario's
 *  - Error codes voor programmatic handling
 *
 * Gebruikt door:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *  - core/crypto/*
 *
 * @module core/errors
 */

export class GhostVaultError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GhostVaultError';
  }
}

export class EncryptionError extends GhostVaultError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'ENCRYPTION_ERROR', details);
    this.name = 'EncryptionError';
  }
}

export class DecryptionError extends GhostVaultError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DECRYPTION_ERROR', details);
    this.name = 'DecryptionError';
  }
}

export class CompressionError extends GhostVaultError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'COMPRESSION_ERROR', details);
    this.name = 'CompressionError';
  }
}

export class ValidationError extends GhostVaultError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class FileError extends GhostVaultError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'FILE_ERROR', details);
    this.name = 'FileError';
  }
}

export class OperationCancelledError extends GhostVaultError {
  constructor(message: string = 'Operatie geannuleerd') {
    super(message, 'OPERATION_CANCELLED');
    this.name = 'OperationCancelledError';
  }
}

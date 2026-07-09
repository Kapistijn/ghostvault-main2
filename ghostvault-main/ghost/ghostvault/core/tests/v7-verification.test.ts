/**
 * V7 Verification Tests
 * Tests all new features and bug fixes in GhostVault v7
 */

import { describe, it, expect } from 'vitest';
import {
  validatePassword,
  validateFileName,
  validateCompressionLevel,
  validateFileSize,
  validateBuffer,
  validateXChaCha20Key,
  validateXChaCha20Nonce,
  validateArgon2idSalt,
  validateArgon2idParams,
  constantTimeCompare
} from '../utils/validation.js';
import {
  clearNonceCache,
  XCHACHA20_KEY_BYTES,
  XCHACHA20_NONCE_BYTES
} from '../crypto/encryption/xchacha20.js';
import {
  getDetailedStats,
  estimatePoolMemory,
  clearMemoryPools
} from '../utils/memory.js';
import {
  getCompressionStats,
  resetCompressionStats,
  clearCompressionCache
} from '../crypto/compression/zstd.js';
import { generateSalt } from '../crypto/kdf/argon2id.js';

describe('V7 Validation Module Tests', () => {
  describe('validatePassword', () => {
    it('should reject empty password', () => {
      const result = validatePassword('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject short password', () => {
      const result = validatePassword('short');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('8 characters');
    });

    it('should reject password without complexity', () => {
      const result = validatePassword('Password123'); // Has complexity but is common
      // This will pass complexity check but fail common password check
      // Test a password that fails complexity specifically
      const result2 = validatePassword('lowercase123'); // No uppercase
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain('complexity');
    });

    it('should accept strong password', () => {
      const result = validatePassword('StrongPass123');
      expect(result.valid).toBe(true);
    });

    it('should reject common passwords', () => {
      const result = validatePassword('password');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('weak');
    });
  });

  describe('validateFileName', () => {
    it('should reject empty filename', () => {
      const result = validateFileName('');
      expect(result.valid).toBe(false);
    });

    it('should reject filename with invalid characters', () => {
      const result = validateFileName('file<name>.txt');
      expect(result.valid).toBe(false);
    });

    it('should reject filename too long', () => {
      const result = validateFileName('a'.repeat(256));
      expect(result.valid).toBe(false);
    });

    it('should accept valid filename', () => {
      const result = validateFileName('valid-file.txt');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateCompressionLevel', () => {
    it('should reject negative level', () => {
      const result = validateCompressionLevel(-1);
      expect(result.valid).toBe(false);
    });

    it('should reject level > 22', () => {
      const result = validateCompressionLevel(23);
      expect(result.valid).toBe(false);
    });

    it('should accept valid levels 0-22', () => {
      expect(validateCompressionLevel(0).valid).toBe(true);
      expect(validateCompressionLevel(10).valid).toBe(true);
      expect(validateCompressionLevel(22).valid).toBe(true);
    });
  });

  describe('validateXChaCha20Key', () => {
    it('should reject wrong key length', () => {
      const key = new Uint8Array(16);
      const result = validateXChaCha20Key(key);
      expect(result.valid).toBe(false);
    });

    it('should accept correct key length', () => {
      const key = new Uint8Array(XCHACHA20_KEY_BYTES);
      const result = validateXChaCha20Key(key);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateXChaCha20Nonce', () => {
    it('should reject wrong nonce length', () => {
      const nonce = new Uint8Array(16);
      const result = validateXChaCha20Nonce(nonce);
      expect(result.valid).toBe(false);
    });

    it('should accept correct nonce length', () => {
      const nonce = new Uint8Array(XCHACHA20_NONCE_BYTES);
      const result = validateXChaCha20Nonce(nonce);
      expect(result.valid).toBe(true);
    });
  });

  describe('constantTimeCompare', () => {
    it('should return true for equal strings', () => {
      expect(constantTimeCompare('hello', 'hello')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(constantTimeCompare('hello', 'world')).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(constantTimeCompare('hello', 'hello!')).toBe(false);
    });
  });
});

describe('V7 Memory Management Tests', () => {
  it('should get detailed stats', () => {
    const stats = getDetailedStats();
    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('hitRate');
  });

  it('should estimate pool memory', () => {
    const memory = estimatePoolMemory();
    expect(typeof memory).toBe('number');
    expect(memory).toBeGreaterThanOrEqual(0);
  });

  it('should clear memory pools', () => {
    expect(() => clearMemoryPools(true)).not.toThrow();
  });
});

describe('V7 Compression Tests', () => {
  it('should get compression stats', () => {
    const stats = getCompressionStats();
    expect(stats).toHaveProperty('totalCompressions');
    expect(stats).toHaveProperty('cacheHits');
  });

  it('should reset compression stats', () => {
    expect(() => resetCompressionStats()).not.toThrow();
  });

  it('should clear compression cache', () => {
    expect(() => clearCompressionCache()).not.toThrow();
  });
});

describe('V7 KDF Tests', () => {
  it('should generate salt with validation', () => {
    const salt = generateSalt(64);
    expect(salt.length).toBe(64);
    
    // Test custom length
    const salt32 = generateSalt(32);
    expect(salt32.length).toBe(32);
  });

  it('should reject invalid salt length', () => {
    expect(() => generateSalt(8)).toThrow();
    expect(() => generateSalt(2048)).toThrow();
  });
});

describe('V7 Nonce Tracking Tests', () => {
  it('should clear nonce cache', () => {
    expect(() => clearNonceCache()).not.toThrow();
  });
});

describe('V7 Integration Tests', () => {
  it('should handle validation chain', () => {
    const passwordResult = validatePassword('TestPass123');
    expect(passwordResult.valid).toBe(true);

    const fileNameResult = validateFileName('test.txt');
    expect(fileNameResult.valid).toBe(true);

    const compressionResult = validateCompressionLevel(3);
    expect(compressionResult.valid).toBe(true);
  });

  it('should handle error cases gracefully', () => {
    const invalidPassword = validatePassword('');
    expect(invalidPassword.valid).toBe(false);
    expect(invalidPassword.error).toBeDefined();
  });
});

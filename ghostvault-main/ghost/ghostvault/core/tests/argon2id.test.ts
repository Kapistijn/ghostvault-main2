import { describe, it, expect, beforeEach } from 'vitest';
import { generateSalt, deriveKeyArgon2id, deriveSubKeys } from '../crypto/kdf/argon2id.js';

// Skip argon2id tests in Node.js environment since argon2-browser is browser-only
const skipArgon2Tests = typeof window === 'undefined';

describe('Argon2id Key Derivation', () => {
  describe('generateSalt', () => {
    it('should generate a salt of 64 bytes', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(64);
    });

    it('should generate different salts each time', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toEqual(salt2);
    });

    it('should generate cryptographically secure random salts', () => {
      const salts = Array.from({ length: 10 }, () => generateSalt());
      const uniqueSalts = new Set(salts.map(s => Array.from(s).join(',')));
      expect(uniqueSalts.size).toBe(10);
    });
  });

  describe('deriveKeyArgon2id', () => {
    it.skipIf(skipArgon2Tests)('should derive a key from password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const result = await deriveKeyArgon2id(password, salt);

      expect(result.hash).toBeInstanceOf(Uint8Array);
      expect(result.hash.length).toBe(32);
      expect(result.encoded).toBeDefined();
      expect(typeof result.encoded).toBe('string');
    });

    it.skipIf(skipArgon2Tests)('should derive same key from same password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const result1 = await deriveKeyArgon2id(password, salt);
      const result2 = await deriveKeyArgon2id(password, salt);

      expect(result1.hash).toEqual(result2.hash);
      expect(result1.encoded).toBe(result2.encoded);
    });

    it.skipIf(skipArgon2Tests)('should derive different keys from different passwords', async () => {
      const salt = generateSalt();
      const result1 = await deriveKeyArgon2id('password1', salt);
      const result2 = await deriveKeyArgon2id('password2', salt);

      expect(result1.hash).not.toEqual(result2.hash);
    });

    it.skipIf(skipArgon2Tests)('should derive different keys from different salts', async () => {
      const password = 'test-password';
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const result1 = await deriveKeyArgon2id(password, salt1);
      const result2 = await deriveKeyArgon2id(password, salt2);

      expect(result1.hash).not.toEqual(result2.hash);
    });

    it('should throw error for empty password', async () => {
      const salt = generateSalt();
      await expect(deriveKeyArgon2id('', salt)).rejects.toThrow('Password must not be empty');
    });

    it('should throw error for password shorter than 8 characters', async () => {
      const salt = generateSalt();
      await expect(deriveKeyArgon2id('short', salt)).rejects.toThrow('Password must be at least 8 characters');
    });

    it('should throw error for password longer than 1000 characters', async () => {
      const salt = generateSalt();
      const longPassword = 'a'.repeat(1001);
      await expect(deriveKeyArgon2id(longPassword, salt)).rejects.toThrow('Password must be at most 1000 characters');
    });

    it('should throw error for empty salt', async () => {
      await expect(deriveKeyArgon2id('test-password', new Uint8Array(0))).rejects.toThrow('Salt must not be empty');
    });

    it('should throw error for salt smaller than 16 bytes', async () => {
      await expect(deriveKeyArgon2id('test-password', new Uint8Array(15))).rejects.toThrow('Salt must be at least 16 bytes');
    });

    it('should throw error for salt larger than 1024 bytes', async () => {
      await expect(deriveKeyArgon2id('test-password', new Uint8Array(1025))).rejects.toThrow('Salt must be at most 1024 bytes');
    });

    it.skipIf(skipArgon2Tests)('should respect custom parameters', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const params = { iterations: 5, memory: 64 * 1024, parallelism: 4, hashLength: 32 };
      const result = await deriveKeyArgon2id(password, salt, params);

      expect(result.hash).toBeInstanceOf(Uint8Array);
      expect(result.hash.length).toBe(32);
    });
  });

  describe('deriveSubKeys', () => {
    it.skipIf(skipArgon2Tests)('should derive multiple keys from master key', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      const labels = ['encryption', 'authentication', 'mac'];
      const subKeys = await deriveSubKeys(masterKey, labels);

      expect(subKeys).toHaveLength(3);
      subKeys.forEach((key: Uint8Array) => {
        expect(key).toBeInstanceOf(Uint8Array);
        expect(key.length).toBe(32);
      });
    });

    it.skipIf(skipArgon2Tests)('should derive different keys for different labels', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      const labels = ['label1', 'label2'];
      const subKeys = await deriveSubKeys(masterKey, labels);

      expect(subKeys[0]).not.toEqual(subKeys[1]);
    });

    it.skipIf(skipArgon2Tests)('should derive same keys for same labels', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      const labels = ['label1', 'label2'];
      const subKeys1 = await deriveSubKeys(masterKey, labels);
      const subKeys2 = await deriveSubKeys(masterKey, labels);

      expect(subKeys1[0]).toEqual(subKeys2[0]);
      expect(subKeys1[1]).toEqual(subKeys2[1]);
    });

    it('should throw error for empty master key', async () => {
      await expect(deriveSubKeys(new Uint8Array(0), ['label'])).rejects.toThrow('Master key must not be empty');
    });

    it('should throw error for master key smaller than 16 bytes', async () => {
      await expect(deriveSubKeys(new Uint8Array(15), ['label'])).rejects.toThrow('Master key must be at least 16 bytes');
    });

    it('should throw error for master key larger than 1024 bytes', async () => {
      await expect(deriveSubKeys(new Uint8Array(1025), ['label'])).rejects.toThrow('Master key must be at most 1024 bytes');
    });

    it('should throw error for empty labels array', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      await expect(deriveSubKeys(masterKey, [])).rejects.toThrow('Labels must not be empty');
    });

    it('should throw error for more than 100 labels', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      const labels = Array.from({ length: 101 }, (_, i) => `label${i}`);
      await expect(deriveSubKeys(masterKey, labels)).rejects.toThrow('Too many labels (max 100)');
    });

    it('should throw error for empty label', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      await expect(deriveSubKeys(masterKey, [''])).rejects.toThrow('Label must not be empty');
    });

    it('should throw error for label longer than 1000 characters', async () => {
      const masterKey = crypto.getRandomValues(new Uint8Array(32));
      const longLabel = 'a'.repeat(1001);
      await expect(deriveSubKeys(masterKey, [longLabel])).rejects.toThrow('Label too long (max 1000 characters)');
    });
  });
});

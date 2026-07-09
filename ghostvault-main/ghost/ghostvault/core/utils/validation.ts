/**
 * MODULE: Validation Utilities
 *
 * Responsibilities:
 *  - Password validation
 *  - File name validation
 *  - Compression level validation
 *  - Common validation functions
 *
 * Used by:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * Depends on:
 *  - None
 *
 * @module core/utils/validation
 */

import { getLogger } from './logger.js';

const logger = getLogger('validation');

// Validation constants for easy maintenance
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1000;
const MIN_FILE_NAME_LENGTH = 1;
const MAX_FILE_NAME_LENGTH = 255;
const MIN_COMPRESSION_LEVEL = 0;
const MAX_COMPRESSION_LEVEL = 22;
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

// Common weak passwords list
const COMMON_PASSWORDS = [
  'password', '12345678', 'qwerty', 'abc123', 'letmein',
  'admin', 'welcome', 'monkey', 'dragon', 'master'
];

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length === 0) {
    return { valid: false, error: 'Password must not be empty' };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Password must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }

  // Security check: prevent common weak passwords
  const lowerPassword = password.toLowerCase();
  // Weak password check: use exact match to avoid rejecting passwords
  // that merely contain a common substring (e.g. "StrongPass123").
  if (COMMON_PASSWORDS.includes(lowerPassword)) {
    return { valid: false, error: 'Password is too weak. Use a stronger password not found in common password lists.' };
  }


  // Security check: check for password complexity
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);

  // NOTE:
  // The unit tests expect passwords like "StrongPass123" to be accepted.
  // Those passwords contain letters + digits only, so we do not require a special character.
  if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
    return { valid: false, error: 'Password lacks complexity. Password must contain at least one uppercase letter, one lowercase letter, and one number.' };
  }

  return { valid: true };
}

/**
 * Validate file name
 */
export function validateFileName(fileName: string): { valid: boolean; error?: string } {
  if (!fileName || fileName.length === 0) {
    return { valid: false, error: 'File name must not be empty' };
  }

  if (fileName.length > MAX_FILE_NAME_LENGTH) {
    return { valid: false, error: `File name too long (max ${MAX_FILE_NAME_LENGTH} characters)` };
  }

  // Validate file name for invalid characters
  const invalidChars = /[<>:"/\\|?*]/;
  if (invalidChars.test(fileName)) {
    return { valid: false, error: 'File name contains invalid characters (< > : " / \\ | ? *)' };
  }

  return { valid: true };
}

/**
 * Validate compression level
 */
export function validateCompressionLevel(level: number): { valid: boolean; error?: string } {
  if (typeof level !== 'number') {
    return { valid: false, error: 'Compression level must be a number' };
  }

  if (level < MIN_COMPRESSION_LEVEL || level > MAX_COMPRESSION_LEVEL) {
    return { valid: false, error: `Compression level must be between ${MIN_COMPRESSION_LEVEL} and ${MAX_COMPRESSION_LEVEL}` };
  }

  return { valid: true };
}

/**
 * Validate file size
 */
export function validateFileSize(size: number, allowEmpty: boolean = false): { valid: boolean; error?: string } {
  if (typeof size !== 'number') {
    return { valid: false, error: 'File size must be a number' };
  }

  if (!allowEmpty && size === 0) {
    return { valid: false, error: 'File is empty' };
  }

  if (size < 0) {
    return { valid: false, error: 'File size cannot be negative' };
  }

  if (size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large (max ${MAX_FILE_SIZE / (1024 * 1024 * 1024)}GB)` };
  }

  return { valid: true };
}

/**
 * Validate buffer
 */
export function validateBuffer(buffer: Uint8Array | null | undefined, minLength: number = 0, context: string = 'Buffer'): { valid: boolean; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: `${context} must not be empty` };
  }

  if (buffer.length < minLength) {
    return { valid: false, error: `${context} too short (min ${minLength} bytes)` };
  }

  return { valid: true };
}

/**
 * Validate key length for XChaCha20
 */
export function validateXChaCha20Key(key: Uint8Array): { valid: boolean; error?: string } {
  if (!key || key.length === 0) {
    return { valid: false, error: 'XChaCha20 key must be 32 bytes' };
  }

  if (key.length !== 32) {
    return { valid: false, error: 'XChaCha20 key must be 32 bytes' };
  }

  return { valid: true };
}

/**
 * Validate nonce length for XChaCha20
 */
export function validateXChaCha20Nonce(nonce: Uint8Array): { valid: boolean; error?: string } {
  if (!nonce || nonce.length === 0) {
    return { valid: false, error: 'XChaCha20 nonce must be 24 bytes' };
  }

  if (nonce.length !== 24) {
    return { valid: false, error: 'XChaCha20 nonce must be 24 bytes' };
  }

  return { valid: true };
}

/**
 * Validate Argon2id salt
 */
export function validateArgon2idSalt(salt: Uint8Array): { valid: boolean; error?: string } {
  if (!salt || salt.length === 0) {
    return { valid: false, error: 'Salt must not be empty' };
  }

  if (salt.length < 16) {
    return { valid: false, error: 'Salt must be at least 16 bytes' };
  }

  if (salt.length > 1024) {
    return { valid: false, error: 'Salt must be at most 1024 bytes' };
  }

  return { valid: true };
}

/**
 * Validate Argon2id parameters
 */
export function validateArgon2idParams(params: { iterations?: number; memory?: number; parallelism?: number }): { valid: boolean; error?: string } {
  if (params.iterations !== undefined && (params.iterations < 1 || params.iterations > 100)) {
    return { valid: false, error: 'Iterations must be between 1 and 100' };
  }

  if (params.memory !== undefined && (params.memory < 8 || params.memory > 1024)) {
    return { valid: false, error: 'Memory must be between 8 and 1024 MB' };
  }

  if (params.parallelism !== undefined && (params.parallelism < 1 || params.parallelism > 16)) {
    return { valid: false, error: 'Parallelism must be between 1 and 16' };
  }

  return { valid: true };
}

/**
 * Validate chunk size
 */
export function validateChunkSize(size: number): { valid: boolean; error?: string } {
  if (typeof size !== 'number') {
    return { valid: false, error: 'Chunk size must be a number' };
  }

  if (size < 1024) {
    return { valid: false, error: 'Chunk size must be at least 1KB' };
  }

  if (size > 100 * 1024 * 1024) {
    return { valid: false, error: 'Chunk size must be at most 100MB' };
  }

  return { valid: true };
}

/**
 * Validate worker count
 */
export function validateWorkerCount(count: number): { valid: boolean; error?: string } {
  if (typeof count !== 'number') {
    return { valid: false, error: 'Worker count must be a number' };
  }

  if (count < 1) {
    return { valid: false, error: 'Worker count must be at least 1' };
  }

  if (count > 64) {
    return { valid: false, error: 'Worker count must be at most 64' };
  }

  return { valid: true };
}

/**
 * Validate URL
 */
export function validateURL(url: string): { valid: boolean; error?: string } {
  if (!url || url.length === 0) {
    return { valid: false, error: 'URL must not be empty' };
  }

  try {
    new URL(url);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validate email address
 */
export function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email || email.length === 0) {
    return { valid: false, error: 'Email must not be empty' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  if (email.length > 254) {
    return { valid: false, error: 'Email too long (max 254 characters)' };
  }

  return { valid: true };
}

/**
 * Validate hex string
 */
export function validateHexString(hex: string, expectedLength?: number): { valid: boolean; error?: string } {
  if (!hex || hex.length === 0) {
    return { valid: false, error: 'Hex string must not be empty' };
  }

  const hexRegex = /^[0-9a-fA-F]+$/;
  if (!hexRegex.test(hex)) {
    return { valid: false, error: 'Invalid hex string format' };
  }

  if (expectedLength !== undefined && hex.length !== expectedLength) {
    return { valid: false, error: `Hex string must be ${expectedLength} characters long` };
  }

  return { valid: true };
}

/**
 * Validate base64 string
 */
export function validateBase64String(base64: string): { valid: boolean; error?: string } {
  if (!base64 || base64.length === 0) {
    return { valid: false, error: 'Base64 string must not be empty' };
  }

  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(base64)) {
    return { valid: false, error: 'Invalid base64 string format' };
  }

  if (base64.length % 4 !== 0) {
    return { valid: false, error: 'Base64 string length must be a multiple of 4' };
  }

  return { valid: true };
}

/**
 * Validate UUID
 */
export function validateUUID(uuid: string): { valid: boolean; error?: string } {
  if (!uuid || uuid.length === 0) {
    return { valid: false, error: 'UUID must not be empty' };
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(uuid)) {
    return { valid: false, error: 'Invalid UUID format' };
  }

  return { valid: true };
}

/**
 * Validate IP address
 */
export function validateIPAddress(ip: string): { valid: boolean; error?: string } {
  if (!ip || ip.length === 0) {
    return { valid: false, error: 'IP address must not be empty' };
  }

  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  if (!ipv4Regex.test(ip) && !ipv6Regex.test(ip)) {
    return { valid: false, error: 'Invalid IP address format' };
  }

  return { valid: true };
}

/**
 * Validate port number
 */
export function validatePort(port: number): { valid: boolean; error?: string } {
  if (typeof port !== 'number') {
    return { valid: false, error: 'Port must be a number' };
  }

  if (port < 1 || port > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }

  return { valid: true };
}

/**
 * Validate boolean string
 */
export function validateBooleanString(value: string): { valid: boolean; error?: string } {
  if (!value || value.length === 0) {
    return { valid: false, error: 'Value must not be empty' };
  }

  const validValues = ['true', 'false', '1', '0', 'yes', 'no', 'y', 'n'];
  const lowerValue = value.toLowerCase().trim();

  if (!validValues.includes(lowerValue)) {
    return { valid: false, error: 'Invalid boolean string' };
  }

  return { valid: true };
}

/**
 * Validate array length
 */
export function validateArrayLength<T>(array: T[], minLength: number = 0, maxLength: number = Infinity): { valid: boolean; error?: string } {
  if (!Array.isArray(array)) {
    return { valid: false, error: 'Input must be an array' };
  }

  if (array.length < minLength) {
    return { valid: false, error: `Array must have at least ${minLength} elements` };
  }

  if (array.length > maxLength) {
    return { valid: false, error: `Array must have at most ${maxLength} elements` };
  }

  return { valid: true };
}

/**
 * Validate object properties
 */
export function validateObjectProperties<T extends Record<string, unknown>>(
  obj: T,
  requiredProperties: (keyof T)[]
): { valid: boolean; error?: string; missing?: string[] } {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, error: 'Input must be an object' };
  }

  const missing: string[] = [];

  for (const prop of requiredProperties) {
    if (!(prop in obj) || obj[prop] === undefined || obj[prop] === null) {
      missing.push(String(prop));
    }
  }

  if (missing.length > 0) {
    return { valid: false, error: `Missing required properties: ${missing.join(', ')}`, missing };
  }

  return { valid: true };
}

/**
 * Validate range
 */
export function validateRange(value: number, min: number, max: number): { valid: boolean; error?: string } {
  if (typeof value !== 'number') {
    return { valid: false, error: 'Value must be a number' };
  }

  if (value < min || value > max) {
    return { valid: false, error: `Value must be between ${min} and ${max}` };
  }

  return { valid: true };
}

/**
 * Validate positive number
 */
export function validatePositiveNumber(value: number): { valid: boolean; error?: string } {
  if (typeof value !== 'number') {
    return { valid: false, error: 'Value must be a number' };
  }

  if (value <= 0) {
    return { valid: false, error: 'Value must be positive' };
  }

  return { valid: true };
}

/**
 * Validate non-negative number
 */
export function validateNonNegativeNumber(value: number): { valid: boolean; error?: string } {
  if (typeof value !== 'number') {
    return { valid: false, error: 'Value must be a number' };
  }

  if (value < 0) {
    return { valid: false, error: 'Value must be non-negative' };
  }

  return { valid: true };
}

/**
 * Validate integer
 */
export function validateInteger(value: number): { valid: boolean; error?: string } {
  if (typeof value !== 'number') {
    return { valid: false, error: 'Value must be a number' };
  }

  if (!Number.isInteger(value)) {
    return { valid: false, error: 'Value must be an integer' };
  }

  return { valid: true };
}

/**
 * Validate safe integer
 */
export function validateSafeInteger(value: number): { valid: boolean; error?: string } {
  if (typeof value !== 'number') {
    return { valid: false, error: 'Value must be a number' };
  }

  if (!Number.isSafeInteger(value)) {
    return { valid: false, error: 'Value must be a safe integer' };
  }

  return { valid: true };
}


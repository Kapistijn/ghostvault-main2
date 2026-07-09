/**
 * MODULE: Input Sanitization Utilities
 *
 * Responsibilities:
 *  - Sanitize user inputs to prevent injection attacks
 *  - Normalize data formats
 *  - Remove potentially dangerous characters
 *
 * Used by:
 *  - All modules that handle user input
 *
 * Depends on:
 *  - None
 *
 * @module core/utils/sanitization
 */

/**
 * Sanitize string input by removing control characters and normalizing
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }

  // Remove control characters except tab, newline, carriage return
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Sanitize file name to prevent path traversal
 */
export function sanitizeFileName(fileName: string): string {
  if (typeof fileName !== 'string') {
    throw new TypeError('File name must be a string');
  }

  // Remove path separators and dangerous characters
  return fileName
    .replace(/[\/\\]/g, '_') // Replace path separators
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/[<>:"|?*]/g, '_') // Replace invalid filename characters
    .replace(/^\.+/, '') // Remove leading dots
    .trim();
}

/**
 * Sanitize password by removing whitespace at ends
 */
export function sanitizePassword(password: string): string {
  if (typeof password !== 'string') {
    throw new TypeError('Password must be a string');
  }

  // Only trim whitespace, preserve other characters
  return password.trim();
}

/**
 * Normalize line endings to LF
 */
export function normalizeLineEndings(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }

  return input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Sanitize number input to ensure it's within safe range
 */
export function sanitizeNumber(input: unknown, min: number = Number.MIN_SAFE_INTEGER, max: number = Number.MAX_SAFE_INTEGER): number {
  const num = Number(input);
  
  if (isNaN(num)) {
    throw new TypeError('Input must be a valid number');
  }
  
  if (!isFinite(num)) {
    throw new RangeError('Input must be a finite number');
  }
  
  if (num < min || num > max) {
    throw new RangeError(`Input must be between ${min} and ${max}`);
  }
  
  return num;
}

/**
 * Sanitize boolean input
 */
export function sanitizeBoolean(input: unknown): boolean {
  if (typeof input === 'boolean') {
    return input;
  }
  
  if (typeof input === 'string') {
    const lower = input.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return false;
    }
  }
  
  if (typeof input === 'number') {
    return input !== 0;
  }
  
  throw new TypeError('Input must be a boolean or boolean-like value');
}

/**
 * Sanitize array input by removing null/undefined values
 */
export function sanitizeArray<T>(input: unknown): T[] {
  if (!Array.isArray(input)) {
    throw new TypeError('Input must be an array');
  }
  
  return input.filter((item): item is T => item !== null && item !== undefined);
}

/**
 * Sanitize object input by removing null/undefined values
 */
export function sanitizeObject<T extends Record<string, unknown>>(input: unknown): T {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('Input must be an object');
  }
  
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  
  return result as T;
}

/**
 * Sanitize Uint8Array by ensuring it's not null and has valid length
 */
export function sanitizeUint8Array(input: unknown, minLength: number = 0): Uint8Array {
  if (!(input instanceof Uint8Array)) {
    throw new TypeError('Input must be a Uint8Array');
  }
  
  if (input.length < minLength) {
    throw new RangeError(`Uint8Array must have at least ${minLength} bytes`);
  }
  
  return input;
}

/**
 * Escape HTML special characters to prevent XSS
 */
export function escapeHTML(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }
  
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };
  
  return input.replace(/[&<>"'/]/g, (char) => htmlEscapes[char]);
}

/**
 * Escape regular expression special characters
 */
export function escapeRegExp(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }
  
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Truncate string to maximum length
 */
export function truncateString(input: string, maxLength: number, suffix: string = '...'): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }
  
  if (input.length <= maxLength) {
    return input;
  }
  
  return input.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Validate and sanitize JSON input
 */
export function sanitizeJSON<T>(input: string): T {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }
  
  try {
    const parsed = JSON.parse(input);
    return parsed as T;
  } catch (error) {
    throw new Error('Invalid JSON input');
  }
}

/**
 * Remove byte order mark (BOM) from string
 */
export function removeBOM(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }
  
  // Remove UTF-8 BOM
  if (input.charCodeAt(0) === 0xFEFF) {
    return input.slice(1);
  }
  
  return input;
}

/**
 * Normalize Unicode string to NFC form
 */
export function normalizeUnicode(input: string): string {
  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string');
  }
  
  return input.normalize('NFC');
}

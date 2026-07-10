/**
 * Security utilities for input sanitization and validation
 */

import { MIN_PASSWORD_LENGTH } from './format/ghost.js';

// Common weak passwords that should be forbidden (Set for O(1) lookups)
const COMMON_PASSWORDS = new Set<string>([
  'password', '123456', '12345678', 'qwerty', 'abc123', 'monkey', 'master',
  'dragon', '111111', 'baseball', 'iloveyou', 'trustno1', 'sunshine',
  'princess', 'admin', 'welcome', 'shadow', 'ashley', 'football',
  'jesus', 'michael', 'ninja', 'mustang', 'password1', '123456789'
]);

/**
 * Recommended password length. Strong passwords are longer than the hard
 * minimum; we still enforce the shared MIN_PASSWORD_LENGTH as the floor.
 */
const RECOMMENDED_PASSWORD_LENGTH = 12;

/**
 * Sanitize string input to prevent XSS attacks
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';

  // Remove null bytes and control characters
  let sanitized = input.replace(/[\0-\x1F\x7F]/g, '');

  // Remove potentially dangerous characters
  sanitized = sanitized.replace(/[<>]/g, '');

  return sanitized.trim();
}

/**
 * Sanitize filename to prevent path traversal
 */
export function sanitizeFilename(filename: string): string {
  if (typeof filename !== 'string') return 'unnamed';

  // Check for empty string
  if (!filename || filename.trim().length === 0) {
    return 'unnamed';
  }

  // Remove path traversal attempts
  let sanitized = filename.replace(/[\/\\]/g, '');

  // Remove null bytes and control characters
  sanitized = sanitized.replace(/[\0-\x1F\x7F]/g, '');

  // Remove potentially dangerous characters
  sanitized = sanitized.replace(/[<>:"|?*]/g, '');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^\.+/, '').replace(/\.$/, '').trim();

  return sanitized || 'unnamed';
}

/**
 * Constant-time comparison of two strings to avoid timing side-channels.
 * Compares over the max length so the running time does not reveal the
 * position of the first differing byte or the secret length.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  strength: number;
  errors: string[];
} {
  const errors: string[] = [];
  let strength = 0;

  // Validate input type first (before any .length access)
  if (typeof password !== 'string') {
    return { valid: false, strength: 0, errors: ['Wachtwoord moet een string zijn'] };
  }

  if (password.length === 0) {
    return { valid: false, strength: 0, errors: ['Wachtwoord mag niet leeg zijn'] };
  }

  // Length check aligned with the shared minimum policy
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} karakters zijn`);
  } else if (password.length < RECOMMENDED_PASSWORD_LENGTH) {
    errors.push(`Wachtwoord van ${RECOMMENDED_PASSWORD_LENGTH}+ karakters aanbevolen`);
    strength += 1;
  } else {
    strength += 2;
  }

  // Character variety
  if (/[a-z]/.test(password)) strength += 1;
  else errors.push('Wachtwoord moet kleine letters bevatten');

  if (/[A-Z]/.test(password)) strength += 1;
  else errors.push('Wachtwoord moet hoofdletters bevatten');

  if (/[0-9]/.test(password)) strength += 1;
  else errors.push('Wachtwoord moet nummers bevatten');

  if (/[^a-zA-Z0-9]/.test(password)) strength += 1;
  else errors.push('Wachtwoord moet speciale tekens bevatten');

  // Check against common passwords
  const lowerPassword = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowerPassword)) {
    errors.push('Wachtwoord is te vaak gebruikt');
    strength = 0;
  }

  // Check for sequential patterns
  if (/(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz)/i.test(password)) {
    errors.push('Wachtwoord bevat sequentieel patroon');
    strength = Math.max(0, strength - 1);
  }

  // Check for repeated characters
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Wachtwoord bevat herhalende karakters');
    strength = Math.max(0, strength - 1);
  }

  // Valid when there are no hard errors. A single 'aanbevolen' notice is
  // advisory and does not block a password that meets the minimum.
  const onlyAdvisory = errors.length === 1 && errors[0].includes('aanbevolen');

  return {
    valid: errors.length === 0 || onlyAdvisory,
    strength: Math.min(5, strength),
    errors
  };
}

/**
 * Check if password contains personal information
 */
export function containsPersonalInfo(password: string, personalInfo?: {
  name?: string;
  email?: string;
  username?: string;
  birthdate?: string;
}): boolean {
  if (!personalInfo) return false;

  const lowerPassword = password.toLowerCase();

  if (personalInfo.name && lowerPassword.includes(personalInfo.name.toLowerCase())) return true;
  if (personalInfo.email && lowerPassword.includes(personalInfo.email.toLowerCase().split('@')[0])) return true;
  if (personalInfo.username && lowerPassword.includes(personalInfo.username.toLowerCase())) return true;
  if (personalInfo.birthdate) {
    // Strip every common date separator so 12/05/1990, 12-05-1990 and
    // 12.05.1990 are all detected (previously '/' was listed twice and
    // dotted dates were never handled).
    const stripped = personalInfo.birthdate.replace(/[\/\-.]/g, '');
    if (stripped.length > 0 && lowerPassword.includes(stripped)) return true;
  }

  return false;
}

/**
 * Generate a secure random token
 */
export function generateSecureToken(length: number = 32): string {
  const safeLength = Number.isInteger(length) && length > 0 ? length : 32;
  const array = new Uint8Array(safeLength);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a value using SHA-256
 */
export async function hashValue(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Rate limiter for API calls
 */
export class RateLimiter {
  private requests: number[] = [];
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests: number = 10, windowMs: number = 60000) {
    // Guard against invalid / non-positive configuration.
    this.maxRequests = Number.isFinite(maxRequests) && maxRequests > 0 ? Math.floor(maxRequests) : 10;
    this.windowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60000;
  }

  canMakeRequest(): boolean {
    const now = Date.now();
    // Remove requests outside the time window
    this.requests = this.requests.filter(time => now - time < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      return false;
    }

    this.requests.push(now);
    return true;
  }

  getRemainingRequests(): number {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    return Math.max(0, this.maxRequests - this.requests.length);
  }

  getResetTime(): number {
    if (this.requests.length === 0) return 0;
    const oldestRequest = Math.min(...this.requests);
    return oldestRequest + this.windowMs;
  }
}

/**
 * CSRF token generator and validator
 */
export class CSRFProtection {
  private static token: string | null = null;

  static generateToken(): string {
    this.token = generateSecureToken(32);
    return this.token;
  }

  static getToken(): string | null {
    return this.token;
  }

  static validateToken(token: string): boolean {
    if (this.token === null || typeof token !== 'string') return false;
    // Constant-time comparison to avoid leaking the token via timing.
    return constantTimeEquals(this.token, token);
  }

  static clearToken(): void {
    this.token = null;
  }
}

/**
 * Security event logger
 */
export class SecurityLogger {
  private static events: Array<{
    timestamp: number;
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> = [];

  static logEvent(type: string, message: string, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'): void {
    this.events.push({
      timestamp: Date.now(),
      type,
      message,
      severity
    });

    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }

  static getEvents(): typeof SecurityLogger.events {
    return [...this.events];
  }

  static getEventsByType(type: string): typeof SecurityLogger.events {
    return this.events.filter(e => e.type === type);
  }

  static getRecentEvents(minutes: number = 60): typeof SecurityLogger.events {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.events.filter(e => e.timestamp > cutoff);
  }

  static clearEvents(): void {
    this.events = [];
  }
}

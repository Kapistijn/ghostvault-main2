/**
 * MODULE: Retry Mechanism
 *
 * Responsibilities:
 *  - Retry logic for transient failures
 *  - Exponential backoff
 *  - Jitter for avoiding thundering herd
 *
 * Used by:
 *  - All modules that perform network/disk operations
 *
 * Depends on:
 *  - core/utils/errors.ts
 *  - core/utils/logger.ts
 *
 * @module core/utils/retry
 */

import { GhostVaultError, isRetryableError } from './errors.js';
import { getLogger } from './logger.js';

const logger = getLogger('retry');

// Retry configuration constants
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_JITTER_FACTOR = 0.1;

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitterFactor?: number;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number
): number {
  // Exponential backoff
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt);
  
  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Add jitter to avoid thundering herd
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
  
  return Math.max(0, cappedDelay + jitter);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    jitterFactor = DEFAULT_JITTER_FACTOR,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt === maxRetries || !shouldRetry(error)) {
        logger.error('Operation failed after retries', error as Error, {
          attempt,
          maxRetries,
          retryable: shouldRetry(error),
        });
        throw error;
      }
      
      // Calculate delay
      const delay = calculateDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        jitterFactor
      );
      
      logger.warn('Retrying operation after delay', {
        attempt,
        maxRetries,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt, error);
      }
      
      // Sleep before retry
      await sleep(delay);
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Retry a synchronous function with exponential backoff
 */
export function retrySync<T>(
  fn: () => T,
  options: RetryOptions = {}
): T {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    jitterFactor = DEFAULT_JITTER_FACTOR,
    shouldRetry = isRetryableError,
    onRetry,
  } = options;

  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (attempt === maxRetries || !shouldRetry(error)) {
        logger.error('Operation failed after retries', error as Error, {
          attempt,
          maxRetries,
          retryable: shouldRetry(error),
        });
        throw error;
      }
      
      // Calculate delay
      const delay = calculateDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        jitterFactor
      );
      
      logger.warn('Retrying operation after delay', {
        attempt,
        maxRetries,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Call retry callback if provided
      if (onRetry) {
        onRetry(attempt, error);
      }
      
      // Synchronous sleep is not possible in browser, throw error
      throw new Error('Synchronous retry not supported in browser environment');
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable version of a function
 */
export function withRetry<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: RetryOptions = {}
): T {
  return (async (...args: Parameters<T>): Promise<unknown> => {
    return retry(() => fn(...args), options);
  }) as T;
}

/**
 * Retry with circuit breaker pattern
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly timeoutMs: number = 60000,
    private readonly resetTimeoutMs: number = 30000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half-open';
        logger.info('Circuit breaker transitioning to half-open');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }
    
    try {
      const result = await fn();
      
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
        logger.info('Circuit breaker closed after successful execution');
      }
      
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      if (this.failureCount >= this.threshold) {
        this.state = 'open';
        logger.error('Circuit breaker opened due to threshold exceeded', undefined, {
          failureCount: this.failureCount,
          threshold: this.threshold,
        });
      }
      
      throw error;
    }
  }
  
  getState(): string {
    return this.state;
  }
  
  getFailureCount(): number {
    return this.failureCount;
  }
  
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'closed';
    logger.info('Circuit breaker manually reset');
  }
}

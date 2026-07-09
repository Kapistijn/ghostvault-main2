/**
 * MODULE: Rate Limiting Utilities
 *
 * Responsibilities:
 *  - Rate limit expensive operations
 *  - Prevent resource exhaustion
 *  - Implement various rate limiting strategies
 *
 * Used by:
 *  - All modules that perform expensive operations
 *
 * Depends on:
 *  - core/utils/logger.ts
 *
 * @module core/utils/rate-limit
 */

import { getLogger } from './logger.js';

const logger = getLogger('rate-limit');

/**
 * Token bucket rate limiter
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRate: number, // tokens per second
    private readonly refillInterval: number = 1000 // ms
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Try to consume a token
   */
  tryConsume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  /**
   * Consume a token, waiting if necessary
   */
  async consume(tokens: number = 1): Promise<void> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return;
    }

    // Calculate wait time
    const waitTime = ((tokens - this.tokens) / this.refillRate) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    this.refill();
    this.tokens -= tokens;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= this.refillInterval) {
      const tokensToAdd = (elapsed / this.refillInterval) * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Reset the bucket
   */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

/**
 * Sliding window rate limiter
 */
export class SlidingWindow {
  private timestamps: number[] = [];

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  /**
   * Try to make a request
   */
  tryRequest(): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove old timestamps
    this.timestamps = this.timestamps.filter(t => t > windowStart);

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return true;
    }

    return false;
  }

  /**
   * Make a request, waiting if necessary
   */
  async request(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove old timestamps
    this.timestamps = this.timestamps.filter(t => t > windowStart);

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return;
    }

    // Calculate wait time until oldest request expires
    const oldestTimestamp = this.timestamps[0];
    const waitTime = oldestTimestamp + this.windowMs - now;

    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.timestamps.push(Date.now());
  }

  /**
   * Get current request count
   */
  getRequestCount(): number {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    return this.timestamps.filter(t => t > windowStart).length;
  }

  /**
   * Reset the window
   */
  reset(): void {
    this.timestamps = [];
  }
}

/**
 * Fixed window rate limiter
 */
export class FixedWindow {
  private requestCount = 0;
  private windowStart: number;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {
    this.windowStart = Date.now();
  }

  /**
   * Try to make a request
   */
  tryRequest(): boolean {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    // Reset window if elapsed
    if (elapsed >= this.windowMs) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    if (this.requestCount < this.maxRequests) {
      this.requestCount++;
      return true;
    }

    return false;
  }

  /**
   * Make a request, waiting if necessary
   */
  async request(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    // Reset window if elapsed
    if (elapsed >= this.windowMs) {
      this.requestCount = 0;
      this.windowStart = now;
    }

    if (this.requestCount < this.maxRequests) {
      this.requestCount++;
      return;
    }

    // Wait for next window
    const waitTime = this.windowMs - elapsed;
    await new Promise(resolve => setTimeout(resolve, waitTime));

    this.requestCount = 1;
    this.windowStart = Date.now();
  }

  /**
   * Get current request count
   */
  getRequestCount(): number {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    if (elapsed >= this.windowMs) {
      return 0;
    }

    return this.requestCount;
  }

  /**
   * Reset the window
   */
  reset(): void {
    this.requestCount = 0;
    this.windowStart = Date.now();
  }
}

/**
 * Adaptive rate limiter that adjusts based on success/failure
 */
export class AdaptiveRateLimiter {
  private currentRate: number;
  private minRate: number;
  private maxRate: number;
  private consecutiveSuccesses = 0;
  private consecutiveFailures = 0;

  constructor(
    initialRate: number = 10,
    minRate: number = 1,
    maxRate: number = 100,
    private readonly successThreshold: number = 5,
    private readonly failureThreshold: number = 3,
    private readonly adjustmentFactor: number = 2
  ) {
    this.currentRate = initialRate;
    this.minRate = minRate;
    this.maxRate = maxRate;
  }

  /**
   * Record a success
   */
  recordSuccess(): void {
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;

    if (this.consecutiveSuccesses >= this.successThreshold) {
      this.increaseRate();
      this.consecutiveSuccesses = 0;
    }
  }

  /**
   * Record a failure
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.decreaseRate();
      this.consecutiveFailures = 0;
    }
  }

  /**
   * Increase the rate
   */
  private increaseRate(): void {
    this.currentRate = Math.min(this.maxRate, this.currentRate * this.adjustmentFactor);
    logger.info('Rate increased', { currentRate: this.currentRate });
  }

  /**
   * Decrease the rate
   */
  private decreaseRate(): void {
    this.currentRate = Math.max(this.minRate, this.currentRate / this.adjustmentFactor);
    logger.warn('Rate decreased', { currentRate: this.currentRate });
  }

  /**
   * Get current rate
   */
  getCurrentRate(): number {
    return this.currentRate;
  }

  /**
   * Get delay between requests
   */
  getDelay(): number {
    return 1000 / this.currentRate;
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.currentRate = 10;
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures = 0;
  }
}

/**
 * Rate limiter factory
 */
export class RateLimiterFactory {
  static tokenBucket(capacity: number, refillRate: number): TokenBucket {
    return new TokenBucket(capacity, refillRate);
  }

  static slidingWindow(maxRequests: number, windowMs: number): SlidingWindow {
    return new SlidingWindow(maxRequests, windowMs);
  }

  static fixedWindow(maxRequests: number, windowMs: number): FixedWindow {
    return new FixedWindow(maxRequests, windowMs);
  }

  static adaptive(initialRate: number, minRate: number, maxRate: number): AdaptiveRateLimiter {
    return new AdaptiveRateLimiter(initialRate, minRate, maxRate);
  }
}

/**
 * Decorator to rate limit a function
 */
export function rateLimit<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  limiter: TokenBucket | SlidingWindow | FixedWindow
): T {
  return (async (...args: Parameters<T>): Promise<unknown> => {
    if (limiter instanceof TokenBucket) {
      await limiter.consume();
    } else if (limiter instanceof SlidingWindow) {
      await limiter.request();
    } else if (limiter instanceof FixedWindow) {
      await limiter.request();
    }

    return fn(...args);
  }) as T;
}

/**
 * Global rate limiters for common operations
 */
const globalLimiters = {
  encryption: new TokenBucket(100, 10), // 100 tokens, refill 10 per second
  decryption: new TokenBucket(100, 10),
  compression: new TokenBucket(50, 5),
  decompression: new TokenBucket(50, 5),
  fileIO: new SlidingWindow(10, 1000), // 10 requests per second
};

/**
 * Get a global rate limiter
 */
export function getGlobalLimiter(name: keyof typeof globalLimiters): TokenBucket | SlidingWindow {
  return globalLimiters[name];
}

/**
 * Rate limit an operation using global limiter
 */
export async function withGlobalRateLimit<T>(
  name: keyof typeof globalLimiters,
  fn: () => Promise<T>
): Promise<T> {
  const limiter = globalLimiters[name];

  if (limiter instanceof TokenBucket) {
    await limiter.consume();
  } else if (limiter instanceof SlidingWindow) {
    await limiter.request();
  }

  return fn();
}

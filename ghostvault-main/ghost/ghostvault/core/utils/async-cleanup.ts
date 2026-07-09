/**
 * MODULE: Async Cleanup Utilities
 *
 * Responsibilities:
 *  - Ensure proper cleanup of async resources
 *  - Handle cleanup on errors
 *  - Manage resource lifecycles
 *
 * Used by:
 *  - All modules that manage async resources
 *
 * Depends on:
 *  - core/utils/logger.ts
 *  - core/utils/errors.ts
 *
 * @module core/utils/async-cleanup
 */

import { getLogger } from './logger.js';
import { GhostVaultError } from './errors.js';

const logger = getLogger('async-cleanup');

/**
 * Resource cleanup handler
 */
export interface CleanupHandler {
  (): Promise<void> | void;
}

/**
 * Resource manager for automatic cleanup
 */
export class ResourceManager {
  private cleanupHandlers: CleanupHandler[] = [];
  private disposed = false;

  /**
   * Register a cleanup handler
   */
  register(handler: CleanupHandler): void {
    if (this.disposed) {
      throw new Error('ResourceManager is already disposed');
    }
    this.cleanupHandlers.push(handler);
  }

  /**
   * Register multiple cleanup handlers
   */
  registerAll(handlers: CleanupHandler[]): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  /**
   * Execute all cleanup handlers
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      logger.warn('ResourceManager already disposed');
      return;
    }

    this.disposed = true;
    const errors: Error[] = [];

    // Execute cleanup handlers in reverse order (LIFO)
    for (const handler of [...this.cleanupHandlers].reverse()) {
      try {
        await handler();
      } catch (error) {
        errors.push(error as Error);
        logger.error('Cleanup handler failed', error as Error);
      }
    }

    this.cleanupHandlers = [];

    if (errors.length > 0) {
      throw new GhostVaultError(
        `Cleanup failed with ${errors.length} error(s)`,
        'CLEANUP_ERROR',
        { errors: errors.map(e => e.message) }
      );
    }
  }

  /**
   * Check if manager is disposed
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Get number of registered handlers
   */
  getHandlerCount(): number {
    return this.cleanupHandlers.length;
  }
}

/**
 * Execute function with automatic cleanup
 */
export async function withCleanup<T>(
  fn: (manager: ResourceManager) => Promise<T>
): Promise<T> {
  const manager = new ResourceManager();

  try {
    return await fn(manager);
  } finally {
    await manager.dispose();
  }
}

/**
 * Execute function with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new GhostVaultError(timeoutMessage, 'TIMEOUT_ERROR', { timeoutMs }));
    }, timeoutMs);
  });

  return Promise.race([fn(), timeoutPromise]);
}

/**
 * Execute function with retry and cleanup
 */
export async function withRetryAndCleanup<T>(
  fn: (manager: ResourceManager) => Promise<T>,
  maxRetries: number = 3,
  retryDelayMs: number = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const manager = new ResourceManager();

    try {
      const result = await fn(manager);
      await manager.dispose();
      return result;
    } catch (error) {
      lastError = error;
      await manager.dispose();

      if (attempt === maxRetries) {
        throw error;
      }

      logger.warn('Retrying operation after cleanup', {
        attempt,
        maxRetries,
        retryDelayMs,
        error: error instanceof Error ? error.message : String(error),
      });

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
}

/**
 * Execute multiple async operations in parallel with cleanup
 */
export async function parallelWithCleanup<T>(
  operations: Array<(manager: ResourceManager) => Promise<T>>,
  maxConcurrency: number = 5
): Promise<T[]> {
  const results: T[] = [];
  const manager = new ResourceManager();

  try {
    // Process in batches
    for (let i = 0; i < operations.length; i += maxConcurrency) {
      const batch = operations.slice(i, i + maxConcurrency);
      const batchResults = await Promise.all(
        batch.map(op => op(manager))
      );
      results.push(...batchResults);
    }

    return results;
  } finally {
    await manager.dispose();
  }
}

/**
 * Execute function with abort signal support
 */
export async function withAbortSignal<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
   throw new GhostVaultError('Operation was aborted', 'CANCELLATION_ERROR');
  }

  return fn(signal || new AbortController().signal);
}

/**
 * Create a cancellable promise
 */
export function createCancellablePromise<T>(
  executor: (signal: AbortSignal) => Promise<T>
): { promise: Promise<T>; cancel: () => void } {
  const controller = new AbortController();

  const promise = executor(controller.signal).catch((error) => {
    if (controller.signal.aborted) {
      throw new GhostVaultError('Operation was cancelled', 'CANCELLATION_ERROR');
    }
    throw error;
  });

  return {
    promise,
    cancel: () => controller.abort(),
  };
}

/**
 * Execute function with resource tracking
 */
export async function withResourceTracking<T>(
  fn: () => Promise<T>,
  resourceName: string = 'resource'
): Promise<T> {
  const startTime = Date.now();
  logger.debug(`Acquiring ${resourceName}`);

  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    logger.debug(`Released ${resourceName}`, { durationMs: duration });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Failed to release ${resourceName}`, error as Error, { durationMs: duration });
    throw error;
  }
}

/**
 * Cleanup utility for streams
 */
export async function cleanupStream(
  stream: ReadableStream | WritableStream | null | undefined
): Promise<void> {
  if (!stream) {
    return;
  }

  try {
    if ('cancel' in stream && typeof stream.cancel === 'function') {
      await stream.cancel();
    }
    if ('close' in stream && typeof stream.close === 'function') {
      await stream.close();
    }
  } catch (error) {
    logger.error('Failed to cleanup stream', error as Error);
  }
}

/**
 * Cleanup utility for file handles
 */
export async function cleanupFileHandle(
  handle: FileSystemFileHandle | null | undefined
): Promise<void> {
  if (!handle) {
    return;
  }

  try {
    // File handles in browser don't have explicit close methods
    // They are automatically garbage collected
    logger.debug('File handle cleanup completed');
  } catch (error) {
    logger.error('Failed to cleanup file handle', error as Error);
  }
}

/**
 * Cleanup utility for workers
 */
export async function cleanupWorker(worker: Worker | null | undefined): Promise<void> {
  if (!worker) {
    return;
  }

  try {
    worker.terminate();
    logger.debug('Worker terminated');
  } catch (error) {
    logger.error('Failed to terminate worker', error as Error);
  }
}

/**
 * Cleanup utility for timers
 */
export function cleanupTimers(timers: number[]): void {
  for (const timer of timers) {
    try {
      if (typeof clearTimeout === 'function') {
        clearTimeout(timer);
      }
      if (typeof clearInterval === 'function') {
        clearInterval(timer);
      }
    } catch (error) {
      logger.error('Failed to cleanup timer', error as Error);
    }
  }
}

/**
 * Cleanup utility for event listeners
 */
export function cleanupEventListeners(
  target: EventTarget,
  eventTypes: string[],
  listener: EventListener
): void {
  for (const eventType of eventTypes) {
    try {
      target.removeEventListener(eventType, listener);
    } catch (error) {
      logger.error('Failed to remove event listener', error as Error, { eventType });
    }
  }
}

/**
 * MODULE: Memory Management Utilities
 *
 * Responsibilities:
 *  - Memory pooling for Uint8Array allocations
 *  - Memory usage monitoring
 *  - Garbage collection hints
 *  - Buffer size optimization
 *
 * Used by:
 *  - core/crypto/encryption/xchacha20.ts
 *  - core/crypto/compression/zstd.ts
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * @module core/utils/memory
 */

// crypto is available globally in browser secure contexts
declare const crypto: Crypto;

import { getLogger } from './logger.js';

const logger = getLogger('memory');

// Memory pool configuration
const POOL_MAX_SIZE = 100; // Max buffers per pool
const POOL_SIZES = [1024, 4096, 16384, 65536, 262144, 1048576]; // 1KB to 1MB

// Memory pools for different buffer sizes
const memoryPools = new Map<number, Uint8Array[]>();

// Statistics tracking
const poolStats = {
  hits: 0,
  misses: 0,
  returns: 0,
  allocations: 0,
};

// Initialize memory pools
POOL_SIZES.forEach(size => {
  memoryPools.set(size, []);
});

/**
 * Securely wipe a buffer before returning to pool
 */
function secureWipeBuffer(buffer: Uint8Array): void {
  if (!buffer || buffer.length === 0) return;
  
  // Multiple passes with different patterns
  for (let pass = 0; pass < 3; pass++) {
    if (pass === 0) {
      // Random data
      crypto.getRandomValues(buffer);
    } else if (pass === 1) {
      // Alternating pattern
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] = (i % 2 === 0) ? 0xAA : 0x55;
      }
    } else {
      // Zeros
      buffer.fill(0);
    }
  }
}

/**
 * Get a buffer from the memory pool or create a new one with validation
 */
export function getBuffer(size: number): Uint8Array {
  // Validate size
  if (typeof size !== 'number' || size < 0) {
    throw new Error('Buffer size must be a non-negative number');
  }
  
  if (size > 100 * 1024 * 1024) { // 100MB
    logger.warn('Requested buffer size exceeds 100MB, creating directly without pooling', { size });
    poolStats.misses++;
    poolStats.allocations++;
    return new Uint8Array(size);
  }
  
  // Find the smallest pool size that fits (already implemented correctly)
  const poolSize = POOL_SIZES.find(s => s >= size) || size;
  const pool = memoryPools.get(poolSize);

  if (pool && pool.length > 0) {
    const buffer = pool.pop()!;
    poolStats.hits++;
    logger.debug('Memory pool hit', { poolSize, remaining: pool.length });
    return buffer;
  }

  poolStats.misses++;
  poolStats.allocations++;
  logger.debug('Memory pool miss, creating new buffer', { poolSize });
  return new Uint8Array(poolSize);
}

/**
 * Return a buffer to the memory pool with secure wiping
 */
export function returnBuffer(buffer: Uint8Array, secure: boolean = true): void {
  if (!buffer || buffer.length === 0) {
    return;
  }

  // Find matching pool (already optimized with >= in getBuffer)
  const poolSize = POOL_SIZES.find(s => s === buffer.length);
  if (!poolSize) {
    // Buffer size not in pool, let it be garbage collected
    if (secure) {
      // Single pass is sufficient for non-sensitive data
      buffer.fill(0);
    }
    return;
  }

  const pool = memoryPools.get(poolSize);
  if (!pool) {
    return;
  }

  // Don't overfill the pool
  if (pool.length < POOL_MAX_SIZE) {
    // Single pass is sufficient for pooled buffers
    buffer.fill(0);
    pool.push(buffer);
    poolStats.returns++;
    logger.debug('Buffer returned to pool', { poolSize, poolCount: pool.length });
  } else {
    // Pool is full, wipe and let GC handle it
    buffer.fill(0);
    logger.debug('Pool full, buffer not returned', { poolSize });
  }
}

/**
 * Clear all memory pools with secure wiping
 */
export function clearMemoryPools(secure: boolean = true): void {
  memoryPools.forEach((pool, size) => {
    const count = pool.length;
    
    if (secure) {
      // Single pass wipe is sufficient for pool clearing
      pool.forEach(buffer => {
        buffer.fill(0);
      });
    }
    
    pool.length = 0;
    logger.info('Memory pool cleared', { size, count, secure });
  });
  
  // Reset stats
  poolStats.hits = 0;
  poolStats.misses = 0;
  poolStats.returns = 0;
  poolStats.allocations = 0;
}

/**
 * Get memory pool statistics
 */
export function getPoolStats(): Record<number, number> {
  const stats: Record<number, number> = {};
  memoryPools.forEach((pool, size) => {
    stats[size] = pool.length;
  });
  return stats;
}

/**
 * Get detailed memory statistics
 */
export function getDetailedStats(): {
  pools: Record<number, number>;
  hits: number;
  misses: number;
  returns: number;
  allocations: number;
  hitRate: number;
} {
  const pools: Record<number, number> = {};
  memoryPools.forEach((pool, size) => {
    pools[size] = pool.length;
  });
  
  const total = poolStats.hits + poolStats.misses;
  const hitRate = total > 0 ? (poolStats.hits / total) * 100 : 0;
  
  return {
    pools,
    hits: poolStats.hits,
    misses: poolStats.misses,
    returns: poolStats.returns,
    allocations: poolStats.allocations,
    hitRate,
  };
}

/**
 * Estimate total memory used by pools
 */
export function estimatePoolMemory(): number {
  let total = 0;
  memoryPools.forEach((pool, size) => {
    total += pool.length * size;
  });
  return total;
}

/**
 * Force garbage collection hint (if available)
 */
export function forceGC(): void {
  if (typeof (globalThis as any).gc === 'function') {
    (globalThis as any).gc();
    logger.debug('Forced garbage collection');
  } else {
    logger.debug('GC not available in this environment');
  }
}

/**
 * Estimate memory usage for operations
 */
export function estimateMemoryUsage(
  fileSize: number,
  chunkCount: number,
  operation: 'encrypt' | 'decrypt' | 'compress' | 'decompress'
): number {
  const chunkSize = Math.ceil(fileSize / chunkCount);
  
  // Base memory per chunk (input + output buffers)
  let perChunkMemory = chunkSize * 2;
  
  // Add overhead for different operations
  switch (operation) {
    case 'encrypt':
      perChunkMemory += 32 + 24 + 16; // key + nonce + tag
      break;
    case 'decrypt':
      perChunkMemory += 32 + 24; // key + nonce
      break;
    case 'compress':
      perChunkMemory += chunkSize * 0.1; // Compression overhead
      break;
    case 'decompress':
      perChunkMemory += chunkSize * 1.5; // Decompression overhead
      break;
  }
  
  // Parallel processing multiplier (assuming 4 parallel operations)
  const parallelMultiplier = 4;
  
  return Math.ceil(perChunkMemory * chunkCount * parallelMultiplier);
}

/**
 * Check if estimated memory usage is safe
 */
export function isMemoryUsageSafe(estimatedMemory: number): boolean {
  // Get available memory (if available in browser)
  if ('memory' in performance && (performance as any).memory) {
    const memory = (performance as any).memory;
    const available = memory.jsHeapSizeLimit - memory.usedJSHeapSize;
    return estimatedMemory < available * 0.8; // Use at most 80% of available
  }
  
  // Fallback: assume 2GB available
  return estimatedMemory < 2 * 1024 * 1024 * 1024;
}

/**
 * Suggest optimal chunk count based on file size and memory constraints
 */
export function suggestChunkCount(fileSize: number, operation: 'encrypt' | 'decrypt' | 'compress' | 'decompress'): number {
  const MAX_CHUNKS = 10000;
  const MIN_CHUNKS = 10;
  const TARGET_MEMORY = 512 * 1024 * 1024; // 512MB target memory usage
  
  // Binary search for optimal chunk count
  let low = MIN_CHUNKS;
  let high = MAX_CHUNKS;
  let optimal = MIN_CHUNKS;
  
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const estimated = estimateMemoryUsage(fileSize, mid, operation);
    
    if (estimated <= TARGET_MEMORY) {
      optimal = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  
  logger.info('Suggested chunk count', { fileSize, operation, optimal, estimatedMemory: estimateMemoryUsage(fileSize, optimal, operation) });
  
  return optimal;
}

/**
 * Trigger garbage collection hint (if available)
 */
export function triggerGC(): void {
  // Only works in Chrome with --js-flags flag
  if ((globalThis as any).gc) {
    (globalThis as any).gc();
    logger.debug('Garbage collection triggered');
  }
}

/**
 * Securely wipe sensitive data from memory
 */
export function secureWipe(data: Uint8Array): void {
  if (!data || data.length === 0) {
    return;
  }
  
  // Overwrite with random data multiple times for better security
  for (let i = 0; i < 5; i++) {
    crypto.getRandomValues(data);
  }
  
  // Then overwrite with zeros
  data.fill(0);
  
  // Additional pass with alternating pattern
  for (let i = 0; i < data.length; i++) {
    data[i] = (i % 2 === 0) ? 0xAA : 0x55;
  }
  
  // Final zero pass
  data.fill(0);
  
  logger.debug('Sensitive data securely wiped', { length: data.length });
}

/**
 * Memory usage monitor
 */
export class MemoryMonitor {
  private interval: number | null = null;
  private callback: ((usage: number) => void) | null = null;
  
  /**
   * Start monitoring memory usage
   */
  start(intervalMs: number = 1000, callback: (usage: number) => void): void {
    this.callback = callback;
    // Use setInterval from global scope for Node.js compatibility
    const setIntervalFn = typeof window !== 'undefined' ? window.setInterval : globalThis.setInterval;
    this.interval = setIntervalFn(() => {
      const usage = this.getCurrentMemoryUsage();
      if (this.callback) {
        this.callback(usage);
      }
    }, intervalMs);
    
    logger.info('Memory monitor started', { intervalMs });
  }
  
  /**
   * Stop monitoring memory usage
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Memory monitor stopped');
    }
  }
  
  /**
   * Get current memory usage in bytes
   */
  getCurrentMemoryUsage(): number {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      return memory.usedJSHeapSize;
    }
    return 0;
  }
  
  /**
   * Get memory limit in bytes
   */
  getMemoryLimit(): number {
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      return memory.jsHeapSizeLimit;
    }
    return 0;
  }
  
  /**
   * Get memory usage as percentage
   */
  getMemoryUsagePercentage(): number {
    const used = this.getCurrentMemoryUsage();
    const limit = this.getMemoryLimit();
    if (limit === 0) return 0;
    return (used / limit) * 100;
  }
}

/**
 * Optimize buffer size based on available memory
 */
export function optimizeBufferSize(desiredSize: number, maxMemory: number = 512 * 1024 * 1024): number {
  // Ensure buffer size is at least 1KB
  const minSize = 1024;
  
  // Ensure buffer size doesn't exceed 10% of max memory
  const maxSize = Math.max(minSize, Math.floor(maxMemory * 0.1));
  
  // Clamp to valid range
  const optimized = Math.max(minSize, Math.min(desiredSize, maxSize));
  
  // Round to nearest power of 2 for better alignment
  const powerOf2 = Math.pow(2, Math.floor(Math.log2(optimized)));
  
  logger.debug('Buffer size optimized', { desired: desiredSize, optimized: powerOf2, maxMemory });
  
  return powerOf2;
}

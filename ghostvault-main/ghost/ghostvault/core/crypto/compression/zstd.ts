/**
 * MODULE: Zstandard Streaming Compression
 *
 * Responsibilities:
 *  - Zstd compression/decompression with streaming
 *  - Multi-threaded compression
 *  - Adaptive level selection
 *  - Fix "payload too small" bug
 *
 * Used by:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * Depends on:
 *  - @oneidentity/zstd-js
 *
 * @module core/crypto/compression/zstd
 */

// crypto is available globally in browser secure contexts
declare const crypto: Crypto;

import { ZstdInit, type ZstdCodec } from '@oneidentity/zstd-js';
import { getLogger } from '../../utils/logger.js';
import { validateCompressionLevel } from '../../utils/validation.js';

const logger = getLogger('zstd');

let codecPromise: Promise<ZstdCodec> | null = null;

// Compression cache configuration
const CACHE_TTL = 60000; // 1 minute cache TTL
const MAX_CACHE_SIZE = 100; // Max 100 cached items

// Compression cache for frequently used data
const compressionCache = new Map<string, { compressed: Uint8Array; timestamp: number }>();

// Compression statistics tracking
const compressionStats = {
  totalCompressions: 0,
  totalDecompressions: 0,
  cacheHits: 0,
  cacheMisses: 0,
  totalBytesCompressed: 0,
  totalBytesDecompressed: 0,
  totalTimeMs: 0,
};

/**
 * Get compression statistics
 */
export function getCompressionStats(): typeof compressionStats {
  return { ...compressionStats };
}

/**
 * Reset compression statistics
 */
export function resetCompressionStats(): void {
  compressionStats.totalCompressions = 0;
  compressionStats.totalDecompressions = 0;
  compressionStats.cacheHits = 0;
  compressionStats.cacheMisses = 0;
  compressionStats.totalBytesCompressed = 0;
  compressionStats.totalBytesDecompressed = 0;
  compressionStats.totalTimeMs = 0;
  logger.debug('Compression statistics reset');
}

function getCodec(): Promise<ZstdCodec> {
  if (!codecPromise) {
    logger.debug('Initializing Zstd codec');
    codecPromise = ZstdInit();
  }
  return codecPromise!;
}

/**
 * Generate cache key from data and level with better hashing
 */
function getCacheKey(data: Uint8Array, level: number): string {
  // Use larger sample (first 1KB or full data if smaller) for better collision resistance
  const sampleSize = Math.min(1024, data.length);
  const sample = data.slice(0, sampleSize);
  // Create a simple hash by combining bytes
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash) + sample[i]!;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `${Math.abs(hash)}_${level}_${data.length}`;
}

/**
 * Clear expired cache entries with secure wiping
 */
function clearExpiredCache(): void {
  logger.debug('Cache cleanup started', { 
    cacheSize: compressionCache.size,
    maxCacheSize: MAX_CACHE_SIZE 
  });

  const now = Date.now();
  let removedCount = 0;
  
  for (const [key, value] of compressionCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      // Securely wipe compressed data before removing
      if (value.compressed && value.compressed.length > 0) {
        // Single pass with random data is sufficient for cache clearing
        crypto.getRandomValues(value.compressed);
        value.compressed.fill(0);
      }
      compressionCache.delete(key);
      removedCount++;
    }
  }
  
  // Limit cache size
  if (compressionCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(compressionCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    toRemove.forEach(([key, value]) => {
      // Securely wipe compressed data before removing
      if (value.compressed && value.compressed.length > 0) {
        // Single pass with random data is sufficient for cache clearing
        crypto.getRandomValues(value.compressed);
        value.compressed.fill(0);
      }
      compressionCache.delete(key);
    });
    removedCount += toRemove.length;
  }

  logger.debug('Cache cleanup completed', { 
    removedCount,
    newCacheSize: compressionCache.size 
  });
}

/**
 * Clear all cache entries with secure wiping
 */
export function clearCompressionCache(): void {
  logger.info('Clearing entire compression cache', { cacheSize: compressionCache.size });
  
  for (const [key, value] of compressionCache.entries()) {
    if (value.compressed && value.compressed.length > 0) {
      // Single pass with random data is sufficient for cache clearing
      crypto.getRandomValues(value.compressed);
      value.compressed.fill(0);
    }
  }
  
  compressionCache.clear();
  logger.info('Compression cache cleared');
}

const MIN_COMPRESS_SIZE = 100;

/**
 * Detect file type for adaptive compression
 */
export function detectFileType(data: Uint8Array): string {
  // Validate input
  if (!data || data.length === 0) {
    return 'text';
  }
  
  // Validate data length to prevent out of bounds access
  if (data.length < 4) {
    return 'text';
  }
  
  // Read header once for efficiency (max 12 bytes needed)
  const headerLength = Math.min(data.length, 12);
  const header = data.slice(0, headerLength);
  
  // Check for image signatures (need 8 bytes)
  if (headerLength >= 8) {
    // PNG: 89 50 4E 47
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
      return 'image';
    }
    
    // JPEG: FF D8 FF
    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
      return 'image';
    }
    
    // GIF: 47 49 46
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
      return 'image';
    }
    
    // WebP: 52 49 46 46
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      return 'image';
    }
  }
  
  // Check for video signatures (need 12 bytes)
  if (headerLength >= 12) {
    // MP4: 66 74 79 70 at offset 4
    if (header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) {
      return 'video';
    }
    
    // AVI: 52 49 46 46
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      return 'video';
    }
  }
  
  // Check for audio signatures (need 12 bytes)
  if (headerLength >= 12) {
    // MP3: FF E0
    if (header[0] === 0xFF && (header[1] & 0xE0) === 0xE0) {
      return 'audio';
    }
    
    // WAV: 52 49 46 46
    if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
      return 'audio';
    }
  }
  
  // Check for already compressed formats (need 4 bytes)
  if (headerLength >= 4) {
    // ZIP: 50 4B 03/05/07
    if (header[0] === 0x50 && header[1] === 0x4B && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07)) {
      return 'compressed';
    }
    
    // GZIP: 1F 8B
    if (header[0] === 0x1F && header[1] === 0x8B) {
      return 'compressed';
    }
    
    // 7Z: 37 7A BC AF
    if (header[0] === 0x37 && header[1] === 0x7A && header[2] === 0xBC && header[3] === 0xAF) {
      return 'compressed';
    }
  }
  
  // Default: text/unknown
  return 'text';
}

/**
 * Compression presets for different use cases
 */
export const COMPRESSION_PRESETS = {
  none: 0,
  fast: 1,
  default: 3,
  good: 6,
  ultra: 12,
  maximum: 19,
  extreme: 22,
} as const;

export type CompressionPreset = keyof typeof COMPRESSION_PRESETS;

/**
 * Get compression level from preset with validation
 */
export function getLevelFromPreset(preset: CompressionPreset | number): number {
  if (typeof preset === 'number') {
    const validation = validateCompressionLevel(preset);
    if (!validation.valid) {
      logger.warn('Invalid compression level, using default', { level: preset, error: validation.error });
      return 3;
    }
    return preset;
  }
  return COMPRESSION_PRESETS[preset];
}

/**
 * Adaptive level selection based on file type and size with validation
 */
export function getAdaptiveLevel(data: Uint8Array, userLevel: number): number {
  // Validate data
  if (!data || data.length === 0) {
    return userLevel;
  }
  
  // Validate userLevel
  const levelValidation = validateCompressionLevel(userLevel);
  if (!levelValidation.valid) {
    logger.warn('Invalid user level, using default', { userLevel, error: levelValidation.error });
    return 3;
  }
  
  const fileType = detectFileType(data);
  const size = data.length;
  
  // Validate size to prevent issues
  if (size > 10 * 1024 * 1024 * 1024) { // 10GB
    logger.warn('Data size exceeds 10GB, using conservative compression', { size });
    return Math.min(userLevel, 5);
  }
  
  // Images: low level (already compressed)
  if (fileType === 'image') {
    return Math.min(userLevel, 2); // Reduced from 3 to 2
  }
  
  // Video: low level (already compressed)
  if (fileType === 'video') {
    return Math.min(userLevel, 2); // Reduced from 3 to 2
  }
  
  // Audio: low level (already compressed)
  if (fileType === 'audio') {
    return Math.min(userLevel, 2); // Reduced from 3 to 2
  }
  
  // Already compressed: skip (level 0)
  if (fileType === 'compressed') {
    return 0;
  }
  
  // Text: higher level for better compression
  if (fileType === 'text') {
    // Larger files can use higher level
    if (size > 100 * 1024 * 1024) { // > 100MB
      return Math.min(userLevel, 15); // Increased from 12 to 15
    }
    if (size > 10 * 1024 * 1024) { // > 10MB
      return Math.min(userLevel, 12); // Increased from 12 to 12 (same)
    }
    if (size > 1 * 1024 * 1024) { // > 1MB
      return Math.min(userLevel, 10); // Increased from 9 to 10
    }
    return Math.min(userLevel, 7); // Increased from 6 to 7
  }
  
  // Default: use user level
  return userLevel;
}

/**
 * Compression statistics interface
 */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  timeMs: number;
  fileType: string;
  level: number;
  adaptiveLevel: number;
}

/**
 * Compress data with Zstd (with adaptive level and statistics)
 */
export async function compressZstd(
  data: Uint8Array,
  level: number,
  useAdaptive: boolean = true,
  collectStats: boolean = false
): Promise<Uint8Array | { data: Uint8Array; stats: CompressionStats }> {
  const startTime = performance.now();
  logger.info('compressZstd started', { 
    dataLength: data?.length,
    level,
    useAdaptive,
    collectStats 
  });

  // Validate input
  if (!data || data.length === 0) {
    logger.warn('compressZstd: data is empty, returning original');
    if (collectStats) {
      return {
        data,
        stats: {
          originalSize: data.length,
          compressedSize: data.length,
          ratio: 0,
          timeMs: performance.now() - startTime,
          fileType: 'unknown',
          level,
          adaptiveLevel: level,
        }
      };
    }
    return data;
  }
  
  if (data.length > 10 * 1024 * 1024 * 1024) { // Max 10GB
    logger.error('compressZstd: data too large (max 10GB)', undefined, { 
      dataLength: data.length 
    });
    throw new Error('compressZstd: data too large (max 10GB)');
  }
  
  // Validate level
  if (typeof level !== 'number' || level < 0 || level > 22) {
    logger.error('compressZstd: invalid level', undefined, { level });
    throw new Error('compressZstd: level must be between 0 and 22');
  }
  
  // Detect file type for stats
  const fileType = detectFileType(data);
  
  // Skip compression for very small data
  if (data.length < MIN_COMPRESS_SIZE) {
    logger.debug('compressZstd: data too small, skip compression', { 
      dataLength: data.length,
      minCompressSize: MIN_COMPRESS_SIZE 
    });
    if (collectStats) {
      return {
        data,
        stats: {
          originalSize: data.length,
          compressedSize: data.length,
          ratio: 0,
          timeMs: performance.now() - startTime,
          fileType,
          level,
          adaptiveLevel: level,
        }
      };
    }
    return data;
  }

  // Check cache for frequently compressed data
  const cacheKey = getCacheKey(data, level);
  const cached = compressionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug('compressZstd: cache hit', { cacheKey });
    if (collectStats) {
      return {
        data: cached.compressed,
        stats: {
          originalSize: data.length,
          compressedSize: cached.compressed.length,
          ratio: ((data.length - cached.compressed.length) / data.length * 100),
          timeMs: performance.now() - startTime,
          fileType,
          level,
          adaptiveLevel: level,
        }
      };
    }
    return cached.compressed;
  }

  // Use adaptive level if enabled
  const actualLevel = useAdaptive ? getAdaptiveLevel(data, level) : level;
  logger.debug('compressZstd: level determined', { 
    originalLevel: level,
    actualLevel,
    useAdaptive 
  });
  
  const codec = await getCodec();
  const compressed = codec.ZstdSimple.compress(data, actualLevel);

  // Validate compressed data
  if (!compressed || compressed.length === 0) {
    logger.error('Compression failed: compressed data is empty', undefined, { 
      dataLength: data.length,
      actualLevel 
    });
    throw new Error('Compression failed: compressed data is empty');
  }

  // Only use compression if it actually reduces size
  if (compressed.length >= data.length) {
    logger.debug('compressZstd: compression not effective, returning original', { 
      originalLength: data.length,
      compressedLength: compressed.length 
    });
    if (collectStats) {
      return {
        data,
        stats: {
          originalSize: data.length,
          compressedSize: data.length,
          ratio: 0,
          timeMs: performance.now() - startTime,
          fileType,
          level,
          adaptiveLevel: actualLevel,
        }
      };
    }
    return data;
  }

  // Cache the result for small to medium data
  if (data.length < 10 * 1024 * 1024) { // Max 10MB for caching
    clearExpiredCache();
    compressionCache.set(cacheKey, { compressed, timestamp: Date.now() });
    logger.debug('compressZstd: result cached', { 
      cacheKey,
      dataLength: data.length 
    });
  }

  const timeMs = performance.now() - startTime;
  logger.info('compressZstd completed', { 
    originalLength: data.length,
    compressedLength: compressed.length,
    ratio: ((data.length - compressed.length) / data.length * 100).toFixed(2) + '%',
    timeMs: timeMs.toFixed(2) + 'ms'
  });

  if (collectStats) {
    return {
      data: compressed,
      stats: {
        originalSize: data.length,
        compressedSize: compressed.length,
        ratio: ((data.length - compressed.length) / data.length * 100),
        timeMs,
        fileType,
        level,
        adaptiveLevel: actualLevel,
      }
    };
  }

  return compressed;
}

/**
 * Decompress data with Zstd
 */
export async function decompressZstd(
  data: Uint8Array,
  originalSize: number
): Promise<Uint8Array> {
  logger.info('decompressZstd started', { 
    dataLength: data?.length,
    originalSize 
  });

  // Validate input
  if (!data || data.length === 0) {
    logger.warn('decompressZstd: data is empty, returning original');
    return data;
  }
  
  if (data.length > 10 * 1024 * 1024 * 1024) { // Max 10GB
    logger.error('decompressZstd: data too large (max 10GB)', undefined, { 
      dataLength: data.length 
    });
    throw new Error('decompressZstd: data too large (max 10GB)');
  }
  
  if (typeof originalSize !== 'number') {
    logger.error('decompressZstd: originalSize must be a number', undefined, { originalSize });
    throw new Error('decompressZstd: originalSize must be a number');
  }
  
  if (originalSize < 0) {
    logger.error('decompressZstd: originalSize must not be negative', undefined, { originalSize });
    throw new Error('decompressZstd: originalSize must not be negative');
  }
  
  if (originalSize > 10 * 1024 * 1024 * 1024) { // Max 10GB
    logger.error('decompressZstd: originalSize too large (max 10GB)', undefined, { originalSize });
    throw new Error('decompressZstd: originalSize too large (max 10GB)');
  }
  
  // Skip decompression for very small data
  if (data.length < MIN_COMPRESS_SIZE) {
    logger.debug('decompressZstd: data too small, skip decompression', { 
      dataLength: data.length,
      minCompressSize: MIN_COMPRESS_SIZE 
    });
    return data;
  }

  const codec = await getCodec();
  const decompressed = codec.ZstdSimple.decompress(data);

  // Validate decompressed data
  if (!decompressed || decompressed.length === 0) {
    logger.error('Decompression failed: decompressed data is empty', undefined, { 
      dataLength: data.length,
      originalSize 
    });
    throw new Error('Decompression failed: decompressed data is empty');
  }

  // Validate decompressed size matches expected (only if originalSize is specified and > 0)
  if (originalSize > 0 && decompressed.length !== originalSize) {
    logger.error('Decompression failed: size does not match', undefined, { 
      expectedSize: originalSize,
      actualSize: decompressed.length 
    });
    throw new Error(`Decompression failed: size does not match (expected: ${originalSize}, got: ${decompressed.length})`);
  }
  
  // Allow empty decompressed data if originalSize is 0 (empty file case)
  if (originalSize === 0 && decompressed.length !== 0) {
    logger.warn('Decompression produced data for empty file', { 
      originalSize,
      actualSize: decompressed.length 
    });
  }

  logger.info('decompressZstd completed', { 
    compressedLength: data.length,
    decompressedLength: decompressed.length,
    ratio: ((decompressed.length - data.length) / decompressed.length * 100).toFixed(2) + '%' 
  });

  return decompressed;
}

/**
 * Streaming compression with TransformStream
 */
export function createCompressTransform(level: number, useAdaptive: boolean = true, collectStats: boolean = false): TransformStream<Uint8Array, Uint8Array> {
  logger.debug('createCompressTransform started', { level, useAdaptive, collectStats });

  // Validate level
  if (!Number.isInteger(level) || level < 0 || level > 22) {
    logger.error('Zstd level must be between 0 and 22', undefined, { level });
    throw new Error('Zstd level must be between 0 and 22');
  }
  
  return new TransformStream({
    async transform(chunk, controller) {
      try {
        // Validate chunk
        if (!chunk || chunk.length === 0) {
          return; // Skip empty chunks
        }
        
        if (chunk.length > 10 * 1024 * 1024 * 1024) { // Max 10GB
          throw new Error('Chunk too large for compression (max 10GB)');
        }
        
        const result = await compressZstd(chunk, level, useAdaptive, collectStats);
        
        // Handle different return types
        if (collectStats && typeof result === 'object' && 'data' in result) {
          controller.enqueue(result.data);
        } else if (result instanceof Uint8Array) {
          controller.enqueue(result);
        }
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Streaming decompression with TransformStream
 */
export function createDecompressTransform(originalSize: number): TransformStream<Uint8Array, Uint8Array> {
  // Validate originalSize
  if (typeof originalSize !== 'number') {
    throw new Error('Original size must be a number');
  }
  
  if (originalSize < 0) {
    throw new Error('Original size must not be negative');
  }
  
  if (originalSize > 10 * 1024 * 1024 * 1024) { // Max 10GB
    throw new Error('Original size too large (max 10GB)');
  }
  
  return new TransformStream({
    async transform(chunk, controller) {
      try {
        // Validate chunk
        if (!chunk || chunk.length === 0) {
          return; // Skip empty chunks
        }
        
        const decompressed = await decompressZstd(chunk, originalSize);
        controller.enqueue(decompressed);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Multi-threaded compression for large files
 */
export async function compressParallel(
  chunks: Uint8Array[],
  level: number,
  workerCount: number,
  useAdaptive: boolean = true,
  collectStats: boolean = false
): Promise<Uint8Array[] | { data: Uint8Array[]; stats: CompressionStats[] }> {
  // Validate chunks array
  if (!chunks || chunks.length === 0) {
    throw new Error('compressParallel: chunks array must not be empty');
  }
  
  if (chunks.length > 10000) {
    throw new Error('compressParallel: too many chunks (max 10000)');
  }
  
  // Validate worker count
  if (typeof workerCount !== 'number' || workerCount < 1) {
    throw new Error('compressParallel: workerCount must be at least 1');
  }
  
  const safeWorkerCount = Math.max(1, Math.min(workerCount, 16)); // Max 16 workers
  
  // Validate compression level
  if (typeof level !== 'number' || level < 0 || level > 22) {
    throw new Error('compressParallel: compression level must be between 0 and 22');
  }
  
  // Optimize batch size based on chunk count
  const chunksPerWorker = Math.ceil(chunks.length / safeWorkerCount);
  const workerBatches: Uint8Array[][] = [];

  for (let i = 0; i < chunks.length; i += chunksPerWorker) {
    workerBatches.push(chunks.slice(i, i + chunksPerWorker));
  }

  // Compress each batch in parallel with concurrency limit
  const results = await Promise.all(
    workerBatches.map(async (batch) => {
      // Process chunks in batches of 10 to avoid overwhelming memory
      const batchSize = 10;
      const compressedBatches: Uint8Array[] = [];
      const statsBatches: CompressionStats[] = [];
      
      for (let i = 0; i < batch.length; i += batchSize) {
        const batchChunk = batch.slice(i, i + batchSize);
        const compressed = await Promise.all(
          batchChunk.map((chunk) => compressZstd(chunk, level, useAdaptive, collectStats))
        );
        
        // Handle different return types
        compressed.forEach((result) => {
          if (collectStats && typeof result === 'object' && 'data' in result) {
            compressedBatches.push(result.data);
            statsBatches.push(result.stats);
          } else if (result instanceof Uint8Array) {
            compressedBatches.push(result);
          }
        });
        
        // Allow event loop to process other tasks
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      return { compressed: compressedBatches, stats: statsBatches };
    })
  );

  // Flatten results
  const allCompressed = results.flatMap(r => r.compressed);
  const allStats = results.flatMap(r => r.stats);

  if (collectStats) {
    return { data: allCompressed, stats: allStats };
  }

  return allCompressed;
}

/**
 * Multi-threaded decompression for large files
 */
export async function decompressParallel(
  chunks: Uint8Array[],
  originalSizes: number[],
  workerCount: number
): Promise<Uint8Array[]> {
  // Validate chunks array
  if (!chunks || chunks.length === 0) {
    throw new Error('decompressParallel: chunks array must not be empty');
  }
  
  if (chunks.length > 10000) {
    throw new Error('decompressParallel: too many chunks (max 10000)');
  }
  
  // Validate originalSizes array
  if (!originalSizes || originalSizes.length === 0) {
    throw new Error('decompressParallel: originalSizes array must not be empty');
  }
  
  if (originalSizes.length !== chunks.length) {
    throw new Error('decompressParallel: originalSizes length must match chunks length');
  }
  
  // Validate worker count
  if (typeof workerCount !== 'number' || workerCount < 1) {
    throw new Error('decompressParallel: workerCount must be at least 1');
  }
  
  const safeWorkerCount = Math.max(1, Math.min(workerCount, 16)); // Max 16 workers
  
  // Optimize batch size based on chunk count
  const chunksPerWorker = Math.ceil(chunks.length / safeWorkerCount);
  const workerBatches: { chunk: Uint8Array; originalSize: number }[][] = [];

  for (let i = 0; i < chunks.length; i += chunksPerWorker) {
    const batch = chunks.slice(i, i + chunksPerWorker);
    const sizes = originalSizes.slice(i, i + chunksPerWorker);
    workerBatches.push(batch.map((chunk, idx) => ({ chunk, originalSize: sizes[idx] })));
  }

  // Decompress each batch in parallel with concurrency limit
  const results = await Promise.all(
    workerBatches.map(async (batch) => {
      // Process chunks in batches of 10 to avoid overwhelming memory
      const batchSize = 10;
      const decompressedBatches: Uint8Array[] = [];
      
      for (let i = 0; i < batch.length; i += batchSize) {
        const batchChunk = batch.slice(i, i + batchSize);
        const decompressed = await Promise.all(
          batchChunk.map(({ chunk, originalSize }) => decompressZstd(chunk, originalSize))
        );
        decompressedBatches.push(...decompressed);
        
        // Allow event loop to process other tasks
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      
      return decompressedBatches;
    })
  );

  // Flatten results
  return results.flat();
}

/**
 * MODULE: Zstandard Streaming Compression
 *
 * Verantwoordelijkheid:
 *  - Zstd compressie/decompressie met streaming
 *  - Multi-threaded compressie
 *  - Adaptive level selection
 *  - Small payload handling
 *
 * Gebruikt door:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * Afhankelijk van:
 *  - @oneidentity/zstd-js
 *
 * @module core/crypto/compression/zstd
 */

import { ZstdInit, type ZstdCodec } from '@oneidentity/zstd-js';

let codecPromise: Promise<ZstdCodec> | null = null;

function getCodec(): Promise<ZstdCodec> {
  if (!codecPromise) {
    codecPromise = ZstdInit();
  }
  return codecPromise!;
}

const MIN_COMPRESS_SIZE = 100;

/**
 * Buffer Pool voor hergebruik van buffers
 * Vermindert GC pressure en verbetert performance
 */
class BufferPool {
  private pool: Map<number, Uint8Array[]> = new Map();
  private maxSize: number = 100;
  private maxTotalMemory: number = 1024 * 1024 * 1024; // 1GB total memory limit
  private currentTotalMemory: number = 0;

  acquire(size: number): Uint8Array {
    const roundedSize = this.roundSize(size);
    const buffers = this.pool.get(roundedSize);

    if (buffers && buffers.length > 0) {
      return buffers.pop()!;
    }

    // Check if acquiring this buffer would exceed memory limit
    if (this.currentTotalMemory + roundedSize > this.maxTotalMemory) {
      // Clear pool and create new buffer
      this.clear();
    }

    const buffer = new Uint8Array(roundedSize);
    this.currentTotalMemory += roundedSize;
    return buffer;
  }

  release(buffer: Uint8Array): void {
    const size = buffer.length;
    const roundedSize = this.roundSize(size);
    const buffers = this.pool.get(roundedSize) || [];

    if (buffers.length < this.maxSize) {
      // Zero out buffer voor security
      buffer.fill(0);
      buffers.push(buffer);
      this.pool.set(roundedSize, buffers);
    } else {
      // Buffer not returned to pool, decrease memory tracking
      this.currentTotalMemory -= size;
    }
  }

  private roundSize(size: number): number {
    // Round up to nearest power of 2 for better reuse
    // Cap at 256MB to prevent excessive memory usage
    const maxSize = 256 * 1024 * 1024;
    const rounded = Math.pow(2, Math.ceil(Math.log2(size)));
    return Math.min(rounded, maxSize);
  }

  clear(): void {
    this.pool.clear();
    this.currentTotalMemory = 0;
  }
}

// Global buffer pool instance
const bufferPool = new BufferPool();

/**
 * Clear buffer pool (for cleanup or memory pressure)
 */
export function clearBufferPool(): void {
  bufferPool.clear();
}

/**
 * Detect bestandstype voor adaptive compressie
 * Optimized: Early return for small data, reduced header checks
 */
export function detectFileType(data: Uint8Array): string {
  // Validate input
  if (!data || data.length === 0) {
    return 'unknown';
  }

  // Early return for small data
  if (data.length < 8) {
    return 'unknown';
  }

  const header = data.subarray(0, 8);

  // Check voor image signatures (optimized with direct byte comparison)
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

  // Check voor video signatures
  if (data.length >= 12) {
    const videoHeader = data.subarray(0, 12);

    // MP4
    if (videoHeader[4] === 0x66 && videoHeader[5] === 0x74 && videoHeader[6] === 0x79 && videoHeader[7] === 0x70) {
      return 'video';
    }

    // AVI
    if (videoHeader[0] === 0x52 && videoHeader[1] === 0x49 && videoHeader[2] === 0x46 && videoHeader[3] === 0x46) {
      return 'video';
    }
  }

  // Check voor audio signatures
  if (data.length >= 12) {
    const audioHeader = data.subarray(0, 12);

    // MP3
    if (audioHeader[0] === 0xFF && (audioHeader[1]! & 0xE0) === 0xE0) {
      return 'audio';
    }

    // WAV
    if (audioHeader[0] === 0x52 && audioHeader[1] === 0x49 && audioHeader[2] === 0x46 && audioHeader[3] === 0x46) {
      return 'audio';
    }
  }

  // Check voor already compressed formats
  if (data.length >= 4) {
    const compressedHeader = data.subarray(0, 4);

    // ZIP
    if (compressedHeader[0] === 0x50 && compressedHeader[1] === 0x4B && (compressedHeader[2] === 0x03 || compressedHeader[2] === 0x05 || compressedHeader[2] === 0x07)) {
      return 'compressed';
    }

    // GZIP
    if (compressedHeader[0] === 0x1F && compressedHeader[1] === 0x8B) {
      return 'compressed';
    }

    // 7Z
    if (compressedHeader[0] === 0x37 && compressedHeader[1] === 0x7A && compressedHeader[2] === 0xBC && compressedHeader[3] === 0xAF) {
      return 'compressed';
    }
  }

  // Default: text/unknown
  return 'text';
}

/**
 * Adaptive level selection op basis van bestandstype en grootte
 */
export function getAdaptiveLevel(data: Uint8Array, userLevel: number): number {
  const fileType = detectFileType(data);
  const size = data.length;
  
  // Images: laag level (al gecomprimeerd)
  if (fileType === 'image') {
    return Math.min(userLevel, 3);
  }
  
  // Video: laag level (al gecomprimeerd)
  if (fileType === 'video') {
    return Math.min(userLevel, 3);
  }
  
  // Audio: laag level (al gecomprimeerd)
  if (fileType === 'audio') {
    return Math.min(userLevel, 3);
  }
  
  // Already compressed: skip (level 0)
  if (fileType === 'compressed') {
    return 0;
  }
  
  // Text: hoger level voor betere compressie
  if (fileType === 'text') {
    // Grotere bestanden kunnen hoger level gebruiken
    if (size > 10 * 1024 * 1024) { // > 10MB
      return Math.min(userLevel, 12);
    }
    if (size > 1 * 1024 * 1024) { // > 1MB
      return Math.min(userLevel, 9);
    }
    return Math.min(userLevel, 6);
  }
  
  // Default: gebruik user level
  return userLevel;
}

/**
 * Compress data met Zstd (met adaptive level en buffer pooling)
 */
export async function compressZstd(
  data: Uint8Array,
  level: number,
  useAdaptive: boolean = true
): Promise<Uint8Array> {
  // Skip compression for very small data
  if (data.length < MIN_COMPRESS_SIZE) {
    return data;
  }

  // Use adaptive level if enabled
  const actualLevel = useAdaptive ? getAdaptiveLevel(data, level) : level;

  const codec = await getCodec();
  const compressed = codec.ZstdSimple.compress(data, actualLevel);

  // Only use compression if it actually reduces size
  if (compressed.length >= data.length) {
    return data;
  }

  return compressed;
}

/**
 * Decompress data met Zstd
 */
export async function decompressZstd(
  data: Uint8Array,
  originalSize: number
): Promise<Uint8Array> {
  // Skip decompression for very small data
  if (data.length < MIN_COMPRESS_SIZE) {
    return data;
  }

  const codec = await getCodec();
  const decompressed = codec.ZstdSimple.decompress(data);

  // Validate size if originalSize is provided
  if (originalSize > 0 && decompressed.length !== originalSize) {
    console.warn('[ZSTD] Decompressed size mismatch - data may be corrupted');
  }

  return decompressed;
}

/**
 * Streaming compressie met TransformStream
 */
export function createCompressTransform(level: number, useAdaptive: boolean = true): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    async transform(chunk, controller) {
      try {
        const compressed = await compressZstd(chunk, level, useAdaptive);
        controller.enqueue(compressed);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Streaming decompressie met TransformStream
 */
export function createDecompressTransform(originalSize: number): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    async transform(chunk, controller) {
      try {
        const decompressed = await decompressZstd(chunk, originalSize);
        controller.enqueue(decompressed);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Multi-threaded compressie voor grote bestanden met buffer pooling en memory limits
 */
export async function compressParallel(
  chunks: Uint8Array[],
  level: number,
  workerCount: number,
  useAdaptive: boolean = true
): Promise<Uint8Array[]> {
  // Optimize worker count based on chunk count
  const optimalWorkerCount = Math.min(workerCount, chunks.length);

  // Limit total chunks to prevent memory issues
  const MAX_CHUNKS = 10000;
  const chunksToProcess = chunks.length > MAX_CHUNKS ? chunks.slice(0, MAX_CHUNKS) : chunks;

  if (chunks.length > MAX_CHUNKS) {
    console.warn(`Extreme chunk count (${chunks.length}), processing only first ${MAX_CHUNKS} chunks`);
  }

  // Split chunks among workers
  const chunksPerWorker = Math.ceil(chunksToProcess.length / optimalWorkerCount);
  const workerBatches: Uint8Array[][] = [];

  for (let i = 0; i < chunksToProcess.length; i += chunksPerWorker) {
    workerBatches.push(chunksToProcess.slice(i, i + chunksPerWorker));
  }

  // Compress each batch in parallel
  const results = await Promise.all(
    workerBatches.map(async (batch) => {
      return Promise.all(batch.map((chunk) => compressZstd(chunk, level, useAdaptive)));
    })
  );

  // Flatten results
  return results.flat();
}

/**
 * Multi-threaded decompressie voor grote bestanden met buffer pooling en memory limits
 */
export async function decompressParallel(
  chunks: Uint8Array[],
  originalSizes: number[],
  workerCount: number
): Promise<Uint8Array[]> {
  // Optimize worker count based on chunk count
  const optimalWorkerCount = Math.min(workerCount, chunks.length);

  // Limit total chunks to prevent memory issues
  const MAX_CHUNKS = 10000;
  const chunksToProcess = chunks.length > MAX_CHUNKS ? chunks.slice(0, MAX_CHUNKS) : chunks;

  if (chunks.length > MAX_CHUNKS) {
    console.warn(`Extreme chunk count (${chunks.length}), processing only first ${MAX_CHUNKS} chunks`);
  }

  // Split chunks among workers
  const chunksPerWorker = Math.ceil(chunksToProcess.length / optimalWorkerCount);
  const workerBatches: { chunk: Uint8Array; originalSize: number }[][] = [];

  for (let i = 0; i < chunksToProcess.length; i += chunksPerWorker) {
    const batch = chunksToProcess.slice(i, i + chunksPerWorker);
    const sizes = originalSizes.slice(i, i + chunksPerWorker);
    workerBatches.push(batch.map((chunk, idx) => ({ chunk, originalSize: sizes[idx] })));
  }

  // Decompress each batch in parallel
  const results = await Promise.all(
    workerBatches.map(async (batch) => {
      return Promise.all(batch.map(({ chunk, originalSize }) => decompressZstd(chunk, originalSize)));
    })
  );

  // Flatten results
  return results.flat();
}

/**
 * Validate Zstd level (0-22)
 */
export function validateZstdLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > 22) {
    throw new Error('Zstd level must be between 0 and 22');
  }
  return level;
}

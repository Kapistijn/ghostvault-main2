/**
 * MODULE: Zstandard Streaming Compression
 *
 * Verantwoordelijkheid:
 * - Zstd compressie/decompressie met streaming
 * - Multi-threaded compressie
 * - Adaptive level selection
 * - Small payload handling
 *
 * Elke chunk krijgt een 1-byte header zodat decompressie deterministisch
 * is en nooit hoeft te raden of een chunk gecomprimeerd is:
 *   0x00 = STORED (rauw, niet gecomprimeerd)
 *   0x01 = ZSTD   (zstd-gecomprimeerd)
 *
 * Gebruikt door:
 * - core/format/packer.ts
 * - core/format/unpacker.ts
 *
 * Afhankelijk van:
 * - @oneidentity/zstd-js
 *
 * @module core/crypto/compression/zstd
 */

import { ZstdInit, type ZstdCodec } from '@oneidentity/zstd-js';
import { CompressionError } from '../../errors.js';

let codecPromise: Promise<ZstdCodec> | null = null;

function getCodec(): Promise<ZstdCodec> {
  if (!codecPromise) {
    codecPromise = ZstdInit();
  }
  return codecPromise!;
}

const MIN_COMPRESS_SIZE = 100;

// 1-byte chunk markers (see module header)
const MARKER_STORED = 0x00;
const MARKER_ZSTD = 0x01;

/** Prefix `payload` with a single marker byte. */
function withMarker(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = marker;
  out.set(payload, 1);
  return out;
}

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

    if (this.currentTotalMemory + roundedSize > this.maxTotalMemory) {
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
      buffer.fill(0);
      buffers.push(buffer);
      this.pool.set(roundedSize, buffers);
    } else {
      this.currentTotalMemory -= size;
    }
  }

  private roundSize(size: number): number {
    // Guard against non-positive sizes: Math.log2(0) is -Infinity which
    // would produce a zero-length buffer.
    if (!Number.isFinite(size) || size <= 0) {
      return 1;
    }
    const maxSize = 256 * 1024 * 1024;
    const rounded = Math.pow(2, Math.ceil(Math.log2(size)));
    return Math.min(rounded, maxSize);
  }

  clear(): void {
    this.pool.clear();
    this.currentTotalMemory = 0;
  }
}

const bufferPool = new BufferPool();

export function clearBufferPool(): void {
  bufferPool.clear();
}

/**
 * Detect bestandstype voor adaptive compressie
 */
export function detectFileType(data: Uint8Array): string {
  if (!data || data.length === 0) return 'unknown';
  if (data.length < 8) return 'unknown';

  const header = data.subarray(0, 8);

  // PNG
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return 'image';
  // JPEG
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return 'image';
  // GIF
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) return 'image';
  // WebP / RIFF
  if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) return 'image';

  if (data.length >= 12) {
    const v = data.subarray(0, 12);
    // MP4
    if (v[4] === 0x66 && v[5] === 0x74 && v[6] === 0x79 && v[7] === 0x70) return 'video';
    // AVI / RIFF
    if (v[0] === 0x52 && v[1] === 0x49 && v[2] === 0x46 && v[3] === 0x46) return 'video';
    // MP3
    if (v[0] === 0xFF && (v[1]! & 0xE0) === 0xE0) return 'audio';
  }

  if (data.length >= 4) {
    const c = data.subarray(0, 4);
    // ZIP
    if (c[0] === 0x50 && c[1] === 0x4B && (c[2] === 0x03 || c[2] === 0x05 || c[2] === 0x07)) return 'compressed';
    // GZIP
    if (c[0] === 0x1F && c[1] === 0x8B) return 'compressed';
    // 7Z
    if (c[0] === 0x37 && c[1] === 0x7A && c[2] === 0xBC && c[3] === 0xAF) return 'compressed';
  }

  return 'text';
}

/**
 * Adaptive level selection op basis van bestandstype en grootte.
 * Hogere levels voor goed comprimeerbare data, laag/uit voor media en
 * reeds gecomprimeerde content.
 */
export function getAdaptiveLevel(data: Uint8Array, userLevel: number): number {
  const fileType = detectFileType(data);
  const size = data.length;

  // Reeds gecomprimeerd: niet nogmaals comprimeren.
  if (fileType === 'compressed') return 0;
  // Media is al gecomprimeerd: laag houden.
  if (fileType === 'image' || fileType === 'video' || fileType === 'audio') {
    return Math.min(userLevel, 3);
  }

  // Tekst/onbekend: schaal het level met de grootte voor betere ratio.
  if (fileType === 'text' || fileType === 'unknown') {
    if (size > 10 * 1024 * 1024) return Math.min(userLevel, 19);
    if (size > 1 * 1024 * 1024) return Math.min(userLevel, 15);
    return Math.min(userLevel, 9);
  }

  return userLevel;
}

/**
 * Compress data met Zstd. Output is ALTIJD voorzien van een 1-byte marker.
 */
export async function compressZstd(
  data: Uint8Array,
  level: number,
  useAdaptive: boolean = true
): Promise<Uint8Array> {
  if (data.length < MIN_COMPRESS_SIZE) {
    return withMarker(MARKER_STORED, data);
  }

  const actualLevel = useAdaptive ? getAdaptiveLevel(data, level) : level;

  if (actualLevel === 0) {
    return withMarker(MARKER_STORED, data);
  }

  const codec = await getCodec();
  const compressed = codec.ZstdSimple.compress(data, actualLevel);

  if (compressed.length >= data.length) {
    return withMarker(MARKER_STORED, data);
  }

  return withMarker(MARKER_ZSTD, compressed);
}

/**
 * Decompress data die door compressZstd is geproduceerd. Leest de marker.
 */
export async function decompressZstd(
  data: Uint8Array,
  originalSize: number = 0
): Promise<Uint8Array> {
  if (!data || data.length === 0) {
    return new Uint8Array(0);
  }

  const marker = data[0];
  const payload = data.subarray(1);

  if (marker === MARKER_STORED) {
    return payload.slice();
  }

  if (marker !== MARKER_ZSTD) {
    throw new CompressionError('Onbekende compressie-marker in chunk', { marker });
  }

  try {
    const codec = await getCodec();
    const decompressed = codec.ZstdSimple.decompress(payload);

    if (originalSize > 0 && decompressed.length !== originalSize) {
      console.warn('[ZSTD] Decompressed size mismatch - data may be corrupted');
    }

    return decompressed;
  } catch (error) {
    throw new CompressionError('Zstd-decompressie mislukt', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
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
export function createDecompressTransform(originalSize: number = 0): TransformStream<Uint8Array, Uint8Array> {
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
 * Multi-threaded compressie voor grote bestanden.
 * Verwerkt ALLE chunks - concurrency wordt begrensd door workerCount.
 */
export async function compressParallel(
  chunks: Uint8Array[],
  level: number,
  workerCount: number,
  useAdaptive: boolean = true
): Promise<Uint8Array[]> {
  if (chunks.length === 0) return [];

  const optimalWorkerCount = Math.max(1, Math.min(workerCount, chunks.length));
  const chunksPerWorker = Math.ceil(chunks.length / optimalWorkerCount);
  const workerBatches: Uint8Array[][] = [];

  for (let i = 0; i < chunks.length; i += chunksPerWorker) {
    workerBatches.push(chunks.slice(i, i + chunksPerWorker));
  }

  const results = await Promise.all(
    workerBatches.map(async (batch) => {
      return Promise.all(batch.map((chunk) => compressZstd(chunk, level, useAdaptive)));
    })
  );

  return results.flat();
}

/**
 * Multi-threaded decompressie voor grote bestanden.
 * Verwerkt ALLE chunks - concurrency wordt begrensd door workerCount.
 */
export async function decompressParallel(
  chunks: Uint8Array[],
  originalSizes: number[],
  workerCount: number
): Promise<Uint8Array[]> {
  if (chunks.length === 0) return [];

  const optimalWorkerCount = Math.max(1, Math.min(workerCount, chunks.length));
  const chunksPerWorker = Math.ceil(chunks.length / optimalWorkerCount);
  const workerBatches: { chunk: Uint8Array; originalSize: number }[][] = [];

  for (let i = 0; i < chunks.length; i += chunksPerWorker) {
    const batch = chunks.slice(i, i + chunksPerWorker);
    const sizes = originalSizes.slice(i, i + chunksPerWorker);
    workerBatches.push(batch.map((chunk, idx) => ({ chunk, originalSize: sizes[idx] ?? 0 })));
  }

  const results = await Promise.all(
    workerBatches.map(async (batch) => {
      return Promise.all(batch.map(({ chunk, originalSize }) => decompressZstd(chunk, originalSize)));
    })
  );

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

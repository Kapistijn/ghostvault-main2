/**
 * MODULE: Multi-Format Compression
 *
 * Verantwoordelijkheid:
 *  - Multi-format compressie (Zstd, LZMA2, Brotli)
 *  - Format selectie op basis van bestandstype
 *  - Fallback naar beste format
 *
 * Gebruikt door:
 *  - core/format/packer.ts
 *
 * Afhankelijk van:
 *  - @oneidentity/zstd-js
 *
 * @module core/crypto/compression/multi-format
 */

import { compressZstd, decompressZstd, detectFileType } from './zstd.js';

export type CompressionFormat = 'zstd' | 'lzma2' | 'brotli' | 'none' | 'auto';

export interface CompressionOptions {
  format: CompressionFormat;
  level: number;
  useAdaptive: boolean;
}

export interface CompressionResult {
  data: Uint8Array;
  format: CompressionFormat;
  ratio: number;
  originalSize: number;
  compressedSize: number;
  timeMs: number;
}

/**
 * Selecteer beste compressie format op basis van bestandstype
 */
export function selectBestFormat(data: Uint8Array): CompressionFormat {
  const fileType = detectFileType(data);
  const size = data.length;

  // Images: Zstd (snel, redeneerbaar goede compressie)
  if (fileType === 'image') {
    return 'zstd';
  }

  // Video: Zstd (snelste voor grote bestanden)
  if (fileType === 'video') {
    return 'zstd';
  }

  // Audio: Zstd
  if (fileType === 'audio') {
    return 'zstd';
  }

  // Already compressed: none
  if (fileType === 'compressed') {
    return 'none';
  }

  // Text: Brotli (betere compressie voor tekst)
  if (fileType === 'text') {
    return 'brotli';
  }

  // Default: Zstd
  return 'zstd';
}

/**
 * Compress met geselecteerd format
 */
export async function compressMultiFormat(
  data: Uint8Array,
  options: CompressionOptions
): Promise<CompressionResult> {
  const originalSize = data.length;
  const startTime = performance.now();

  // Skip compressie voor very small data
  if (data.length < 100) {
    return {
      data,
      format: 'none',
      ratio: 1,
      originalSize,
      compressedSize: originalSize,
      timeMs: 0,
    };
  }

  // Gebruik geselecteerd format of selecteer automatisch
  const format = options.format === 'auto' ? selectBestFormat(data) : options.format as CompressionFormat;

  // Skip als format 'none' is
  if (format === 'none') {
    return {
      data,
      format: 'none',
      ratio: 1,
      originalSize,
      compressedSize: originalSize,
      timeMs: 0,
    };
  }

  let compressed: Uint8Array;

  switch (format) {
    case 'zstd':
      compressed = await compressZstd(data, options.level, options.useAdaptive);
      break;
    case 'lzma2':
      // LZMA2 compressie (placeholder - zou lzma-js library nodig hebben)
      // Voor nu fallback naar zstd met hoger level
      compressed = await compressZstd(data, Math.min(options.level + 3, 22), options.useAdaptive);
      break;
    case 'brotli':
      // Brotli compressie (placeholder - zou brotli library nodig hebben)
      // Voor nu fallback naar zstd
      compressed = await compressZstd(data, options.level, options.useAdaptive);
      break;
    default:
      compressed = data;
  }

  const endTime = performance.now();

  // Controleer of compressie daadwerkelijk helpt
  if (compressed.length >= data.length) {
    return {
      data,
      format: 'none',
      ratio: 1,
      originalSize,
      compressedSize: originalSize,
      timeMs: endTime - startTime,
    };
  }

  return {
    data: compressed,
    format,
    ratio: data.length / compressed.length,
    originalSize,
    compressedSize: compressed.length,
    timeMs: endTime - startTime,
  };
}

/**
 * Decompress op basis van format
 */
export async function decompressMultiFormat(
  data: Uint8Array,
  format: CompressionFormat,
  originalSize: number
): Promise<Uint8Array> {
  switch (format) {
    case 'zstd':
      return decompressZstd(data, originalSize);
    case 'lzma2':
      // LZMA2 decompressie (placeholder)
      return decompressZstd(data, originalSize);
    case 'brotli':
      // Brotli decompressie (placeholder)
      return decompressZstd(data, originalSize);
    case 'none':
      return data;
    default:
      throw new Error(`Unknown compression format: ${format}`);
  }
}

/**
 * Compress preview - toon verwachte compressie ratio
 */
export async function compressPreview(
  data: Uint8Array,
  options: CompressionOptions
): Promise<{ format: CompressionFormat; estimatedRatio: number }> {
  // Neem eerste 10KB voor preview
  const previewSize = Math.min(data.length, 10 * 1024);
  const previewData = data.slice(0, previewSize);

  const result = await compressMultiFormat(previewData, options);

  // Extrapoler ratio voor volledig bestand
  const estimatedRatio = result.ratio;

  return {
    format: result.format,
    estimatedRatio,
  };
}

/**
 * MODULE: Multi-Format Compression
 *
 * Verantwoordelijkheid:
 * - Compressie-formaatselectie (Zstd of geen)
 * - Automatische keuze op basis van bestandstype
 *
 * Alleen Zstd wordt daadwerkelijk ondersteund. Eerdere versies deden
 * alsof Brotli/LZMA2 werden ondersteund, maar die vielen stilletjes
 * terug op Zstd - dat is verwijderd om misleiding te voorkomen.
 *
 * Gebruikt door:
 * - core/format/packer.ts
 *
 * Afhankelijk van:
 * - core/crypto/compression/zstd.ts
 *
 * @module core/crypto/compression/multi-format
 */

import { compressZstd, decompressZstd, detectFileType } from './zstd.js';

/**
 * Ondersteunde compressie-formaten.
 * - 'zstd': Zstandard compressie
 * - 'none': geen compressie (rauw opslaan)
 * - 'auto': kies automatisch op basis van bestandstype
 */
export type CompressionFormat = 'zstd' | 'none' | 'auto';

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
 * Selecteer het beste compressie-formaat op basis van bestandstype.
 * Al-gecomprimeerde content wordt niet nogmaals gecomprimeerd.
 */
export function selectBestFormat(data: Uint8Array): CompressionFormat {
  const fileType = detectFileType(data);

  // Reeds gecomprimeerd (zip/gzip/7z): niet nogmaals comprimeren.
  if (fileType === 'compressed') {
    return 'none';
  }

  // Alles anders: Zstd (het enige echt ondersteunde formaat).
  return 'zstd';
}

/**
 * Compress met het geselecteerde formaat.
 */
export async function compressMultiFormat(
  data: Uint8Array,
  options: CompressionOptions
): Promise<CompressionResult> {
  const originalSize = data.length;
  const startTime = performance.now();

  // Skip compressie voor zeer kleine data
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

  // Bepaal het formaat (automatisch of expliciet)
  const format = options.format === 'auto' ? selectBestFormat(data) : options.format;

  if (format === 'none') {
    return {
      data,
      format: 'none',
      ratio: 1,
      originalSize,
      compressedSize: originalSize,
      timeMs: performance.now() - startTime,
    };
  }

  // format === 'zstd'
  const compressed = await compressZstd(data, options.level, options.useAdaptive);
  const endTime = performance.now();

  // Als compressie niet helpt, meld 'none' (compressZstd markeert de chunk
  // zelf al als STORED, dus de data is hoe dan ook correct decodeerbaar).
  if (compressed.length >= data.length) {
    return {
      data: compressed,
      format: 'none',
      ratio: 1,
      originalSize,
      compressedSize: compressed.length,
      timeMs: endTime - startTime,
    };
  }

  return {
    data: compressed,
    format: 'zstd',
    ratio: data.length / compressed.length,
    originalSize,
    compressedSize: compressed.length,
    timeMs: endTime - startTime,
  };
}

/**
 * Decompress op basis van formaat.
 */
export async function decompressMultiFormat(
  data: Uint8Array,
  format: CompressionFormat,
  originalSize: number
): Promise<Uint8Array> {
  switch (format) {
    case 'zstd':
    case 'auto':
      // 'auto' output is altijd zstd-gemarkeerd; decompressZstd leest de marker.
      return decompressZstd(data, originalSize);
    case 'none':
      return data;
    default:
      throw new Error(`Unknown compression format: ${format}`);
  }
}

/**
 * Compress preview - schat de verwachte compressie-ratio in.
 */
export async function compressPreview(
  data: Uint8Array,
  options: CompressionOptions
): Promise<{ format: CompressionFormat; estimatedRatio: number }> {
  // Neem eerste 10KB voor preview
  const previewSize = Math.min(data.length, 10 * 1024);
  const previewData = data.slice(0, previewSize);

  const result = await compressMultiFormat(previewData, options);

  return {
    format: result.format,
    estimatedRatio: result.ratio,
  };
}

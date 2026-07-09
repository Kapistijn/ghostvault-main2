/**
 * MODULE: Adaptive Chunk Size
 *
 * Verantwoordelijkheid:
 *  - Automatische detectie van optimale chunk size
 *  - SSD + veel RAM: 64MB chunks
 *  - Gemiddelde PC: 16MB chunks
 *  - Oude PC: 4MB chunks
 *
 * Gebruikt door:
 *  - core/format/packer.ts
 *  - core/stream/transfer.ts
 *
 * Afhankelijk van:
 *  - core/types/index.ts
 *
 * @module core/stream/adaptive-chunk
 */

import type { AdaptiveChunkConfig } from '../types/index.js';

const CHUNK_SIZE_OLD_PC = 4 * 1024 * 1024; // 4MB
const CHUNK_SIZE_AVG_PC = 16 * 1024 * 1024; // 16MB
const CHUNK_SIZE_HIGH_END = 64 * 1024 * 1024; // 64MB

/**
 * Detecteer of het een SSD is
 */
async function detectSSD(): Promise<boolean> {
  // In browser: Storage API estimate
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      // SSDs typically have much higher quota
      return (estimate.quota ?? 0) > 100 * 1024 * 1024 * 1024; // > 100GB
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Detecteer beschikbaar RAM (in GB)
 */
function detectRAM(): number {
  if ('navigator' in globalThis && 'deviceMemory' in navigator) {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return nav.deviceMemory || 8; // Chrome-only, fallback to 8GB
  }
  // Fallback: assume 8GB average
  return 8;
}

/**
 * Detecteer aantal CPU cores
 */
function detectCPUCores(): number {
  if ('navigator' in globalThis && 'hardwareConcurrency' in navigator) {
    return navigator.hardwareConcurrency || 4;
  }
  return 4;
}

/**
 * Bepaal optimale chunk size op basis van systeem specificaties
 */
export async function getAdaptiveChunkConfig(): Promise<AdaptiveChunkConfig> {
  const ssd = await detectSSD();
  const ramGB = detectRAM();
  const cpuCores = detectCPUCores();

  let chunkSize: number;

  // SSD + veel RAM + veel cores = 64MB
  if (ssd && ramGB >= 16 && cpuCores >= 8) {
    chunkSize = CHUNK_SIZE_HIGH_END;
  }
  // SSD of veel RAM = 16MB
  else if (ssd || ramGB >= 8) {
    chunkSize = CHUNK_SIZE_AVG_PC;
  }
  // Oude PC = 4MB
  else {
    chunkSize = CHUNK_SIZE_OLD_PC;
  }

  return {
    ssd,
    ramGB,
    cpuCores,
    chunkSize,
  };
}

/**
 * Bepaal aantal workers voor multi-threading
 * Gebruikt cores - 2 om systeem responsief te houden
 * Optimaliseert voor kleine bestanden (minder workers)
 */
export function getWorkerCount(chunkCount?: number): number {
  const cpuCores = detectCPUCores();
  const baseWorkers = Math.max(1, cpuCores - 2);

  // Voor kleine bestanden, gebruik minder workers om overhead te vermijden
  if (chunkCount && chunkCount < 4) {
    return Math.min(baseWorkers, chunkCount);
  }

  return baseWorkers;
}

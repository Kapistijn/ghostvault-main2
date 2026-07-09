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
 * Detecteer of het een SSD
 */
async function detectSSD(): Promise<boolean> {
  // In browser: Storage API estimate is unreliable for SSD detection
  // Use a more conservative approach: assume SSD if high RAM + high CPU cores
  // This is a heuristic since true SSD detection isn't available in browsers
  const ramGB = detectRAM();
  const cpuCores = detectCPUCores();
  // Assume SSD if we have good specs (8GB+ RAM or 4+ cores)
  return ramGB >= 8 || cpuCores >= 4;
}

/**
 * Detecteer beschikbaar RAM (in GB)
 */
function detectRAM(): number {
  if ('navigator' in globalThis && 'deviceMemory' in navigator) {
    const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    // Validate memory value is reasonable
    if (typeof memory === 'number' && memory >= 0.5 && memory <= 128) {
      return memory;
    }
  }
  // Fallback: assume 8GB average
  return 8;
}

/**
 * Detecteer aantal CPU cores
 */
function detectCPUCores(): number {
  if ('navigator' in globalThis && 'hardwareConcurrency' in navigator) {
    const cores = navigator.hardwareConcurrency;
    // Validate cores value is reasonable
    if (typeof cores === 'number' && cores >= 1 && cores <= 128) {
      return cores;
    }
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

  // Validate detected values
  if (ramGB <= 0 || ramGB > 1024) {
    // Invalid RAM detected, use fallback
    console.warn('[AdaptiveChunk] Invalid RAM value detected, using fallback');
  }
  
  if (cpuCores <= 0 || cpuCores > 256) {
    // Invalid CPU cores detected, use fallback
    console.warn('[AdaptiveChunk] Invalid CPU cores value detected, using fallback');
  }

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
 */
export function getWorkerCount(): number {
  const cpuCores = detectCPUCores();
  // Validate cpuCores is reasonable
  if (cpuCores <= 0 || cpuCores > 256) {
    console.warn('[AdaptiveChunk] Invalid CPU cores value detected, using fallback');
    return 2; // Fallback to 2 workers for safety
  }
  return Math.max(1, cpuCores - 2);
}

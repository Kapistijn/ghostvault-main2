/**
 * MODULE: Memory Wipe
 *
 * Verantwoordelijkheid:
 * - Secure memory wiping van Uint8Array buffers
 * - Zero-fill buffers na gebruik
 * - Memory tracking en cleanup
 *
 * Gebruikt door:
 * - core/format/packer.ts
 * - core/format/unpacker.ts
 *
 * @module core/security/memory-wipe
 */

/**
 * Memory tracker voor monitoring van geheugengebruik
 * Optimized: Avoid intermediate array creation
 */
class MemoryTracker {
  private allocations: Map<string, { size: number; timestamp: number }> = new Map();
  private maxSize: number = 100;

  track(id: string, size: number): void {
    if (this.allocations.size >= this.maxSize) {
      // Remove oldest entry without creating intermediate array
      let oldestId: string | null = null;
      let oldestTimestamp = Infinity;

      for (const [currentId, entry] of this.allocations.entries()) {
        if (entry.timestamp < oldestTimestamp) {
          oldestTimestamp = entry.timestamp;
          oldestId = currentId;
        }
      }

      if (oldestId) {
        this.allocations.delete(oldestId);
      }
    }

    this.allocations.set(id, { size, timestamp: Date.now() });
  }

  untrack(id: string): void {
    this.allocations.delete(id);
  }

  getTotalTracked(): number {
    let total = 0;
    for (const entry of this.allocations.values()) {
      total += entry.size;
    }
    return total;
  }

  getAllocationCount(): number {
    return this.allocations.size;
  }

  clear(): void {
    this.allocations.clear();
  }
}

// Global memory tracker instance
export const memoryTracker = new MemoryTracker();

/**
 * Get memory statistics
 */
export function getMemoryStats(): { totalTracked: number; allocationCount: number } {
  return {
    totalTracked: memoryTracker.getTotalTracked(),
    allocationCount: memoryTracker.getAllocationCount()
  };
}

/**
 * Clear memory tracker (for cleanup)
 */
export function clearMemoryTracker(): void {
  memoryTracker.clear();
}

/**
 * Wipe een Uint8Array met nullen (werkt echt: buffers zijn muteerbaar).
 */
export function wipeBuffer(buffer: Uint8Array): void {
  buffer.fill(0);
}

/**
 * Wipe alle data in een array van buffers.
 */
export function wipeBuffers(buffers: Uint8Array[]): void {
  for (const buffer of buffers) {
    buffer.fill(0);
  }
}

/**
 * LET OP: dit is GEEN echte wipe.
 *
 * JavaScript-strings zijn immutable; hun onderliggende geheugen kan niet
 * betrouwbaar worden overschreven vanuit JS. Deze functie bestaat alleen
 * zodat callers hun intentie kunnen uitdrukken - vertrouw er NIET op voor
 * security. Sla gevoelige data op in een Uint8Array en gebruik wipeBuffer.
 */
export function wipeString(_str: string): void {
  // Bewust leeg: niet mogelijk in JS. Zie docstring hierboven.
}

/**
 * Secure memory allocator die automatisch wipt na gebruik
 * Geoptimaliseerd met memory tracking
 */
export class SecureMemory {
  private data: Uint8Array;
  private wiped: boolean = false;
  private id: string;

  constructor(size: number, id?: string) {
    this.data = new Uint8Array(size);
    this.id = id || `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    memoryTracker.track(this.id, size);
  }

  getData(): Uint8Array {
    if (this.wiped) {
      throw new Error('Memory has been wiped');
    }
    return this.data;
  }

  setData(data: Uint8Array): void {
    if (this.wiped) {
      throw new Error('Memory has been wiped');
    }
    this.data.set(data);
  }

  wipe(): void {
    if (!this.wiped) {
      this.data.fill(0);
      this.wiped = true;
      memoryTracker.untrack(this.id);
    }
  }

  isWiped(): boolean {
    return this.wiped;
  }

  getSize(): number {
    return this.data.length;
  }
}

/**
 * Auto-delete timer voor bestanden.
 * Gebruikt ReturnType<typeof setTimeout> zodat het type klopt in zowel
 * browser (number) als Node (Timeout), i.p.v. het browser-onjuiste
 * NodeJS.Timeout.
 */
export class AutoDeleteTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
  }

  start(minutes: number): void {
    this.stop();
    // Guard tegen ongeldige/niet-eindige waarden.
    if (Number.isFinite(minutes) && minutes > 0) {
      this.timer = setTimeout(this.callback, minutes * 60 * 1000);
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isActive(): boolean {
    return this.timer !== null;
  }
}

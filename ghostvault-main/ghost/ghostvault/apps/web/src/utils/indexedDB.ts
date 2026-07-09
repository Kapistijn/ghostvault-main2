/**
 * IndexedDB Caching for Large Files
 * Provides persistent caching for frequently accessed files
 */

const DB_NAME = 'GhostVaultCache';
const DB_VERSION = 1;
const STORE_NAME = 'files';

interface CachedFile {
  id: string;
  data: Uint8Array;
  timestamp: number;
  size: number;
  mimeType: string;
}

interface CacheMetadata {
  id: string;
  timestamp: number;
  size: number;
  mimeType: string;
}

class IndexedDBCache {
  private db: IDBDatabase | null = null;
  private maxCacheSize: number = 100 * 1024 * 1024; // 100MB default
  private maxAge: number = 24 * 60 * 60 * 1000; // 24 hours

  constructor(maxCacheSize?: number, maxAge?: number) {
    if (maxCacheSize) this.maxCacheSize = maxCacheSize;
    if (maxAge) this.maxAge = maxAge;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('size', 'size', { unique: false });
        }
      };
    });
  }

  async put(id: string, data: Uint8Array, mimeType: string = 'application/octet-stream'): Promise<void> {
    if (!this.db) await this.init();

    // Check if cache is full
    await this.evictOldEntries();

    const cachedFile: CachedFile = {
      id,
      data,
      timestamp: Date.now(),
      size: data.length,
      mimeType,
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(cachedFile);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async get(id: string): Promise<Uint8Array | null> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result as CachedFile | undefined;
        if (!result) {
          resolve(null);
          return;
        }

        // Check if entry is expired
        if (Date.now() - result.timestamp > this.maxAge) {
          this.delete(id);
          resolve(null);
          return;
        }

        resolve(result.data);
      };
    });
  }

  async delete(id: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getMetadata(): Promise<CacheMetadata[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const results = request.result as CachedFile[];
        const metadata: CacheMetadata[] = results.map(r => ({
          id: r.id,
          timestamp: r.timestamp,
          size: r.size,
          mimeType: r.mimeType,
        }));
        resolve(metadata);
      };
    });
  }

  async getCacheSize(): Promise<number> {
    const metadata = await this.getMetadata();
    return metadata.reduce((sum, m) => sum + m.size, 0);
  }

  private async evictOldEntries(): Promise<void> {
    const cacheSize = await this.getCacheSize();
    
    if (cacheSize > this.maxCacheSize) {
      // Get all entries sorted by timestamp (oldest first)
      const metadata = await this.getMetadata();
      metadata.sort((a, b) => a.timestamp - b.timestamp);

      // Delete oldest entries until under limit
      let currentSize = cacheSize;
      for (const meta of metadata) {
        if (currentSize <= this.maxCacheSize * 0.8) break; // Keep 20% buffer
        await this.delete(meta.id);
        currentSize -= meta.size;
      }
    }
  }

  async evictExpiredEntries(): Promise<void> {
    const metadata = await this.getMetadata();
    const now = Date.now();

    for (const meta of metadata) {
      if (now - meta.timestamp > this.maxAge) {
        await this.delete(meta.id);
      }
    }
  }
}

// Global cache instance
export const globalCache = new IndexedDBCache();

/**
 * Progress tracker with requestAnimationFrame for smooth updates
 */
export class ProgressTracker {
  private progress: number = 0;
  private listeners: Set<(progress: number) => void> = new Set();
  private rafId: number | null = null;
  private lastUpdateTime: number = 0;
  private updateInterval: number = 16; // ~60fps

  setProgress(value: number): void {
    this.progress = Math.max(0, Math.min(100, value));
    this.scheduleUpdate();
  }

  getProgress(): number {
    return this.progress;
  }

  onProgress(callback: (progress: number) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private scheduleUpdate(): void {
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateInterval) {
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(() => {
          this.notifyListeners();
          this.rafId = null;
        });
      }
    } else {
      this.notifyListeners();
    }
  }

  private notifyListeners(): void {
    this.lastUpdateTime = Date.now();
    this.listeners.forEach(listener => listener(this.progress));
  }

  reset(): void {
    this.setProgress(0);
  }

  destroy(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.listeners.clear();
  }
}

/**
 * Debounced progress updates for performance
 */
export class DebouncedProgressTracker {
  private progress: number = 0;
  private listeners: Set<(progress: number) => void> = new Set();
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private delay: number;

  constructor(delay: number = 100) {
    this.delay = delay;
  }

  setProgress(value: number): void {
    this.progress = Math.max(0, Math.min(100, value));
    
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      this.notifyListeners();
    }, this.delay);
  }

  getProgress(): number {
    return this.progress;
  }

  onProgress(callback: (progress: number) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener(this.progress));
  }

  reset(): void {
    this.setProgress(0);
  }

  destroy(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.listeners.clear();
  }
}

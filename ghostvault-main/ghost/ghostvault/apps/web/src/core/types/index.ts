/**
 * MODULE: Core Types
 *
 * Verantwoordelijkheid:
 *  - TypeScript type definitions voor hele core library
 *  - Gedeelde interfaces en types
 *
 * Gebruikt door:
 *  - Alle core modules
 *
 * Afhankelijk van:
 *  - Geen
 *
 * @module core/types
 */

export interface ChunkInfo {
  id: number;
  offset: number;
  compressedSize: number;
  originalSize: number;
  sha256: string;
}

export interface TransferProgress {
  transferId: string;
  currentChunk: number;
  totalChunks: number;
  bytesProcessed: number;
  totalBytes: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface AdaptiveChunkConfig {
  ssd: boolean;
  ramGB: number;
  cpuCores: number;
  chunkSize: number; // 4MB, 16MB, or 64MB
}

export interface FileSystemAccessHandle {
  writable: FileSystemWritableFileStream;
  close: () => Promise<void>;
}

/**
 * Web Worker for Compression Operations
 * Offloads heavy compression computations to a separate thread
 */

let compressionLevel = 3;
let useAdaptive = true;

self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case 'setLevel':
        // Validate compression level
        if (!data || typeof data.level !== 'number' || data.level < 0 || data.level > 22) {
          throw new Error('Invalid compression level: must be between 0 and 22');
        }
        compressionLevel = data.level;
        useAdaptive = data.useAdaptive ?? true;
        self.postMessage({ type: 'levelSet', success: true });
        break;

      case 'compressChunk':
        // Validate input data
        if (!data || !data.data || !(data.data instanceof Uint8Array)) {
          throw new Error('Invalid data for compression');
        }
        if (data.data.length === 0) {
          throw new Error('Data cannot be empty');
        }
        if (data.data.length > 10 * 1024 * 1024 * 1024) {
          throw new Error('Data too large for compression (max 10GB)');
        }
        const compressed = await compressChunk(data.data, data.level, data.useAdaptive);
        self.postMessage({ type: 'compressResult', data: compressed, chunkId: data.chunkId });
        break;

      case 'decompressChunk':
        // Validate input data
        if (!data || !data.data || !(data.data instanceof Uint8Array)) {
          throw new Error('Invalid data for decompression');
        }
        if (data.data.length === 0) {
          throw new Error('Data cannot be empty');
        }
        if (data.data.length > 10 * 1024 * 1024 * 1024) {
          throw new Error('Data too large for decompression (max 10GB)');
        }
        if (typeof data.originalSize !== 'number' || data.originalSize < 0) {
          throw new Error('Invalid original size');
        }
        const decompressed = await decompressChunk(data.data, data.originalSize);
        self.postMessage({ type: 'decompressResult', data: decompressed, chunkId: data.chunkId });
        break;

      case 'compressBatch':
        // Validate input data
        if (!data || !data.chunks || !Array.isArray(data.chunks)) {
          throw new Error('Invalid chunks data');
        }
        if (data.chunks.length === 0) {
          throw new Error('Chunks array cannot be empty');
        }
        if (data.chunks.length > 10000) {
          throw new Error('Too many chunks (max 10000)');
        }
        const batchCompressed = await compressBatch(data.chunks, data.level, data.useAdaptive);
        self.postMessage({ type: 'compressBatchResult', data: batchCompressed });
        break;

      case 'decompressBatch':
        // Validate input data
        if (!data || !data.chunks || !Array.isArray(data.chunks)) {
          throw new Error('Invalid chunks data');
        }
        if (data.chunks.length === 0) {
          throw new Error('Chunks array cannot be empty');
        }
        if (data.chunks.length > 10000) {
          throw new Error('Too many chunks (max 10000)');
        }
        const batchDecompressed = await decompressBatch(data.chunks, data.originalSizes);
        self.postMessage({ type: 'decompressBatchResult', data: batchDecompressed });
        break;

      case 'detectFileType':
        // Validate input data
        if (!data || !data.data || !(data.data instanceof Uint8Array)) {
          throw new Error('Invalid data for file type detection');
        }
        const fileType = detectFileType(data.data);
        self.postMessage({ type: 'fileTypeResult', data: fileType, chunkId: data.chunkId });
        break;

      case 'getAdaptiveLevel':
        // Validate input data
        if (!data || !data.data || !(data.data instanceof Uint8Array)) {
          throw new Error('Invalid data for adaptive level detection');
        }
        const adaptiveLevel = getAdaptiveLevel(data.data, data.level);
        self.postMessage({ type: 'adaptiveLevelResult', data: adaptiveLevel, chunkId: data.chunkId });
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      chunkId: data?.chunkId
    });
  }
};

async function compressChunk(
  data: Uint8Array,
  level?: number,
  adaptive?: boolean
): Promise<Uint8Array> {
  // Import zstd dynamically
  const { ZstdInit, ZstdSimple } = await import('@oneidentity/zstd-js');
  
  const actualLevel = adaptive ? getAdaptiveLevel(data, level || compressionLevel) : (level || compressionLevel);
  
  // Skip compression for very small data
  if (data.length < 100) {
    return data;
  }
  
  const codec = await ZstdInit();
  const compressed = ZstdSimple.compress(data, actualLevel);
  
  // Only use compression if it actually reduces size
  if (compressed.length >= data.length) {
    return data;
  }
  
  return compressed;
}

async function decompressChunk(
  data: Uint8Array,
  originalSize: number
): Promise<Uint8Array> {
  // Import zstd dynamically
  const { ZstdInit, ZstdSimple } = await import('@oneidentity/zstd-js');
  
  const codec = await ZstdInit();
  const decompressed = ZstdSimple.decompress(data);
  
  return decompressed;
}

async function compressBatch(
  chunks: Uint8Array[],
  level?: number,
  adaptive?: boolean
): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];
  
  // Process in batches to avoid overwhelming memory
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, chunks.length);
    
    for (let j = i; j < batchEnd; j++) {
      const result = await compressChunk(chunks[j], level, adaptive);
      results.push(result);
    }
    
    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return results;
}

async function decompressBatch(
  chunks: Uint8Array[],
  originalSizes: number[]
): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];
  
  // Process in batches to avoid overwhelming memory
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, chunks.length);
    
    for (let j = i; j < batchEnd; j++) {
      const result = await decompressChunk(chunks[j], originalSizes[j]);
      results.push(result);
    }
    
    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return results;
}

function detectFileType(data: Uint8Array): string {
  if (!data || data.length === 0) {
    return 'text';
  }
  
  // Check for common file signatures
  if (data.length >= 4) {
    // PNG
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
      return 'image';
    }
    // JPEG
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
      return 'image';
    }
    // PDF
    if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
      return 'document';
    }
    // ZIP
    if (data[0] === 0x50 && data[1] === 0x4B && data[2] === 0x03 && data[3] === 0x04) {
      return 'archive';
    }
  }
  
  // Check for binary data (null bytes)
  let nullCount = 0;
  const sampleSize = Math.min(1024, data.length);
  for (let i = 0; i < sampleSize; i++) {
    if (data[i] === 0) {
      nullCount++;
    }
  }
  
  // If more than 5% null bytes, likely binary
  if (nullCount / sampleSize > 0.05) {
    return 'binary';
  }
  
  return 'text';
}

function getAdaptiveLevel(data: Uint8Array, baseLevel: number): number {
  const fileType = detectFileType(data);
  
  // Higher compression for text, lower for already compressed formats
  switch (fileType) {
    case 'text':
      return Math.min(baseLevel + 3, 22);
    case 'image':
      return Math.max(baseLevel - 2, 1);
    case 'archive':
      return Math.max(baseLevel - 3, 0);
    case 'document':
      return Math.min(baseLevel + 1, 22);
    default:
      return baseLevel;
  }
}

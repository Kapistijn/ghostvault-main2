/**
 * MODULE: File Deduplication
 *
 * Verantwoordelijkheid:
 *  - Block-level deduplicatie
 *  - Cross-file deduplicatie
 *  - Deduplicatie voor compressie
 *
 * Gebruikt door:
 *  - core/format/packer.ts
 *
 * @module core/crypto/deduplication
 */

export interface DeduplicationResult {
  deduplicated: Uint8Array[];
  deduplicationRatio: number;
  blocksDeduplicated: number;
  totalBlocks: number;
}

export interface BlockHash {
  hash: string;
  index: number;
}

const BLOCK_SIZE = 64 * 1024; // 64KB blocks

/**
 * Split data in blocks
 */
export function splitIntoBlocks(data: Uint8Array, blockSize: number = BLOCK_SIZE): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += blockSize) {
    // Use subarray instead of slice to avoid copying
    blocks.push(data.subarray(i, i + blockSize));
  }
  return blocks;
}

/**
 * Calculate SHA-256 hash for a block
 * Optimized: Direct hex conversion without intermediate array
 */
async function hashBlock(block: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', block as BufferSource);
  const hashArray = new Uint8Array(hash);
  let hashHex = '';
  for (let i = 0; i < hashArray.length; i++) {
    hashHex += hashArray[i]!.toString(16).padStart(2, '0');
  }
  return hashHex;
}

/**
 * Deduplicate blocks within a single file
 */
export async function deduplicateBlocks(blocks: Uint8Array[]): Promise<DeduplicationResult> {
  // Validate input
  if (!blocks || blocks.length === 0) {
    return {
      deduplicated: [],
      deduplicationRatio: 0,
      blocksDeduplicated: 0,
      totalBlocks: 0,
    };
  }

  const blockHashes: Map<string, number> = new Map();
  const deduplicated: Uint8Array[] = [];
  let blocksDeduplicated = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    
    // Validate block
    if (!block || block.length === 0) {
      console.warn(`Empty or invalid block at index ${i}, skipping`);
      continue;
    }

    try {
      const hash = await hashBlock(block);

      if (blockHashes.has(hash)) {
        // Block already exists, skip
        blocksDeduplicated++;
      } else {
        // New block, add to deduplicated
        blockHashes.set(hash, deduplicated.length);
        deduplicated.push(block);
      }
    } catch (hashError) {
      console.error(`Failed to hash block at index ${i}:`, hashError);
      // Skip blocks that fail to hash
      continue;
    }
  }

  const totalBlocks = blocks.length;
  const deduplicationRatio = totalBlocks > 0 ? blocksDeduplicated / totalBlocks : 0;

  return {
    deduplicated,
    deduplicationRatio,
    blocksDeduplicated,
    totalBlocks,
  };
}

/**
 * Deduplicate across multiple files
 * Optimized: Batch processing with controlled concurrency
 */
export async function deduplicateCrossFile(
  files: Uint8Array[]
): Promise<{ deduplicated: Uint8Array[]; fileMappings: number[][] }> {
  const blockHashes: Map<string, number> = new Map();
  const deduplicated: Uint8Array[] = [];
  const fileMappings: number[][] = [];

  // Process files in batches to avoid overwhelming the event loop
  const BATCH_SIZE = 10;
  for (let fileStart = 0; fileStart < files.length; fileStart += BATCH_SIZE) {
    const fileEnd = Math.min(fileStart + BATCH_SIZE, files.length);
    const fileBatch = files.slice(fileStart, fileEnd);

    const filePromises = fileBatch.map(async (file, batchIndex) => {
      const fileIndex = fileStart + batchIndex;
      const blocks = splitIntoBlocks(file);
      const mapping: number[] = [];

      for (const block of blocks) {
        const hash = await hashBlock(block);

        if (blockHashes.has(hash)) {
          // Block already exists, reference it
          mapping.push(blockHashes.get(hash)!);
        } else {
          // New block, add to deduplicated
          blockHashes.set(hash, deduplicated.length);
          mapping.push(deduplicated.length);
          deduplicated.push(block);
        }
      }

      return { fileIndex, mapping };
    });

    const batchResults = await Promise.all(filePromises);

    // Sort results by file index to maintain order
    batchResults.sort((a, b) => a.fileIndex - b.fileIndex);
    batchResults.forEach(result => {
      fileMappings[result.fileIndex] = result.mapping;
    });
  }

  return { deduplicated, fileMappings };
}

/**
 * Reconstruct file from deduplicated blocks
 */
export function reconstructFromBlocks(
  deduplicated: Uint8Array[],
  mapping: number[]
): Uint8Array {
  // Validate inputs
  if (!deduplicated || deduplicated.length === 0) {
    throw new Error('Deduplicated blocks array is empty');
  }
  
  if (!mapping || mapping.length === 0) {
    throw new Error('Mapping array is empty');
  }
  
  // Validate mapping indices are within bounds
  for (let i = 0; i < mapping.length; i++) {
    const index = mapping[i];
    if (typeof index !== 'number' || index < 0 || index >= deduplicated.length) {
      throw new Error(`Invalid mapping index at position ${i}: ${index} (valid range: 0-${deduplicated.length - 1})`);
    }
  }
  
  // Validate all blocks exist
  for (let i = 0; i < deduplicated.length; i++) {
    if (!deduplicated[i] || deduplicated[i].length === 0) {
      throw new Error(`Invalid block at index ${i}: block is empty or null`);
    }
  }

  const blocks = mapping.map(index => deduplicated[index]);
  const totalLength = blocks.reduce((sum, block) => sum + block.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const block of blocks) {
    result.set(block, offset);
    offset += block.length;
  }

  return result;
}

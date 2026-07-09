/**
 * MODULE: Ghost Stream Packer
 *
 * Verantwoordelijkheid:
 *  - Streaming compressie van bestanden
 *  - Encryptie pipeline orchestration
 *  - Chunk creatie en serialisatie
 *
 * Gebruikt door:
 *  - apps/web/src/ui/EncryptPanel
 *  - apps/web/src/ui/TrustedTransfer
 *
 * Afhankelijk van:
 *  - core/crypto/compression/zstd.ts
 *  - core/crypto/encryption/xchacha20.ts
 *  - core/stream/adaptive-chunk.ts
 *  - core/stream/file-system-access.ts
 *  - core/format/ghost.ts
 *  - core/crypto/kdf/argon2id.ts
 *  - core/crypto/compression/multi-format.ts
 *  - core/crypto/deduplication.ts
 *  - core/security/memory-wipe.ts
 *  - core/errors.ts
 *
 * @module core/format/packer
 */

import { compressZstd, compressParallel, validateZstdLevel } from '../crypto/compression/zstd.js';
import { compressMultiFormat, type CompressionFormat } from '../crypto/compression/multi-format.js';
import { deduplicateBlocks } from '../crypto/deduplication.js';
import { encryptXChaCha20, encryptChunksParallel } from '../crypto/encryption/xchacha20.js';
import { wipeBuffers, AutoDeleteTimer } from '../security/memory-wipe.js';
import { getAdaptiveChunkConfig, getWorkerCount } from '../stream/adaptive-chunk.js';
import { openFileForWriting, writeStreamToDisk } from '../stream/file-system-access.js';
import { encodeChunk, GHOST_MAGIC, GHOST_MAGIC_END, GHOST_VERSION, SALT_BYTES } from './ghost.js';
import { generateSalt, deriveKeyArgon2id, deriveSubKeys } from '../crypto/kdf/argon2id.js';
import type { ChunkInfo } from '../types/index.js';
import { EncryptionError, ValidationError, OperationCancelledError } from '../errors.js';

/**
 * Format file size for human-readable output
 * Optimized: Direct calculation without intermediate arrays
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export interface PackOptions {
  password: string;
  compressionLevel: number;
  forceAllFiles?: boolean;
  fileName?: string;
  chunkSize?: number;
  enableChecksum?: boolean;
  compressionFormat?: CompressionFormat;
  enableDeduplication?: boolean;
  enableStreamingDecrypt?: boolean;
  enableMemoryWipe?: boolean;
  autoDeleteAfter?: number;
  enableGhostTrusted?: boolean;
  ghostTrustedPasswords?: string[];
  noPasswordMode?: boolean;
  enableDoubleEncryption?: boolean;
  secondPassword?: string;
  emitGhostKey?: boolean;
  cancellationToken?: AbortSignal;
}

export interface PackProgress {
  phase: 'compressing' | 'encrypting' | 'chunking' | 'writing';
  percent: number;
  message?: string;
}

export type PackProgressCallback = (progress: PackProgress) => void;

/**
 * Pack bestand naar .ghost format v5 met streaming
 */
export async function packToGhostV5(
  file: File,
  options: PackOptions,
  onProgress?: PackProgressCallback
): Promise<void> {
  const report = (phase: PackProgress['phase'], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  // Check for cancellation
  if (options.cancellationToken?.aborted) {
    throw new OperationCancelledError();
  }

  // Validate password
  if (!options.noPasswordMode && (!options.password || options.password.length < 6)) {
    throw new ValidationError('Wachtwoord moet minimaal 6 tekens zijn');
  }

  if (options.enableDoubleEncryption && (!options.secondPassword || options.secondPassword.length < 6)) {
    throw new ValidationError('Tweede wachtwoord moet minimaal 6 tekens zijn bij dubbele encryptie');
  }

  // Validate file
  if (!file || file.size === 0) {
    throw new ValidationError('Ongeldig bestand: bestand is leeg of niet geselecteerd');
  }

  // Validate file size (max 10TB)
  const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024 * 1024; // 10TB
  if (file.size > MAX_FILE_SIZE) {
    throw new ValidationError(`Bestand is te groot (${formatFileSize(file.size)} > 10TB)`);
  }

  // Check available memory for extreme files
  const estimatedMemory = file.size * 3; // Estimate 3x memory needed for compression + encryption
  const availableMemory = (navigator as any).deviceMemory ? (navigator as any).deviceMemory * 1024 * 1024 * 1024 : 8 * 1024 * 1024 * 1024; // Default 8GB

  if (estimatedMemory > availableMemory * 0.8) {
    // Use streaming mode for large files
    console.warn(`Large file detected (${formatFileSize(file.size)}), using streaming mode to avoid memory issues`);
  }

  // Get adaptive chunk configuration
  const chunkConfig = await getAdaptiveChunkConfig();
  const workerCount = getWorkerCount();

  report('compressing', 0, 'Compresseren...');

  // Read file as stream with chunking for large files
  const fileStream = file.stream();
  const compressedChunks: Uint8Array[] = [];
  const reader = fileStream.getReader();
  let totalBytes = 0;
  let readBytes = 0;
  const CHUNK_READ_SIZE = 1024 * 1024; // 1MB chunks for reading

  // Adaptive chunking based on file size
  const useStreamingMode = file.size > 1024 * 1024 * 1024; // > 1GB use streaming

  try {
    if (useStreamingMode) {
      // Streaming mode for large files - process in chunks to avoid memory issues
      // Optimized: Pre-allocate buffer with reasonable size to reduce reallocations
      const BUFFER_GROWTH_FACTOR = 1.5;
      let buffer = new Uint8Array(CHUNK_READ_SIZE);
      let bufferSize = 0;
      let bufferCapacity = CHUNK_READ_SIZE;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check for cancellation
        if (options.cancellationToken?.aborted) {
          throw new OperationCancelledError();
        }

        // Grow buffer if needed with exponential growth
        if (bufferSize + value.length > bufferCapacity) {
          const newCapacity = Math.max(bufferCapacity * BUFFER_GROWTH_FACTOR, bufferSize + value.length);
          const newBuffer = new Uint8Array(newCapacity);
          newBuffer.set(buffer.subarray(0, bufferSize), 0);
          buffer = newBuffer;
          bufferCapacity = newCapacity;
        }
        buffer.set(value, bufferSize);
        bufferSize += value.length;

        // Process in chunks when buffer is large enough
        if (bufferSize >= CHUNK_READ_SIZE) {
          const chunk = buffer.subarray(0, bufferSize);
          compressedChunks.push(chunk);
          buffer = new Uint8Array(CHUNK_READ_SIZE);
          bufferCapacity = CHUNK_READ_SIZE;
          bufferSize = 0;
        }

        totalBytes += value.length;
        readBytes += value.length;

        // Report progress periodically
        if (readBytes % (10 * 1024 * 1024) === 0) { // Every 10MB
          report('compressing', Math.min(25, (readBytes / totalBytes) * 25), `Lezen: ${formatFileSize(readBytes)} / ${formatFileSize(totalBytes)}`);
        }
      }

      // Add remaining buffer
      if (bufferSize > 0) {
        const chunk = buffer.subarray(0, bufferSize);
        compressedChunks.push(chunk);
      }
    } else {
      // Normal mode for smaller files
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check for cancellation
        if (options.cancellationToken?.aborted) {
          throw new OperationCancelledError();
        }

        totalBytes += value.length;
        compressedChunks.push(value);

        // Report progress during reading
        readBytes += value.length;
        if (totalBytes > 0) {
          report('compressing', Math.min(25, (readBytes / totalBytes) * 25), `Lezen: ${formatFileSize(readBytes)} / ${formatFileSize(totalBytes)}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Compress in parallel with adaptive level selection
  report('compressing', 30, 'Compresseren...');

  // Limit concurrent compression for extreme file counts to avoid memory issues
  const MAX_CONCURRENT_COMPRESSION = 100;
  const chunksToCompress = compressedChunks.length > MAX_CONCURRENT_COMPRESSION
    ? compressedChunks.slice(0, MAX_CONCURRENT_COMPRESSION)
    : compressedChunks;

  const compressed = await compressParallel(
    chunksToCompress,
    validateZstdLevel(options.compressionLevel),
    workerCount,
    true // use adaptive compression
  );

  // Calculate compression ratio
  // Optimized: Direct calculation without intermediate array
  let originalSize = 0;
  let compressedSize = 0;
  for (let i = 0; i < compressedChunks.length; i++) {
    originalSize += compressedChunks[i]!.length;
  }
  for (let i = 0; i < compressed.length; i++) {
    compressedSize += compressed[i]!.length;
  }
  const ratio = originalSize > 0 ? ((originalSize - compressedSize) / originalSize * 100).toFixed(1) : '0.0';
  report('compressing', 50, `Gecomprimeerd: ${ratio}% besparing`);

  report('encrypting', 50, 'Encrypteren...');

  // Generate keys
  const salt = generateSalt();
  const keyResult = await deriveKeyArgon2id(options.password, salt);
  const subKeys = await deriveSubKeys(keyResult.hash, ['encryption', 'manifest']);

  // Encrypt chunks in parallel with AAD metadata
  // Limit concurrent encryption for extreme file counts
  const MAX_CONCURRENT_ENCRYPTION = 1000;
  const chunksToEncrypt = compressed.length > MAX_CONCURRENT_ENCRYPTION
    ? compressed.slice(0, MAX_CONCURRENT_ENCRYPTION)
    : compressed;

  let encryptionResults = await encryptChunksParallel(
    subKeys[0],
    chunksToEncrypt,
    'GhostVault/v5/chunk',
    options.fileName,
    Date.now()
  );

  // Double encryption if enabled
  if (options.enableDoubleEncryption && options.secondPassword) {
    report('encrypting', 60, 'Dubbele encryptie toepassen...');
    const secondSalt = generateSalt();
    const secondKeyResult = await deriveKeyArgon2id(options.secondPassword, secondSalt);
    const secondSubKeys = await deriveSubKeys(secondKeyResult.hash, ['encryption']);
    
    const doubleEncrypted = await encryptChunksParallel(
      secondSubKeys[0],
      encryptionResults.map(result => result.ciphertext),
      'GhostVault/v5/double',
      options.fileName,
      Date.now()
    );
    
    // Store second salt in header for decryption
    // Merge results: use nonces from second encryption, ciphertext from second
    encryptionResults = doubleEncrypted.map((result, i) => ({
      ciphertext: result.ciphertext,
      nonce: result.nonce  // Use nonce from second encryption
    }));

    // Store second salt in the header instead of chunk data (better approach)
    // For now, we'll prepend it to the first encrypted chunk for backward compatibility
    // Future: Store in header field to avoid chunk modification issues
    if (encryptionResults.length > 0) {
      const saltMarker = new Uint8Array(1 + 32); // 1 byte marker + 32 bytes salt
      saltMarker[0] = 0xFF; // Marker for double encryption
      saltMarker.set(secondSalt, 1);

      const firstChunk = encryptionResults[0].ciphertext;
      const combinedChunk = new Uint8Array(saltMarker.length + firstChunk.length);
      combinedChunk.set(saltMarker, 0);
      combinedChunk.set(firstChunk, saltMarker.length);
      encryptionResults[0] = { ciphertext: combinedChunk, nonce: encryptionResults[0].nonce };
    }
  }

  // Extract ciphertext from encryption results
  const encryptedChunks = encryptionResults.map(result => result.ciphertext);

  // Generate .ghostkey if enabled
  if (options.emitGhostKey) {
    const keyData = subKeys[0]; // Use encryption key
    try {
      const keyHandle = await openFileForWriting(options.fileName?.replace('.ghost', '') + '.ghostkey');
      await keyHandle.writable.write(keyData as BufferSource);
      await keyHandle.close();
    } catch (error) {
      console.error('Error writing .ghostkey file:', error);
      // Continue without ghostkey - don't fail the entire operation
    }
  }

  report('chunking', 75, 'Chunks maken...');

  // Create chunk manifest with memory-efficient approach for extreme file counts
  const chunkManifest: ChunkInfo[] = [];
  let offset = 0;

  // Limit manifest size for extreme file counts
  const MAX_MANIFEST_SIZE = 10000;
  const chunksToManifest = encryptedChunks.length > MAX_MANIFEST_SIZE
    ? encryptedChunks.slice(0, MAX_MANIFEST_SIZE)
    : encryptedChunks;

  for (let i = 0; i < chunksToManifest.length; i++) {
    const chunk = encryptedChunks[i];
    // Use subarray instead of copy to reduce memory allocation
    const chunkCopy = chunk.subarray(0);
    const sha256 = await crypto.subtle.digest('SHA-256', chunkCopy.buffer as ArrayBuffer);

    chunkManifest.push({
      id: i,
      offset,
      compressedSize: chunk.length,
      originalSize: compressedChunks[i].length,
      sha256: new TextDecoder().decode(sha256),
    });

    offset += chunk.length;

    // Free memory after each chunk
    chunkCopy.fill(0);
  }

  // If we have more chunks than manifest size, use simplified manifest
  if (encryptedChunks.length > MAX_MANIFEST_SIZE) {
    console.warn(`Extreme file count (${encryptedChunks.length}), using simplified manifest`);
    chunkManifest.push({
      id: -1, // Special marker for simplified manifest
      offset: offset,
      compressedSize: encryptedChunks.reduce((sum, chunk) => sum + chunk.length, 0),
      originalSize: compressedChunks.reduce((sum, chunk) => sum + chunk.length, 0),
      sha256: 'simplified',
    });
  }

  report('writing', 90, 'Schrijven naar schijf...');

  // Generate .ghosttrusted files if enabled
  if (options.enableGhostTrusted && options.ghostTrustedPasswords && options.ghostTrustedPasswords.length > 0) {
    for (let i = 0; i < options.ghostTrustedPasswords.length; i++) {
      try {
        const trustedData = new TextEncoder().encode(options.ghostTrustedPasswords[i]);
        const suffix = options.ghostTrustedPasswords.length > 1 ? `_${i + 1}` : '';
        const trustedHandle = await openFileForWriting(options.fileName?.replace('.ghost', '') + `.ghosttrusted${suffix}`);
        await trustedHandle.writable.write(trustedData as BufferSource);
        await trustedHandle.close();
      } catch (error) {
        console.error(`Error writing .ghosttrusted file ${i}:`, error);
        // Continue with other files - don't fail the entire operation
      }
    }
  }

  // Open file for writing
  const handle = await openFileForWriting(options.fileName || file.name + '.ghost');

  try {
    // Write header
    const header = new Uint8Array(5 + 1 + SALT_BYTES + 4);
    header.set(GHOST_MAGIC, 0);
    header[5] = GHOST_VERSION;
    header.set(salt, 6);
    new DataView(header.buffer, header.byteOffset, header.byteLength)
      .setUint32(6 + SALT_BYTES, 0, false); // opaqueLength = 0 for v5

    await handle.writable.write(header);

    // Write chunks
    for (let i = 0; i < encryptedChunks.length; i++) {
      const chunk = encryptedChunks[i];
      const nonce = encryptionResults[i].nonce;
      // Use subarray instead of copy to reduce memory allocation
      const chunkCopy = chunk.subarray(0);
      const chunkData = encodeChunk({
        chunkId: BigInt(i),
        nonce: nonce,
        ciphertext: chunk,
        sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', chunkCopy.buffer as ArrayBuffer)),
      });

      await handle.writable.write(chunkData as BufferSource);

      // Free memory after each chunk
      chunkCopy.fill(0);
    }

    // Write footer
    const footer = new Uint8Array(GHOST_MAGIC_END.length + 8 + 8 + 32);
    footer.set(GHOST_MAGIC_END, 0);
    new DataView(footer.buffer, footer.byteOffset, footer.byteLength)
      .setBigUint64(GHOST_MAGIC_END.length, BigInt(encryptedChunks.length), false);
    new DataView(footer.buffer, footer.byteOffset, footer.byteLength)
      .setBigUint64(GHOST_MAGIC_END.length + 8, BigInt(totalBytes), false);

    const footerPrefix = footer.subarray(0, GHOST_MAGIC_END.length + 16);
    const fileHash = await crypto.subtle.digest('SHA-256', footerPrefix.buffer.slice(footerPrefix.byteOffset, footerPrefix.byteOffset + footerPrefix.byteLength));
    footer.set(new Uint8Array(fileHash), GHOST_MAGIC_END.length + 16);

    await handle.writable.write(footer);

    report('writing', 100, 'Klaar');
  } finally {
    await handle.close();
  }
}

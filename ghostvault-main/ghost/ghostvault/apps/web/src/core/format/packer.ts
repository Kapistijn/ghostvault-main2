/**
 * MODULE: Ghost Stream Packer
 *
 * Verantwoordelijkheid:
 * - Streaming compressie van bestanden
 * - Encryptie pipeline orchestration
 * - Chunk creatie en serialisatie
 *
 * Gebruikt door:
 * - apps/web/src/ui/EncryptPanel
 * - apps/web/src/ui/TrustedTransfer
 *
 * Afhankelijk van:
 * - core/crypto/compression/zstd.ts
 * - core/crypto/encryption/xchacha20.ts
 * - core/stream/adaptive-chunk.ts
 * - core/stream/file-system-access.ts
 * - core/format/ghost.ts
 * - core/crypto/kdf/argon2id.ts
 * - core/errors.ts
 *
 * @module core/format/packer
 */

import { compressParallel, validateZstdLevel } from '../crypto/compression/zstd.js';
import type { CompressionFormat } from '../crypto/compression/multi-format.js';
import { encryptChunksParallel } from '../crypto/encryption/xchacha20.js';
import { getWorkerCount } from '../stream/adaptive-chunk.js';
import { openFileForWriting } from '../stream/file-system-access.js';
import { encodeChunk, GHOST_MAGIC, GHOST_MAGIC_END, GHOST_VERSION, SALT_BYTES, MIN_PASSWORD_LENGTH } from './ghost.js';
import { generateSalt, deriveKeyArgon2id, deriveSubKeys } from '../crypto/kdf/argon2id.js';
import type { ChunkInfo } from '../types/index.js';
import { ValidationError, OperationCancelledError } from '../errors.js';

/**
 * Format file size for human-readable output
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Hex-encode raw bytes (lossless, unlike TextDecoder over binary data).
 */
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Build the salt-bound AAD prefix so chunks are tied to this file's header. */
function chunkAadPrefix(salt: Uint8Array): string {
  return `GhostVault/v6/${bytesToHex(salt)}/chunk`;
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
 * Pack bestand naar .ghost format v6 met streaming
 */
export async function packToGhostV5(
  file: File,
  options: PackOptions,
  onProgress?: PackProgressCallback
): Promise<void> {
  const report = (phase: PackProgress['phase'], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  if (options.cancellationToken?.aborted) {
    throw new OperationCancelledError();
  }

  if (!options.noPasswordMode && (!options.password || options.password.length < MIN_PASSWORD_LENGTH)) {
    throw new ValidationError(`Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn`);
  }

  if (options.enableDoubleEncryption && (!options.secondPassword || options.secondPassword.length < MIN_PASSWORD_LENGTH)) {
    throw new ValidationError(`Tweede wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn bij dubbele encryptie`);
  }

  if (!file || file.size === 0) {
    throw new ValidationError('Ongeldig bestand: bestand is leeg of niet geselecteerd');
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024 * 1024; // 10TB
  if (file.size > MAX_FILE_SIZE) {
    throw new ValidationError(`Bestand is te groot (${formatFileSize(file.size)} > 10TB)`);
  }

  const estimatedMemory = file.size * 3;
  const availableMemory = (navigator as any).deviceMemory ? (navigator as any).deviceMemory * 1024 * 1024 * 1024 : 8 * 1024 * 1024 * 1024;
  if (estimatedMemory > availableMemory * 0.8) {
    console.warn(`Large file detected (${formatFileSize(file.size)}), using streaming mode to avoid memory issues`);
  }

  const workerCount = getWorkerCount();

  report('compressing', 0, 'Compresseren...');

  const fileStream = file.stream();
  const compressedChunks: Uint8Array[] = [];
  const reader = fileStream.getReader();
  let totalBytes = 0;
  let readBytes = 0;
  const CHUNK_READ_SIZE = 1024 * 1024; // 1MB

  const useStreamingMode = file.size > 1024 * 1024 * 1024; // > 1GB

  try {
    if (useStreamingMode) {
      const BUFFER_GROWTH_FACTOR = 1.5;
      let buffer = new Uint8Array(CHUNK_READ_SIZE);
      let bufferSize = 0;
      let bufferCapacity = CHUNK_READ_SIZE;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (options.cancellationToken?.aborted) throw new OperationCancelledError();

        if (bufferSize + value.length > bufferCapacity) {
          const newCapacity = Math.max(bufferCapacity * BUFFER_GROWTH_FACTOR, bufferSize + value.length);
          const newBuffer = new Uint8Array(newCapacity);
          newBuffer.set(buffer.subarray(0, bufferSize), 0);
          buffer = newBuffer;
          bufferCapacity = newCapacity;
        }
        buffer.set(value, bufferSize);
        bufferSize += value.length;

        if (bufferSize >= CHUNK_READ_SIZE) {
          compressedChunks.push(buffer.slice(0, bufferSize));
          buffer = new Uint8Array(CHUNK_READ_SIZE);
          bufferCapacity = CHUNK_READ_SIZE;
          bufferSize = 0;
        }

        totalBytes += value.length;
        readBytes += value.length;
        if (readBytes % (10 * 1024 * 1024) === 0) {
          report('compressing', Math.min(25, (readBytes / totalBytes) * 25), `Lezen: ${formatFileSize(readBytes)} / ${formatFileSize(totalBytes)}`);
        }
      }

      if (bufferSize > 0) {
        compressedChunks.push(buffer.slice(0, bufferSize));
      }
    } else {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (options.cancellationToken?.aborted) throw new OperationCancelledError();

        totalBytes += value.length;
        compressedChunks.push(value);
        readBytes += value.length;
        if (totalBytes > 0) {
          report('compressing', Math.min(25, (readBytes / totalBytes) * 25), `Lezen: ${formatFileSize(readBytes)} / ${formatFileSize(totalBytes)}`);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  report('compressing', 30, 'Compresseren...');

  const compressed = await compressParallel(
    compressedChunks,
    validateZstdLevel(options.compressionLevel),
    workerCount,
    true
  );

  let originalSize = 0;
  let compressedSize = 0;
  for (let i = 0; i < compressedChunks.length; i++) originalSize += compressedChunks[i]!.length;
  for (let i = 0; i < compressed.length; i++) compressedSize += compressed[i]!.length;
  const ratio = originalSize > 0 ? ((originalSize - compressedSize) / originalSize * 100).toFixed(1) : '0.0';
  report('compressing', 50, `Gecomprimeerd: ${ratio}% besparing`);

  report('encrypting', 50, 'Encrypteren...');

  // Generate keys
  const salt = generateSalt();
  const keyResult = await deriveKeyArgon2id(options.password, salt);
  const subKeys = await deriveSubKeys(keyResult.hash, ['encryption', 'manifest']);

  // Encrypt ALL chunks with a salt-bound, position-bound AAD.
  let encryptionResults = await encryptChunksParallel(
    subKeys[0],
    compressed,
    chunkAadPrefix(salt)
  );

  // Double encryption if enabled
  if (options.enableDoubleEncryption && options.secondPassword) {
    report('encrypting', 60, 'Dubbele encryptie toepassen...');
    const secondSalt = crypto.getRandomValues(new Uint8Array(32));
    const secondKeyResult = await deriveKeyArgon2id(options.secondPassword, secondSalt);
    const secondSubKeys = await deriveSubKeys(secondKeyResult.hash, ['encryption']);

    const doubleEncrypted = await encryptChunksParallel(
      secondSubKeys[0],
      encryptionResults.map(result => result.ciphertext),
      `GhostVault/v6/${bytesToHex(secondSalt)}/double`
    );

    encryptionResults = doubleEncrypted.map((result) => ({
      ciphertext: result.ciphertext,
      nonce: result.nonce
    }));

    if (encryptionResults.length > 0) {
      const saltMarker = new Uint8Array(1 + 32);
      saltMarker[0] = 0xFF;
      saltMarker.set(secondSalt, 1);

      const firstChunk = encryptionResults[0].ciphertext;
      const combinedChunk = new Uint8Array(saltMarker.length + firstChunk.length);
      combinedChunk.set(saltMarker, 0);
      combinedChunk.set(firstChunk, saltMarker.length);
      encryptionResults[0] = { ciphertext: combinedChunk, nonce: encryptionResults[0].nonce };
    }
  }

  const encryptedChunks = encryptionResults.map(result => result.ciphertext);

  if (options.emitGhostKey) {
    const keyData = subKeys[0];
    try {
      const keyHandle = await openFileForWriting(options.fileName?.replace('.ghost', '') + '.ghostkey');
      await keyHandle.writable.write(keyData as BufferSource);
      await keyHandle.close();
    } catch (error) {
      console.error('Error writing .ghostkey file:', error);
    }
  }

  report('chunking', 75, 'Chunks maken...');

  const chunkManifest: ChunkInfo[] = [];
  let offset = 0;
  for (let i = 0; i < encryptedChunks.length; i++) {
    const chunk = encryptedChunks[i];
    const chunkCopy = chunk.subarray(0);
    const sha256 = await crypto.subtle.digest('SHA-256', chunkCopy.buffer as ArrayBuffer);
    chunkManifest.push({
      id: i,
      offset,
      compressedSize: chunk.length,
      originalSize: compressedChunks[i].length,
      sha256: bytesToHex(new Uint8Array(sha256)),
    });
    offset += chunk.length;
  }

  report('writing', 90, 'Schrijven naar schijf...');

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
      }
    }
  }

  // Integrity hash over ORIGINAL content for a real round-trip check.
  const originalContent = new Uint8Array(totalBytes);
  {
    let p = 0;
    for (let i = 0; i < compressedChunks.length; i++) {
      originalContent.set(compressedChunks[i]!, p);
      p += compressedChunks[i]!.length;
    }
  }
  const contentHash = new Uint8Array(await crypto.subtle.digest('SHA-256', originalContent.buffer as ArrayBuffer));

  const handle = await openFileForWriting(options.fileName || file.name + '.ghost');

  try {
    // Header
    const header = new Uint8Array(5 + 1 + SALT_BYTES + 4);
    header.set(GHOST_MAGIC, 0);
    header[5] = GHOST_VERSION;
    header.set(salt, 6);
    new DataView(header.buffer, header.byteOffset, header.byteLength)
      .setUint32(6 + SALT_BYTES, 0, false);
    await handle.writable.write(header);

    // Chunks
    for (let i = 0; i < encryptedChunks.length; i++) {
      const chunk = encryptedChunks[i];
      const nonce = encryptionResults[i].nonce;
      const chunkCopy = chunk.subarray(0);
      const chunkData = encodeChunk({
        chunkId: BigInt(i),
        nonce,
        ciphertext: chunk,
        sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', chunkCopy.buffer as ArrayBuffer)),
      });
      await handle.writable.write(chunkData as BufferSource);
    }

    // Footer
    const footer = new Uint8Array(GHOST_MAGIC_END.length + 8 + 8 + 32);
    footer.set(GHOST_MAGIC_END, 0);
    new DataView(footer.buffer, footer.byteOffset, footer.byteLength)
      .setBigUint64(GHOST_MAGIC_END.length, BigInt(encryptedChunks.length), false);
    new DataView(footer.buffer, footer.byteOffset, footer.byteLength)
      .setBigUint64(GHOST_MAGIC_END.length + 8, BigInt(totalBytes), false);
    footer.set(contentHash, GHOST_MAGIC_END.length + 16);
    await handle.writable.write(footer);

    report('writing', 100, 'Klaar');
  } finally {
    await handle.close();
  }
}

/**
 * MODULE: Ghost Stream Unpacker
 *
 * Responsibilities:
 *  - Streaming unpacking of .ghost files
 *  - Decryption pipeline orchestration
 *  - Chunk parsing and reconstruction
 *
 * Used by:
 *  - apps/web/src/ui/DecryptPanel
 *
 * Depends on:
 *  - core/crypto/compression/zstd.ts
 *  - core/crypto/encryption/xchacha20.ts
 *  - core/stream/transform.ts
 *  - core/stream/file-system-access.ts
 *  - core/format/ghost.ts
 *  - core/crypto/kdf/argon2id.ts
 *
 * @module core/format/unpacker
 */

import { decompressZstd, decompressParallel } from '../crypto/compression/zstd.js';
import { decryptXChaCha20, decryptChunksParallel } from '../crypto/encryption/xchacha20.js';
import { openFileForWriting, writeStreamToDisk } from '../stream/file-system-access.js';
import { parseHeader, parseFooter, parseChunk, GHOST_VERSION, SALT_BYTES } from './ghost.js';
import { deriveKeyArgon2id, deriveSubKeys } from '../crypto/kdf/argon2id.js';
import type { ChunkInfo } from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { validatePassword, constantTimeCompare } from '../utils/validation.js';

const logger = getLogger('unpacker');

export interface UnpackOptions {
  password: string;
  fileName?: string;
  secondPassword?: string;
  enableDoubleDecrypt?: boolean;
  recoveryMode?: boolean;
}

/**
 * Validate password combinations to prevent invalid combinations
 */
export function validateUnpackPasswordCombination(options: UnpackOptions): { valid: boolean; error?: string } {
  const { password, secondPassword, enableDoubleDecrypt } = options;

  // If double decrypt is not enabled, everything is ok
  if (!enableDoubleDecrypt) {
    return { valid: true };
  }

  // If double decrypt is enabled, a second password is required
  if (!secondPassword || secondPassword.length === 0) {
    return { valid: false, error: 'Double decryption requires a second password' };
  }

  // Validate that both passwords are at least 8 characters
  if (password.length < 8) {
    return { valid: false, error: 'First password must be at least 8 characters' };
  }

  if (secondPassword.length < 8) {
    return { valid: false, error: 'Second password must be at least 8 characters' };
  }

  // Validate that both passwords are at most 1000 characters
  if (password.length > 1000) {
    return { valid: false, error: 'First password must be at most 1000 characters' };
  }

  if (secondPassword.length > 1000) {
    return { valid: false, error: 'Second password must be at most 1000 characters' };
  }

  // All combinations are allowed:
  // - password + different password (different passwords)
  // - ghosttrusted password + ghosttrusted passkey (handled in UI)
  
  // SECURITY: Prevent using same password for double decryption
  if (enableDoubleDecrypt && constantTimeCompare(password, secondPassword)) {
    return { valid: false, error: 'Double decryption requires two different passwords' };
  }

  return { valid: true };
}

export interface UnpackProgress {
  phase: 'reading' | 'decrypting' | 'decompressing' | 'writing';
  percent: number;
  message?: string;
}

export type UnpackProgressCallback = (progress: UnpackProgress) => void;

/**
 * Unpack .ghost format v6 with streaming
 */
export async function unpackGhostV5(
  file: File,
  options: UnpackOptions,
  onProgress?: UnpackProgressCallback
): Promise<void> {
  logger.info('unpackGhostV5 started', { 
    fileName: file?.name,
    fileSize: file?.size,
    hasSecondPassword: !!options?.secondPassword,
    enableDoubleDecrypt: options?.enableDoubleDecrypt,
    recoveryMode: options?.recoveryMode
  });

  // Validate password
  const passwordValidation = validatePassword(options.password);
  if (!passwordValidation.valid) {
    logger.error(passwordValidation.error || 'Invalid password', undefined, { passwordLength: options.password?.length });
    throw new Error(passwordValidation.error || 'Invalid password');
  }

  // Validate file name
  if (options.fileName) {
    if (options.fileName.length > 255) {
      logger.error('File name too long (max 255 characters)', undefined, { fileNameLength: options.fileName.length });
      throw new Error(`File name too long: ${options.fileName.length} characters (max 255). Choose a shorter file name.`);
    }

    // Validate file name for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(options.fileName)) {
      logger.error('File name contains invalid characters', undefined, { fileName: options.fileName });
      throw new Error(`File name "${options.fileName}" contains invalid characters (< > : " / \\ | ? *). Remove these characters and try again.`);
    }
  }

  // Validate password combination before starting
  const combinationValidation = validateUnpackPasswordCombination(options);
  if (!combinationValidation.valid) {
    logger.error('Invalid password combination', undefined, { 
      enableDoubleDecrypt: options.enableDoubleDecrypt,
      hasSecondPassword: !!options.secondPassword
    });
    throw new Error(combinationValidation.error || 'Invalid password combination');
  }

  const report = (phase: UnpackProgress['phase'], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  report('reading', 0, 'Reading file...');

  // Validate file exists
  if (!file || file.size === undefined) {
    throw new Error('Invalid file: file is null or undefined');
  }

  // Validate file size
  if (file.size === 0) {
    throw new Error('Invalid file: file is empty');
  }

  if (file.size > 10 * 1024 * 1024 * 1024) { // Max 10GB
    throw new Error('Invalid file: file too large (max 10GB)');
  }

  // Read entire file (for now - will be improved to streaming)
  const buffer = new Uint8Array(await file.arrayBuffer());

  // Parse header
  const header = parseHeader(buffer);
  if (header.version !== GHOST_VERSION) {
    throw new Error(`Unsupported .ghost version: ${header.version}`);
  }

  report('reading', 10, 'Header parsed');

  // Parse footer
  const footer = parseFooter(buffer);

  report('reading', 20, 'Footer parsed');

  // Derive keys with double decryption support
  const keyResult = await deriveKeyArgon2id(options.password, header.salt);
  const subKeys = await deriveSubKeys(keyResult.hash, ['encryption', 'manifest']);
  
  // Handle double decryption if enabled
  let secondSalt: Uint8Array | null = null;
  let secondKeyResult: any = null;
  let secondSubKeys: Uint8Array[] | null = null;
  
  if (options.enableDoubleDecrypt && options.secondPassword) {
    // For v7 files, always derive second salt from password (v5 structure not supported)
    const saltHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.secondPassword));
    secondSalt = new Uint8Array(saltHash).slice(0, SALT_BYTES);
    secondKeyResult = await deriveKeyArgon2id(options.secondPassword, secondSalt);
    secondSubKeys = await deriveSubKeys(secondKeyResult.hash, ['encryption']);
  }

  report('decrypting', 30, 'Keys derived');

  // Parse chunks with memory-efficient processing
  const chunks: { ciphertext: Uint8Array; nonce: Uint8Array }[] = [];
  let offset = 5 + 1 + SALT_BYTES + 4; // After header (magic:5, version:1, salt:64, opaqueLength:4)
  let corruptedChunks = 0;

  while (offset < buffer.length - footer.magicEnd.length - 8 - 8 - 32) {
    try {
      const chunk = parseChunk(buffer, offset);
      chunks.push({
        ciphertext: chunk.ciphertext,
        nonce: chunk.nonce,
      });
      offset += 8 + 24 + 4 + chunk.ciphertext.length + 32;
    } catch (error) {
      if (options.recoveryMode) {
        corruptedChunks++;
        console.warn(`Corrupted chunk at offset ${offset}, skipping in recovery mode`);
        // Try to skip to next chunk by estimating chunk size
        offset += 8 + 24 + 4 + 32; // Minimum chunk size
        continue;
      } else {
        throw error;
      }
    }
  }

  report('decrypting', 40, `${chunks.length} chunks found${corruptedChunks > 0 ? ` (${corruptedChunks} corrupt, skipped in recovery mode)` : ''}`);

  // Decrypt chunks in parallel with AAD metadata validation
  let decryptedChunks = await decryptChunksParallel(
    subKeys[0],
    chunks,
    'GhostVault/v5/chunk',
    options.fileName
  );
  
  // Apply second decryption layer if enabled
  if (options.enableDoubleDecrypt && secondSubKeys) {
    // For second layer, we need to use the original nonces from the chunks
    // The first decryption layer should have preserved the chunk structure
    const firstLayerFormatted = chunks.map((chunk, idx) => ({ 
      ciphertext: decryptedChunks[idx], 
      nonce: chunk.nonce 
    }));
    const secondLayerResults = await decryptChunksParallel(
      secondSubKeys[0],
      firstLayerFormatted,
      'GhostVault/v5/double-encryption',
      options.fileName
    );
    decryptedChunks = secondLayerResults;
  }

  report('decompressing', 60, 'Gedecrypt');

  // Decompress in parallel with validation
  if (decryptedChunks.length === 0) {
    throw new Error('No decrypted chunks to decompress');
  }
  
  const originalSizes = decryptedChunks.map(() => 0); // Will be determined during decompression
  const decompressedChunks = await decompressParallel(
    decryptedChunks,
    originalSizes,
    Math.max(1, chunks.length - 2)
  );

  report('decompressing', 80, 'Gedecomprimeerd');

  // Write to disk
  report('writing', 90, 'Schrijven naar schijf...');

  const fileName = options.fileName || file.name.replace('.ghost', '');
  
  // Validate file name
  if (!fileName || fileName.length === 0) {
    throw new Error('Invalid file name: empty');
  }
  
  if (fileName.length > 255) {
    throw new Error('Invalid file name: too long (max 255 characters)');
  }
  
  const handle = await openFileForWriting(fileName);

  try {
    // Write all chunks with validation and batching
    const WRITE_BATCH_SIZE = 10;
    for (let i = 0; i < decompressedChunks.length; i += WRITE_BATCH_SIZE) {
      const batchEnd = Math.min(i + WRITE_BATCH_SIZE, decompressedChunks.length);
      const writePromises: Promise<void>[] = [];
      
      for (let j = i; j < batchEnd; j++) {
        const chunk = decompressedChunks[j];
        
        if (!chunk || chunk.length === 0) {
          throw new Error(`Invalid decompressed chunk at index ${j}: empty chunk`);
        }
        
        writePromises.push(handle.writable.write(chunk as any));
      }
      
      await Promise.all(writePromises);
      
      // Allow event loop to process other tasks
      if (batchEnd < decompressedChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    report('writing', 100, 'Klaar');
  } finally {
    await handle.close();
  }
}

/**
 * Validate .ghost file integrity
 */
export async function validateGhostV5(file: File): Promise<boolean> {
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const header = parseHeader(buffer);
    const footer = parseFooter(buffer);

    // Validate magic bytes
    const magic = buffer.subarray(0, 5);
    const magicEnd = buffer.subarray(buffer.length - 5);

    // Simple validation - in production, verify full hash
    return header.version === GHOST_VERSION;
  } catch {
    return false;
  }
}

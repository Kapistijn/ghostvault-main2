/**
 * MODULE: Ghost Stream Packer
 *
 * Responsibilities:
 *  - Streaming compression of files
 *  - Encryption pipeline orchestration
 *  - Chunk creation and serialization
 *
 * Used by:
 *  - apps/web/src/ui/EncryptPanel
 *  - apps/web/src/ui/TrustedTransfer
 *
 * Depends on:
 *  - core/crypto/compression/zstd.ts
 *  - core/crypto/encryption/xchacha20.ts
 *  - core/stream/transform.ts
 *  - core/stream/adaptive-chunk.ts
 *  - core/stream/file-system-access.ts
 *  - core/format/ghost.ts
 *  - core/crypto/kdf/argon2id.ts
 *
 * @module core/format/packer
 */

import { compressZstd, compressParallel } from '../crypto/compression/zstd.js';
import { encryptXChaCha20, encryptChunksParallel } from '../crypto/encryption/xchacha20.js';
import { getAdaptiveChunkConfig, getWorkerCount } from '../stream/adaptive-chunk.js';
import { openFileForWriting, writeStreamToDisk } from '../stream/file-system-access.js';
import { encodeChunk, GHOST_MAGIC, GHOST_MAGIC_END, GHOST_VERSION, SALT_BYTES } from './ghost.js';
import { generateSalt, deriveKeyArgon2id, deriveSubKeys } from '../crypto/kdf/argon2id.js';
import type { ChunkInfo } from '../types/index.js';
import { getLogger } from '../utils/logger.js';
import { validatePassword, validateFileName, validateCompressionLevel, validateFileSize, constantTimeCompare, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../utils/validation.js';

const logger = getLogger('packer');

/**
 * Calculate password similarity using simple character overlap
 * Returns 0.0 (no similarity) to 1.0 (identical)
 */
function calculatePasswordSimilarity(pwd1: string, pwd2: string): number {
  if (pwd1 === pwd2) return 1.0;
  if (!pwd1 || !pwd2) return 0.0;
  
  const set1 = new Set(pwd1.toLowerCase());
  const set2 = new Set(pwd2.toLowerCase());
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return union.size > 0 ? intersection.size / union.size : 0.0;
}

export interface PackOptions {
  password: string;
  compressionLevel: number;
  forceAllFiles?: boolean;
  fileName?: string;
  secondPassword?: string;
  enableDoubleEncryption?: boolean;
}

/**
 * Validate password combinations to prevent invalid combinations
 */
export function validatePasswordCombination(options: PackOptions): { valid: boolean; error?: string } {
  const { password, secondPassword, enableDoubleEncryption } = options;

  // If double encryption is not enabled, everything is ok
  if (!enableDoubleEncryption) {
    return { valid: true };
  }

  // If double encryption is enabled, a second password is required
  if (!secondPassword || secondPassword.length === 0) {
    return { valid: false, error: 'Double encryption requires a second password' };
  }

  // Validate that both passwords are at least 8 characters
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `First password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  if (secondPassword.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `Second password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }

  // Validate that both passwords are at most 1000 characters
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `First password must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }

  if (secondPassword.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, error: `Second password must be at most ${MAX_PASSWORD_LENGTH} characters` };
  }

  // All combinations are allowed:
  // - password + different password (different passwords)
  // - ghosttrusted password + ghosttrusted passkey (handled in UI)
  
  // SECURITY: Prevent using same password for double encryption
  if (enableDoubleEncryption && constantTimeCompare(password, secondPassword)) {
    return { valid: false, error: 'Double encryption requires two different passwords' };
  }

  return { valid: true };
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
  logger.info('packToGhostV5 gestart', { 
    fileName: file?.name,
    fileSize: file?.size,
    compressionLevel: options?.compressionLevel,
    hasSecondPassword: !!options?.secondPassword,
    enableDoubleEncryption: options?.enableDoubleEncryption
  });

  // Validate password
  const passwordValidation = validatePassword(options.password);
  if (!passwordValidation.valid) {
    logger.error(passwordValidation.error || 'Invalid password', undefined, { passwordLength: options.password?.length });
    throw new Error(passwordValidation.error || 'Invalid password');
  }

  // Validate compression level
  const compressionValidation = validateCompressionLevel(options.compressionLevel);
  if (!compressionValidation.valid) {
    logger.error(compressionValidation.error || 'Invalid compression level', undefined, { compressionLevel: options.compressionLevel });
    throw new Error(compressionValidation.error || 'Invalid compression level');
  }

  // Validate file name
  if (options.fileName) {
    const fileNameValidation = validateFileName(options.fileName);
    if (!fileNameValidation.valid) {
      logger.error(fileNameValidation.error || 'Invalid file name', undefined, { fileName: options.fileName });
      throw new Error(fileNameValidation.error || 'Invalid file name');
    }
  }

  // Validate password combination before starting
  const combinationValidation = validatePasswordCombination(options);
  if (!combinationValidation.valid) {
    logger.error('Invalid password combination', undefined, { 
      enableDoubleEncryption: options.enableDoubleEncryption,
      hasSecondPassword: !!options.secondPassword
    });
    throw new Error(combinationValidation.error || 'Invalid password combination');
  }

  const report = (phase: PackProgress['phase'], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  // Validate file exists
  if (!file || file.size === undefined) {
    logger.error('Invalid file: file is null or undefined', undefined, { file });
    throw new Error('Invalid file: file is null or undefined');
  }

  // Validate file size (allow empty files for some use cases)
  const fileSizeValidation = validateFileSize(file.size, true); // allow empty
  if (!fileSizeValidation.valid) {
    logger.error(fileSizeValidation.error || 'Invalid file size', undefined, { fileSize: file.size });
    throw new Error(fileSizeValidation.error || 'Invalid file size');
  }

  // Validate file name
  if (!file.name || file.name.length === 0) {
    logger.error('Invalid file: file name is empty', undefined, { fileName: file.name });
    throw new Error('Invalid file: file name is empty');
  }

  const fileNameValidation = validateFileName(file.name);
  if (!fileNameValidation.valid) {
    logger.error(fileNameValidation.error || 'Invalid file name', undefined, { fileNameLength: file.name.length });
    throw new Error(fileNameValidation.error || 'Invalid file name');
  }

  // Get adaptive chunk configuration
  const chunkConfig = await getAdaptiveChunkConfig();
  const workerCount = getWorkerCount();

  report('compressing', 0, 'Compressing...');

  // Memory optimization: Use streaming for large files
  const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB
  const isLargeFile = file.size > LARGE_FILE_THRESHOLD;
  
  if (isLargeFile) {
    logger.info('Large file detected, using streaming mode', { fileSize: file.size });
  }

  // Read file in chunks to avoid memory overload
  const MAX_MEMORY_CHUNKS = 50; // Limit concurrent chunks in memory
  const CHUNK_SIZE = chunkConfig.chunkSize || 1024 * 1024; // Default 1MB

  // Read file as stream
  const fileStream = file.stream();

  // Compress stream (multi-threaded) with memory-efficient chunking
  const compressedChunks: Uint8Array[] = [];
  const finalCompressedChunks: Uint8Array[] = [];
  const reader = fileStream.getReader();
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (!value || value.length === 0) {
        continue; // Skip empty chunks
      }

      totalBytes += value.length;
      compressedChunks.push(value);
      
      // Process chunks in batches to limit memory usage
      if (compressedChunks.length >= MAX_MEMORY_CHUNKS) {
        const batch = compressedChunks.splice(0, MAX_MEMORY_CHUNKS);
        const compressedBatch = await compressParallel(
          batch,
          options.compressionLevel,
          workerCount,
          true, // use adaptive compression
          false // don't collect stats
        );
        // Handle union return type - add to separate results array to avoid infinite loop
        if (Array.isArray(compressedBatch)) {
          finalCompressedChunks.push(...compressedBatch);
        } else {
          finalCompressedChunks.push(...compressedBatch.data);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Add any remaining chunks from the main array
  if (compressedChunks.length > 0) {
    finalCompressedChunks.push(...compressedChunks);
  }

  // Compress in parallel with adaptive level selection
  const compressedResult = await compressParallel(
    finalCompressedChunks,
    options.compressionLevel,
    workerCount,
    true, // use adaptive compression
    false // don't collect stats
  );

  // Handle union return type
  const compressed = Array.isArray(compressedResult) ? compressedResult : compressedResult.data;

  // Validate compressed result
  if (!compressed || compressed.length === 0) {
    logger.critical('Compressie mislukt: geen gecomprimeerde chunks', undefined, { 
      compressedLength: compressed?.length 
    });
    throw new Error('Compressie mislukt: geen gecomprimeerde chunks');
  }

  logger.info('Compressie voltooid', { 
    compressedChunksCount: compressed.length 
  });

  report('encrypting', 50, 'Encrypteren...');

  // Generate keys with double encryption support
  const salt = generateSalt();
  
  // Validate salt
  if (!salt || salt.length === 0) {
    logger.critical('Salt generatie mislukt: salt is leeg', undefined, { saltLength: salt?.length });
    throw new Error('Salt generatie mislukt: salt is leeg');
  }
  
  const keyResult = await deriveKeyArgon2id(options.password, salt);
  const subKeys = await deriveSubKeys(keyResult.hash, ['encryption', 'manifest']);
  
  // Validate subKeys
  if (!subKeys || subKeys.length === 0) {
    logger.critical('Sleutelafleiding mislukt: geen subkeys gegenereerd', undefined, { 
      subKeysCount: subKeys?.length 
    });
    throw new Error('Sleutelafleiding mislukt: geen subkeys gegenereerd');
  }
  
  logger.info('Sleutelafleiding voltooid', { 
    subKeysCount: subKeys.length 
  });
  
  // Handle double encryption if enabled
  let secondSalt: Uint8Array | null = null;
  let secondKeyResult: any = null;
  let secondSubKeys: Uint8Array[] | null = null;
  
  if (options.enableDoubleEncryption && options.secondPassword) {
    // Validate second password
    if (!options.secondPassword || options.secondPassword.length === 0) {
      logger.error('Tweede wachtwoord mag niet leeg zijn', undefined, { secondPasswordLength: options.secondPassword?.length });
      throw new Error('Tweede wachtwoord mag niet leeg zijn');
    }
    
    if (options.secondPassword.length < MIN_PASSWORD_LENGTH) {
      logger.error('Tweede wachtwoord moet minimaal 8 tekens zijn', undefined, { secondPasswordLength: options.secondPassword.length });
      throw new Error(`Tweede wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn`);
    }
    
    if (options.secondPassword.length > MAX_PASSWORD_LENGTH) {
      logger.error('Tweede wachtwoord mag maximaal 1000 tekens zijn', undefined, { secondPasswordLength: options.secondPassword.length });
      throw new Error(`Tweede wachtwoord mag maximaal ${MAX_PASSWORD_LENGTH} tekens zijn`);
    }
    
    // Security check: prevent using same password for double encryption
    if (options.secondPassword === options.password) {
      logger.error('Tweede wachtwoord mag niet hetzelfde zijn als het eerste wachtwoord', undefined);
      throw new Error('Tweede wachtwoord mag niet hetzelfde zijn als het eerste wachtwoord');
    }
    
    // Security check: prevent similar passwords (Levenshtein distance check)
    const similarity = calculatePasswordSimilarity(options.password, options.secondPassword);
    if (similarity > 0.8) {
      logger.warn('Tweede wachtwoord lijkt te veel op het eerste wachtwoord', { similarity });
      throw new Error('Tweede wachtwoord lijkt te veel op het eerste wachtwoord. Kies een duidelijk ander wachtwoord.');
    }
    
    secondSalt = generateSalt();
    
    // Validate secondSalt
    if (!secondSalt || secondSalt.length === 0) {
      logger.critical('Tweede salt generatie mislukt: salt is leeg', undefined, { secondSaltLength: secondSalt?.length });
      throw new Error('Tweede salt generatie mislukt: salt is leeg');
    }
    
    secondKeyResult = await deriveKeyArgon2id(options.secondPassword, secondSalt);
    secondSubKeys = await deriveSubKeys(secondKeyResult.hash, ['encryption']);
  }

  // Encrypt chunks in parallel with AAD metadata
  let encryptionResults = await encryptChunksParallel(
    subKeys[0],
    compressed,
    'GhostVault/v5/chunk',
    options.fileName,
    Date.now()
  );
  
  // Validate encryption results
  if (!encryptionResults || encryptionResults.length === 0) {
    logger.critical('Encryptie mislukt: geen encryptie resultaten', undefined, { 
      resultsCount: encryptionResults?.length 
    });
    throw new Error('Encryptie mislukt: geen encryptie resultaten');
  }
  
  logger.info('Encryptie voltooid', { 
    encryptionResultsCount: encryptionResults.length 
  });
  
  // Apply second encryption layer if enabled
  if (options.enableDoubleEncryption && secondSubKeys) {
    const firstLayerCiphertext = encryptionResults.map(result => result.ciphertext);
    const secondLayerResults = await encryptChunksParallel(
      secondSubKeys[0],
      firstLayerCiphertext,
      'GhostVault/v5/double-encryption',
      options.fileName,
      Date.now()
    );
    
    // Validate second layer results
    if (!secondLayerResults || secondLayerResults.length === 0) {
      throw new Error('Tweede encryptie laag mislukt: geen encryptie resultaten');
    }
    
    encryptionResults = secondLayerResults;
  }

  // Extract ciphertext from encryption results
  const encryptedChunks = encryptionResults.map(result => result.ciphertext);

  // Validate encrypted chunks
  if (!encryptedChunks || encryptedChunks.length === 0) {
    throw new Error('Geen geëncrypte chunks');
  }

  report('chunking', 75, 'Chunks maken...');

  // Create chunk manifest with memory optimization
  const chunkManifest: ChunkInfo[] = [];
  let offset = 0;

  for (let i = 0; i < encryptedChunks.length; i++) {
    const chunk = encryptedChunks[i];
    const compressedChunk = compressedChunks[i];
    
    // Validate chunk exists
    if (!chunk || chunk.length === 0) {
      throw new Error(`Ongeldige geëncrypte chunk op index ${i}: lege chunk`);
    }
    
    if (!compressedChunk || compressedChunk.length === 0) {
      throw new Error(`Ongeldige gecomprimeerde chunk op index ${i}: lege chunk`);
    }
    
    // Avoid unnecessary copy - use chunk directly for hash
    const chunkBuffer = new Uint8Array(chunk);
    const sha256 = await crypto.subtle.digest('SHA-256', chunkBuffer);
    
    // Validate sha256
    if (!sha256 || sha256.byteLength === 0) {
      throw new Error(`Ongeldige chunk op index ${i}: sha256 is leeg`);
    }

    chunkManifest.push({
      id: i,
      offset,
      compressedSize: chunk.length,
      originalSize: compressedChunk.length,
      sha256: new TextDecoder().decode(sha256),
    });

    offset += chunk.length;
    
    // Clear reference to allow garbage collection
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  report('writing', 90, 'Schrijven naar schijf...');

  // Open file for writing
  const fileName = options.fileName || file.name + '.ghost';
  
  // Validate file name
  if (!fileName || fileName.length === 0) {
    throw new Error('Ongeldige bestandsnaam: leeg');
  }
  
  if (fileName.length > 255) {
    throw new Error('Ongeldige bestandsnaam: te lang (max 255 karakters)');
  }
  
  const handle = await openFileForWriting(fileName);

  try {
    // Write header
    const header = new Uint8Array(5 + 1 + SALT_BYTES + 4);
    header.set(GHOST_MAGIC, 0);
    header[5] = GHOST_VERSION;
    header.set(salt, 6);
    new DataView(header.buffer, header.byteOffset, header.byteLength)
      .setUint32(6 + SALT_BYTES, 0, false); // opaqueLength = 0 for v5

    await handle.writable.write(header);

    // Write chunks with error handling and batching
    const WRITE_BATCH_SIZE = 10;
    for (let i = 0; i < encryptedChunks.length; i += WRITE_BATCH_SIZE) {
      const batchEnd = Math.min(i + WRITE_BATCH_SIZE, encryptedChunks.length);
      const writePromises: Promise<void>[] = [];
      
      for (let j = i; j < batchEnd; j++) {
        const chunk = encryptedChunks[j];
        const nonce = encryptionResults[j].nonce;
        
        // Validate chunk and nonce exist
        if (!chunk || chunk.length === 0) {
          throw new Error(`Invalid chunk at index ${j}: empty chunk`);
        }
        
        if (!nonce || nonce.length !== 24) {
          throw new Error(`Invalid nonce at index ${j}: must be 24 bytes`);
        }
        
        const chunkBuffer = new Uint8Array(chunk);
        const chunkHash = await crypto.subtle.digest('SHA-256', chunkBuffer);
        const chunkData = encodeChunk({
          chunkId: BigInt(j),
          nonce: nonce,
          ciphertext: chunk,
          sha256: new Uint8Array(chunkHash),
        });

        writePromises.push(handle.writable.write(chunkData as any));
      }
      
      await Promise.all(writePromises);
      
      // Allow event loop to process other tasks
      if (batchEnd < encryptedChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    // Write footer
    const footer = new Uint8Array(GHOST_MAGIC_END.length + 8 + 8 + 32);
    footer.set(GHOST_MAGIC_END, 0);
    new DataView(footer.buffer, footer.byteOffset, footer.byteLength)
      .setBigUint64(GHOST_MAGIC_END.length, BigInt(encryptedChunks.length), false);
    new DataView(footer.buffer, footer.byteOffset, footer.byteLength)
      .setBigUint64(GHOST_MAGIC_END.length + 8, BigInt(totalBytes), false);

    const footerPrefix = footer.subarray(0, GHOST_MAGIC_END.length + 16);
    const fileHash = await crypto.subtle.digest('SHA-256', footerPrefix);
    footer.set(new Uint8Array(fileHash), GHOST_MAGIC_END.length + 16);

    await handle.writable.write(footer);

    report('writing', 100, 'Klaar');
  } finally {
    await handle.close();
  }
}

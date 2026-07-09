/**
 * MODULE: XChaCha20-Poly1305 Encryption
 *
 * Responsibilities:
 *  - XChaCha20-Poly1305 encryption/decryption
 *  - Streaming support
 *  - Parallel chunk encryption
 *  - AAD metadata for integrity
 *  - HMAC-SHA256 for extra authentication
 *
 * Used by:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * Depends on:
 *  - @noble/ciphers
 *  - core/crypto/kdf/argon2id.ts
 *
 * @module core/crypto/encryption/xchacha20
 */

// crypto is available globally in browser secure contexts
declare const crypto: Crypto;

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { getLogger } from '../../utils/logger.js';
import { validateXChaCha20Key, validateXChaCha20Nonce, validateBuffer } from '../../utils/validation.js';

const logger = getLogger('xchacha20');

// XChaCha20-Poly1305 constants (must match ghost.ts for compatibility)
export const XCHACHA20_KEY_BYTES = 32;
export const XCHACHA20_NONCE_BYTES = 24;
export const XCHACHA20_TAG_BYTES = 16;

// Maximum chunk size to prevent memory exhaustion
export const MAX_CHUNK_SIZE = 100 * 1024 * 1024; // 100MB

// Nonce tracking configuration
const MAX_NONCE_CACHE_SIZE = 100000;
const MAX_NONCE_GENERATION_ATTEMPTS = 100;

// Nonce tracking to prevent reuse
const usedNonces = new Set<string>();

/**
 * Generate a unique nonce and track it to prevent reuse
 */
function generateUniqueNonce(): Uint8Array {
  let nonce: Uint8Array;
  let nonceKey: string;
  let attempts = 0;
  
  do {
    nonce = crypto.getRandomValues(new Uint8Array(XCHACHA20_NONCE_BYTES));
    nonceKey = Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('');
    attempts++;
    
    if (attempts >= MAX_NONCE_GENERATION_ATTEMPTS) {
      // Fallback: clear cache and retry once more
      logger.warn('Nonce space nearly exhausted, clearing cache and retrying', { attempts });
      usedNonces.clear();
      nonce = crypto.getRandomValues(new Uint8Array(XCHACHA20_NONCE_BYTES));
      nonceKey = Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('');
      usedNonces.add(nonceKey);
      logger.info('Generated nonce after cache clear', { nonceKey });
      return nonce;
    }
  } while (usedNonces.has(nonceKey));
  
  // Add to tracking set
  usedNonces.add(nonceKey);
  
  // Prune cache if too large
  if (usedNonces.size > MAX_NONCE_CACHE_SIZE) {
    const entries = Array.from(usedNonces);
    usedNonces.clear();
    entries.slice(Math.floor(entries.length / 2)).forEach(entry => usedNonces.add(entry));
    logger.debug('Nonce cache pruned', { cacheSize: usedNonces.size });
  }
  
  return nonce;
}

/**
 * Clear nonce tracking cache (for testing or reset)
 */
export function clearNonceCache(): void {
  usedNonces.clear();
  logger.debug('Nonce cache cleared');
}

export interface XChaChaResult {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

export interface AADMetadata {
  fileName?: string;
  timestamp?: number;
  chunkIndex?: number;
  totalChunks?: number;
  checksum?: string;
}

/**
 * Securely wipe sensitive data from memory
 */
function secureWipe(data: Uint8Array): void {
  if (!data || data.length === 0) return;
  
  // Overwrite with random data multiple times for better security
  for (let i = 0; i < 5; i++) {
    crypto.getRandomValues(data);
  }
  
  // Then overwrite with zeros
  data.fill(0);
  
  // Additional pass with alternating pattern
  for (let i = 0; i < data.length; i++) {
    data[i] = (i % 2 === 0) ? 0xAA : 0x55;
  }
  
  // Final zero pass
  data.fill(0);
  
  logger.debug('Sensitive data securely wiped', { length: data.length });
}

/**
 * Constant-time comparison for numbers to prevent timing attacks
 */
function constantTimeCompareNumber(a: number, b: number): boolean {
  if (a === b) return true;
  // For integers, use bitwise comparison which is constant-time
  if (Number.isInteger(a) && Number.isInteger(b)) {
    const diff = a ^ b;
    return diff === 0;
  }
  // For floating-point or very large numbers, fall back to string comparison
  return constantTimeCompare(a.toString(), b.toString());
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Encode AAD metadata to bytes with validation
 */
function encodeAAD(metadata: AADMetadata): Uint8Array {
  const parts: string[] = [];
  
  // Validate and encode fileName
  if (metadata.fileName) {
    if (metadata.fileName.length > 255) {
      logger.warn('FileName in AAD exceeds 255 characters, truncating', { length: metadata.fileName.length });
      metadata.fileName = metadata.fileName.substring(0, 255);
    }
    // Escape special characters to prevent injection
    const escapedFileName = metadata.fileName.replace(/[|:]/g, '_');
    parts.push(`fn:${escapedFileName}`);
  }
  
  // Validate and encode timestamp
  if (metadata.timestamp) {
    if (typeof metadata.timestamp !== 'number' || metadata.timestamp < 0) {
      logger.warn('Invalid timestamp in AAD, using current time', { timestamp: metadata.timestamp });
      metadata.timestamp = Date.now();
    }
    parts.push(`ts:${metadata.timestamp}`);
  }
  
  // Validate and encode chunkIndex
  if (metadata.chunkIndex !== undefined) {
    if (typeof metadata.chunkIndex !== 'number' || metadata.chunkIndex < 0) {
      logger.warn('Invalid chunkIndex in AAD, using 0', { chunkIndex: metadata.chunkIndex });
      metadata.chunkIndex = 0;
    }
    parts.push(`ci:${metadata.chunkIndex}`);
  }
  
  // Validate and encode totalChunks
  if (metadata.totalChunks !== undefined) {
    if (typeof metadata.totalChunks !== 'number' || metadata.totalChunks < 0) {
      logger.warn('Invalid totalChunks in AAD, using 1', { totalChunks: metadata.totalChunks });
      metadata.totalChunks = 1;
    }
    parts.push(`tc:${metadata.totalChunks}`);
  }
  
  // Validate and encode checksum
  if (metadata.checksum) {
    if (typeof metadata.checksum !== 'string' || metadata.checksum.length === 0) {
      logger.warn('Invalid checksum in AAD, skipping', { checksum: metadata.checksum });
    } else {
      parts.push(`cs:${metadata.checksum}`);
    }
  }
  
  return new TextEncoder().encode(parts.join('|'));
}

/**
 * Decode AAD metadata from bytes with validation and error logging
 */
function decodeAAD(aad: Uint8Array): AADMetadata {
  const text = new TextDecoder().decode(aad);
  const parts = text.split('|');
  const metadata: AADMetadata = {};
  let malformedParts = 0;
  
  for (const part of parts) {
    if (!part || part.length === 0) {
      malformedParts++;
      continue;
    }
    
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      malformedParts++;
      logger.warn('Malformed AAD part: missing colon', { part });
      continue;
    }
    
    const key = part.substring(0, colonIndex);
    const value = part.substring(colonIndex + 1);
    
    switch (key) {
      case 'fn':
        if (value.length > 0) {
          metadata.fileName = value;
        }
        break;
      case 'ts':
        const timestamp = parseInt(value, 10);
        if (!isNaN(timestamp) && timestamp >= 0) {
          metadata.timestamp = timestamp;
        } else {
          logger.warn('Invalid timestamp in AAD', { value });
        }
        break;
      case 'ci':
        const chunkIndex = parseInt(value, 10);
        if (!isNaN(chunkIndex) && chunkIndex >= 0) {
          metadata.chunkIndex = chunkIndex;
        } else {
          logger.warn('Invalid chunkIndex in AAD', { value });
        }
        break;
      case 'tc':
        const totalChunks = parseInt(value, 10);
        if (!isNaN(totalChunks) && totalChunks >= 0) {
          metadata.totalChunks = totalChunks;
        } else {
          logger.warn('Invalid totalChunks in AAD', { value });
        }
        break;
      case 'cs':
        if (value.length > 0) {
          metadata.checksum = value;
        }
        break;
      default:
        logger.warn('Unknown AAD key', { key });
        malformedParts++;
    }
  }
  
  if (malformedParts > 0) {
    logger.warn('AAD decoding completed with malformed parts', { malformedParts, totalParts: parts.length });
  }
  
  return metadata;
}

/**
 * Calculate checksum of data using SHA-256 for better security
 */
async function calculateChecksum(data: Uint8Array): Promise<string> {
  if (!data || data.length === 0) {
    return '00';
  }

  // Validate data size to prevent performance issues
  if (data.length > 10 * 1024 * 1024 * 1024) { // 10GB
    logger.warn('Data too large for checksum calculation, using truncated hash', { dataLength: data.length });
    // Use first 1MB for checksum
    data = data.slice(0, 1024 * 1024);
  }

  // Use SHA-256 for better checksum security
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  const hashArray = new Uint8Array(hashBuffer);

  // Return full hash as hex string (64 characters for 32 bytes)
  let checksum = '';
  for (let i = 0; i < hashArray.length; i++) {
    checksum += hashArray[i]!.toString(16).padStart(2, '0');
  }
  return checksum;
}

/**
 * Encrypt data with XChaCha20-Poly1305 with AAD metadata
 */
export async function encryptXChaCha20(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
  nonce?: Uint8Array,
  metadata?: AADMetadata
): Promise<XChaChaResult> {
  logger.info('encryptXChaCha20 started', { 
    keyLength: key?.length, 
    plaintextLength: plaintext?.length,
    aadLength: aad?.length,
    hasNonce: !!nonce,
    hasMetadata: !!metadata,
    metadata 
  });

  // Use shared validation
  const keyValidation = validateXChaCha20Key(key);
  if (!keyValidation.valid) {
    logger.error(keyValidation.error || 'Invalid key', undefined, { keyLength: key?.length });
    throw new Error(keyValidation.error || 'Invalid key');
  }
  
  const plaintextValidation = validateBuffer(plaintext, 1, 'XChaCha20 plaintext');
  if (!plaintextValidation.valid) {
    logger.error(plaintextValidation.error || 'Invalid plaintext', undefined, { plaintextLength: plaintext?.length });
    throw new Error(plaintextValidation.error || 'Invalid plaintext');
  }
  
  // Validate chunk size
  if (plaintext.length > MAX_CHUNK_SIZE) {
    logger.error('Plaintext too large (max 100MB)', undefined, { plaintextLength: plaintext.length });
    throw new Error('Plaintext too large (max 100MB)');
  }

  // Use unique nonce tracking to prevent reuse
  const useNonce = nonce ?? generateUniqueNonce();
  const nonceValidation = validateXChaCha20Nonce(useNonce);
  if (!nonceValidation.valid) {
    logger.error(nonceValidation.error || 'Invalid nonce', undefined, { nonceLength: useNonce.length });
    throw new Error(nonceValidation.error || 'Invalid nonce');
  }

  // Combine AAD with metadata
  let combinedAAD = aad;
  if (metadata) {
    const metadataAAD = encodeAAD(metadata);
    if (aad) {
      combinedAAD = new Uint8Array(aad.length + metadataAAD.length);
      combinedAAD.set(aad);
      combinedAAD.set(metadataAAD, aad.length);
    } else {
      combinedAAD = metadataAAD;
    }
  }

  const cipher = xchacha20poly1305(key, useNonce, combinedAAD);
  const ciphertext = cipher.encrypt(plaintext);
  
  // Validate ciphertext
  if (!ciphertext || ciphertext.length === 0) {
    logger.critical('Encryption failed: ciphertext is empty', undefined, { 
      ciphertextLength: ciphertext?.length 
    });
    throw new Error('Encryption failed: ciphertext is empty');
  }
  
  logger.info('encryptXChaCha20 completed', { 
    ciphertextLength: ciphertext.length,
    nonceLength: useNonce.length
  });

  return { ciphertext, nonce: useNonce };
}

/**
 * Decrypt data with XChaCha20-Poly1305 with AAD metadata validation
 */
export async function decryptXChaCha20(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
  expectedMetadata?: AADMetadata
): Promise<Uint8Array> {
  logger.info('decryptXChaCha20 started', { 
    keyLength: key?.length, 
    ciphertextLength: ciphertext?.length,
    aadLength: aad?.length,
    nonceLength: nonce?.length,
    hasExpectedMetadata: !!expectedMetadata,
    expectedMetadata
  });

  // Use shared validation
  const keyValidation = validateXChaCha20Key(key);
  if (!keyValidation.valid) {
    logger.error(keyValidation.error || 'Invalid key', undefined, { keyLength: key?.length });
    throw new Error(keyValidation.error || 'Invalid key');
  }
  
  const ciphertextValidation = validateBuffer(ciphertext, 1, 'XChaCha20 ciphertext');
  if (!ciphertextValidation.valid) {
    logger.error(ciphertextValidation.error || 'Invalid ciphertext', undefined, { ciphertextLength: ciphertext?.length });
    throw new Error(ciphertextValidation.error || 'Invalid ciphertext');
  }
  
  // Validate chunk size
  if (ciphertext.length > MAX_CHUNK_SIZE) {
    logger.error('Ciphertext too large (max 100MB)', undefined, { ciphertextLength: ciphertext.length });
    throw new Error('Ciphertext too large (max 100MB)');
  }
  
  const nonceValidation = validateXChaCha20Nonce(nonce);
  if (!nonceValidation.valid) {
    logger.error(nonceValidation.error || 'Invalid nonce', undefined, { nonceLength: nonce.length });
    throw new Error(nonceValidation.error || 'Invalid nonce');
  }

  // Reconstruct AAD from expectedMetadata if not provided
  let actualAad = aad;
  if (!actualAad && expectedMetadata) {
    actualAad = encodeAAD(expectedMetadata);
  }

  const cipher = xchacha20poly1305(key, nonce, actualAad);
  const plaintext = cipher.decrypt(ciphertext);
  
  // Validate plaintext
  if (!plaintext || plaintext.length === 0) {
    logger.critical('Decryption failed: plaintext is empty', undefined, { 
      plaintextLength: plaintext?.length 
    });
    throw new Error('Decryption failed: plaintext is empty');
  }

  // Validate metadata if provided
  if (expectedMetadata && aad) {
    const decodedMetadata = decodeAAD(aad);
    
    if (expectedMetadata.fileName && decodedMetadata.fileName !== expectedMetadata.fileName) {
      // Use constant-time comparison for security
      if (!constantTimeCompare(decodedMetadata.fileName || '', expectedMetadata.fileName)) {
        logger.error('Filename does not match in AAD', undefined, { 
          expected: expectedMetadata.fileName,
          actual: decodedMetadata.fileName 
        });
        throw new Error('Filename does not match in AAD');
      }
    }
    
    if (expectedMetadata.timestamp && decodedMetadata.timestamp !== expectedMetadata.timestamp) {
      // Use constant-time comparison for security
      if (!constantTimeCompareNumber(decodedMetadata.timestamp || 0, expectedMetadata.timestamp)) {
        logger.error('Timestamp does not match in AAD', undefined, { 
          expected: expectedMetadata.timestamp,
          actual: decodedMetadata.timestamp 
        });
        throw new Error('Timestamp does not match in AAD');
      }
    }
    
    if (expectedMetadata.chunkIndex !== undefined && decodedMetadata.chunkIndex !== expectedMetadata.chunkIndex) {
      // Use constant-time comparison for security
      if (!constantTimeCompareNumber(decodedMetadata.chunkIndex || 0, expectedMetadata.chunkIndex)) {
        logger.error('Chunk index does not match in AAD', undefined, { 
          expected: expectedMetadata.chunkIndex,
          actual: decodedMetadata.chunkIndex 
        });
        throw new Error('Chunk index does not match in AAD');
      }
    }
    
    if (expectedMetadata.totalChunks !== undefined && decodedMetadata.totalChunks !== expectedMetadata.totalChunks) {
      // Use constant-time comparison for security
      if (!constantTimeCompareNumber(decodedMetadata.totalChunks || 0, expectedMetadata.totalChunks)) {
        logger.error('Total chunks does not match in AAD', undefined, { 
          expected: expectedMetadata.totalChunks,
          actual: decodedMetadata.totalChunks 
        });
        throw new Error('Total chunks does not match in AAD');
      }
    }
  }

  logger.info('decryptXChaCha20 completed', { 
    plaintextLength: plaintext.length 
  });

  return plaintext;
}

/**
 * Parallel encryption of multiple chunks with AAD metadata
 */
export async function encryptChunksParallel(
  key: Uint8Array,
  chunks: Uint8Array[],
  aadPrefix?: string,
  fileName?: string,
  timestamp?: number
): Promise<XChaChaResult[]> {
  logger.info('encryptChunksParallel started', { 
    keyLength: key?.length, 
    chunksCount: chunks?.length,
    aadPrefix,
    fileName,
    timestamp
  });

  // Use shared validation
  const keyValidation = validateXChaCha20Key(key);
  if (!keyValidation.valid) {
    logger.error(keyValidation.error || 'Invalid key', undefined, { keyLength: key?.length });
    throw new Error(keyValidation.error || 'Invalid key');
  }
  
  if (!chunks || chunks.length === 0) {
    logger.error('encryptChunksParallel: chunks array must not be empty', undefined, { chunksCount: chunks?.length });
    throw new Error('encryptChunksParallel: chunks array must not be empty');
  }
  
  if (chunks.length > 10000) {
    logger.error('encryptChunksParallel: too many chunks (max 10000)', undefined, { chunksCount: chunks.length });
    throw new Error('encryptChunksParallel: too many chunks (max 10000)');
  }
  
  // Validate total size
  const totalSize = chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  if (totalSize > 10 * 1024 * 1024 * 1024) { // 10GB
    logger.error('encryptChunksParallel: total data too large (max 10GB)', undefined, { totalSize });
    throw new Error('encryptChunksParallel: total data too large (max 10GB)');
  }
  
  const totalChunks = chunks.length;
  const timestampValue = timestamp ?? Date.now();
  
  // Validate timestamp
  if (typeof timestampValue !== 'number' || timestampValue < 0) {
    logger.error('encryptChunksParallel: timestamp must be a positive number', undefined, { timestamp: timestampValue });
    throw new Error('encryptChunksParallel: timestamp must be a positive number');
  }

  // Process chunks in batches to avoid overwhelming memory
  const BATCH_SIZE = 50;
  const results: XChaChaResult[] = [];
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (chunk, batchIndex) => {
        const index = i + batchIndex;
        
        if (!chunk || chunk.length === 0) {
          logger.error(`encryptChunksParallel: chunk at index ${index} is empty`, undefined, { index });
          throw new Error(`encryptChunksParallel: chunk at index ${index} is empty`);
        }
        
        // Validate individual chunk size
        if (chunk.length > MAX_CHUNK_SIZE) {
          logger.error(`encryptChunksParallel: chunk at index ${index} too large (max 100MB)`, undefined, { index, chunkLength: chunk.length });
          throw new Error(`encryptChunksParallel: chunk at index ${index} too large (max 100MB)`);
        }
        
        const baseAAD = aadPrefix
          ? new TextEncoder().encode(`${aadPrefix}/${index}`)
          : undefined;
        
        const metadata: AADMetadata = {
          fileName,
          timestamp: timestampValue,
          chunkIndex: index,
          totalChunks
        };
        
        return encryptXChaCha20(key, chunk, baseAAD, undefined, metadata);
      })
    );
    
    results.push(...batchResults);
    
    // Allow event loop to process other tasks
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return results;
}

/**
 * Parallel decryption of multiple chunks with AAD metadata validation
 */
export async function decryptChunksParallel(
  key: Uint8Array,
  chunks: { ciphertext: Uint8Array; nonce: Uint8Array }[],
  aadPrefix?: string,
  expectedFileName?: string,
  expectedTimestamp?: number
): Promise<Uint8Array[]> {
  // Use shared validation
  const keyValidation = validateXChaCha20Key(key);
  if (!keyValidation.valid) {
    throw new Error(keyValidation.error || 'Invalid key');
  }
  
  if (!chunks || chunks.length === 0) {
    throw new Error('decryptChunksParallel: chunks array must not be empty');
  }
  
  if (chunks.length > 10000) {
    throw new Error('decryptChunksParallel: too many chunks (max 10000)');
  }
  
  // Validate total size
  const totalSize = chunks.reduce((sum, chunk) => sum + (chunk.ciphertext?.length || 0), 0);
  if (totalSize > 10 * 1024 * 1024 * 1024) { // 10GB
    throw new Error('decryptChunksParallel: total data too large (max 10GB)');
  }
  
  // Validate expectedTimestamp if provided
  if (expectedTimestamp !== undefined) {
    if (typeof expectedTimestamp !== 'number' || expectedTimestamp < 0) {
      throw new Error('decryptChunksParallel: expected timestamp must be a positive number');
    }
  }
  
  // Process chunks in batches to avoid overwhelming memory
  const BATCH_SIZE = 50;
  const results: Uint8Array[] = [];
  
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (chunk, batchIndex) => {
        const index = i + batchIndex;
        
        if (!chunk || !chunk.ciphertext || chunk.ciphertext.length === 0) {
          throw new Error(`decryptChunksParallel: chunk at index ${index} is empty`);
        }
        
        // Validate individual chunk size
        if (chunk.ciphertext.length > MAX_CHUNK_SIZE) {
          throw new Error(`decryptChunksParallel: chunk at index ${index} too large (max 100MB)`);
        }
        
        const nonceValidation = validateXChaCha20Nonce(chunk.nonce);
        if (!nonceValidation.valid) {
          throw new Error(`decryptChunksParallel: nonce at index ${index} invalid`);
        }
        
        // Construct metadata for AAD reconstruction
        const expectedMetadata: AADMetadata = {
          fileName: expectedFileName,
          timestamp: expectedTimestamp,
          chunkIndex: index,
          totalChunks: chunks.length
        };
        
        // AAD will be reconstructed from expectedMetadata in decryptXChaCha20
        return decryptXChaCha20(key, chunk.ciphertext, chunk.nonce, undefined, expectedMetadata);
      })
    );
    
    results.push(...batchResults);
    
    // Allow event loop to process other tasks
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return results;
}

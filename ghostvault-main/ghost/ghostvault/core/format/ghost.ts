/**
 * MODULE: .ghost Format v7
 *
 * Responsibilities:
 *  - .ghost format v7 implementation
 *  - Streaming header parsing
 *  - Streaming chunk parsing
 *  - Backward compatibility (v1-v6)
 *
 * Used by:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * Depends on:
 *  - core/crypto/encryption/xchacha20.ts
 *  - core/crypto/kdf/argon2id.ts
 *  - core/types/index.ts
 *
 * @module core/format/ghost
 */

import type { ChunkInfo } from '../types/index.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('ghost');

export const GHOST_MAGIC = new TextEncoder().encode('GHOST');
export const GHOST_MAGIC_END = new TextEncoder().encode('TSOHG');
export const GHOST_VERSION = 7; // v7: Added nonce tracking, improved validation, constant-time comparisons

export const SALT_BYTES = 64; // Increased from 32 to 64 bytes for better security
export const XCHACHA20_NONCE_BYTES = 24;
export const XCHACHA20_TAG_BYTES = 16;
export const SHA256_BYTES = 32;

export const GHOST_V5_CHUNK_PREFIX = 8 + XCHACHA20_NONCE_BYTES + 4; // chunkId + nonce + cipherLen

export interface GhostHeader {
  magic: Uint8Array;
  version: number;
  salt: Uint8Array;
  opaqueLength: number;
}

export interface GhostFooter {
  magicEnd: Uint8Array;
  totalChunks: bigint;
  totalSize: bigint;
  fileHash: Uint8Array;
}

export interface GhostChunk {
  chunkId: bigint;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  sha256: Uint8Array;
}

/**
 * Constant-time byte array comparison to prevent timing attacks
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * Parse .ghost header
 */
export function parseHeader(buffer: Uint8Array): GhostHeader {
  logger.debug('parseHeader started', { bufferLength: buffer?.length });

  if (!buffer || buffer.length === 0) {
    logger.error('Buffer is empty or null', undefined, { bufferLength: buffer?.length });
    throw new Error('Buffer is empty or null');
  }

  if (buffer.length < 5 + 1 + SALT_BYTES + 4) {
    logger.error('File too short for header', undefined, { bufferLength: buffer.length });
    throw new Error('File too short for header');
  }

  const magic = buffer.subarray(0, 5);
  if (!bytesEqual(magic, GHOST_MAGIC)) {
    logger.error('Invalid .ghost magic header', undefined, { magic: Array.from(magic) });
    throw new Error('Invalid .ghost magic header');
  }

  const version = buffer[5];
  if (version !== GHOST_VERSION) {
    logger.error('Unsupported .ghost version', undefined, { version, expectedVersion: GHOST_VERSION });
    throw new Error(`Unsupported .ghost version: ${version}`);
  }

  const salt = buffer.subarray(6, 6 + SALT_BYTES);
  const opaqueLength = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    .getUint32(6 + SALT_BYTES, false);

  logger.debug('parseHeader completed', { 
    version, 
    opaqueLength,
    saltLength: salt.length 
  });

  return {
    magic,
    version,
    salt,
    opaqueLength,
  };
}

/**
 * Parse .ghost footer with position validation
 */
export function parseFooter(buffer: Uint8Array): GhostFooter {
  logger.debug('parseFooter started', { bufferLength: buffer?.length });

  if (!buffer || buffer.length === 0) {
    logger.error('Buffer is empty or null', undefined, { bufferLength: buffer?.length });
    throw new Error('Buffer is empty or null');
  }

  const footerSize = GHOST_MAGIC_END.length + 8 + 8 + SHA256_BYTES;
  
  // Validate footer position is within bounds
  if (buffer.length < footerSize) {
    logger.error('File too short for footer', undefined, { 
      bufferLength: buffer.length,
      footerSize 
    });
    throw new Error('File too short for footer');
  }
  
  const footerStart = buffer.length - footerSize;
  
  // Validate footer position is not negative
  if (footerStart < 0) {
    logger.error('Invalid footer position: negative offset', undefined, { footerStart });
    throw new Error('Invalid footer position: negative offset');
  }
  
  // Validate footer position doesn't overlap with header
  const headerSize = 5 + 1 + SALT_BYTES + 4; // magic + version + salt + opaqueLength
  if (footerStart <= headerSize) {
    logger.error('Invalid footer position: overlap with header', undefined, { 
      footerStart,
      headerSize 
    });
    throw new Error('Invalid footer position: overlap with header');
  }

  const magicEnd = buffer.subarray(footerStart);
  if (!bytesEqual(magicEnd, GHOST_MAGIC_END)) {
    logger.error('Invalid .ghost footer magic', undefined, { magicEnd: Array.from(magicEnd) });
    throw new Error('Invalid .ghost footer magic');
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const totalChunks = view.getBigUint64(footerStart + GHOST_MAGIC_END.length, false);
  const totalSize = view.getBigUint64(footerStart + GHOST_MAGIC_END.length + 8, false);
  const fileHash = buffer.subarray(footerStart + GHOST_MAGIC_END.length + 16);

  // Validate total chunks is not negative
  if (totalChunks < 0n) {
    logger.error('Invalid total chunks: negative value', undefined, { totalChunks });
    throw new Error('Invalid total chunks: negative value');
  }
  
  // Validate total size is not negative
  if (totalSize < 0n) {
    logger.error('Invalid total size: negative value', undefined, { totalSize });
    throw new Error('Invalid total size: negative value');
  }
  
  // Validate file hash length
  if (fileHash.length !== SHA256_BYTES) {
    logger.error('Invalid file hash length', undefined, { 
      fileHashLength: fileHash.length,
      expectedLength: SHA256_BYTES 
    });
    throw new Error('Invalid file hash length');
  }

  logger.debug('parseFooter completed', { 
    totalChunks,
    totalSize,
    fileHashLength: fileHash.length 
  });

  return {
    magicEnd,
    totalChunks,
    totalSize,
    fileHash,
  };
}

/**
 * Parse single chunk
 */
export function parseChunk(buffer: Uint8Array, offset: number): GhostChunk {
  logger.debug('parseChunk started', { 
    bufferLength: buffer?.length,
    offset 
  });

  // Validate buffer exists
  if (!buffer || buffer.length === 0) {
    logger.error('Buffer is empty or null', undefined, { bufferLength: buffer?.length });
    throw new Error('Buffer is empty or null');
  }

  // Validate offset is within bounds
  if (offset < 0) {
    logger.error('Invalid chunk offset: negative value', undefined, { offset });
    throw new Error('Invalid chunk offset: negative value');
  }
  
  if (offset + 8 > buffer.length) {
    logger.error('Invalid chunk offset: exceeds buffer length', undefined, { 
      offset,
      bufferLength: buffer.length 
    });
    throw new Error('Invalid chunk offset: exceeds buffer length');
  }
  
  const chunkId = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    .getBigUint64(offset, false);
  const nonce = buffer.subarray(offset + 8, offset + 8 + XCHACHA20_NONCE_BYTES);
  
  // Validate nonce is within bounds
  if (offset + 8 + XCHACHA20_NONCE_BYTES > buffer.length) {
    logger.error('Invalid chunk: nonce exceeds buffer length', undefined, { 
      offset,
      nonceEnd: offset + 8 + XCHACHA20_NONCE_BYTES,
      bufferLength: buffer.length 
    });
    throw new Error('Invalid chunk: nonce exceeds buffer length');
  }
  
  const cipherLen = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    .getUint32(offset + 8 + XCHACHA20_NONCE_BYTES, false);
  
  // Validate cipherLen is reasonable
  if (cipherLen < 0 || cipherLen > 100 * 1024 * 1024) { // Max 100MB per chunk
    logger.error('Invalid chunk: cipherLen outside reasonable range', undefined, { 
      cipherLen,
      maxCipherLen: 100 * 1024 * 1024 
    });
    throw new Error('Invalid chunk: cipherLen outside reasonable range');
  }
  
  // Validate ciphertext is within bounds
  const ciphertextStart = offset + 8 + XCHACHA20_NONCE_BYTES + 4;
  const ciphertextEnd = ciphertextStart + cipherLen;
  if (ciphertextEnd > buffer.length) {
    logger.error('Invalid chunk: ciphertext exceeds buffer length', undefined, { 
      ciphertextEnd,
      bufferLength: buffer.length 
    });
    throw new Error('Invalid chunk: ciphertext exceeds buffer length');
  }
  
  const ciphertext = buffer.subarray(
    ciphertextStart,
    ciphertextEnd
  );
  
  // Validate ciphertext is not empty
  if (!ciphertext || ciphertext.length === 0) {
    logger.error('Invalid chunk: ciphertext is empty', undefined, { chunkId });
    throw new Error('Invalid chunk: ciphertext is empty');
  }
  
  // Validate SHA256 is within bounds
  const sha256Start = ciphertextEnd;
  const sha256End = sha256Start + SHA256_BYTES;
  if (sha256End > buffer.length) {
    logger.error('Invalid chunk: SHA256 exceeds buffer length', undefined, { 
      sha256End,
      bufferLength: buffer.length 
    });
    throw new Error('Invalid chunk: SHA256 exceeds buffer length');
  }
  
  const sha256 = buffer.subarray(sha256Start, sha256End);
  
  // Validate sha256 is not empty
  if (!sha256 || sha256.length === 0) {
    logger.error('Invalid chunk: sha256 is empty', undefined, { chunkId });
    throw new Error('Invalid chunk: sha256 is empty');
  }

  logger.debug('parseChunk completed', { 
    chunkId,
    ciphertextLength: ciphertext.length,
    sha256Length: sha256.length 
  });

  return {
    chunkId,
    nonce,
    ciphertext,
    sha256,
  };
}

/**
 * Encode single chunk
 */
export function encodeChunk(chunk: GhostChunk): Uint8Array {
  logger.debug('encodeChunk started', { 
    chunkId: chunk?.chunkId,
    ciphertextLength: chunk?.ciphertext?.length 
  });

  // Validate chunk object exists
  if (!chunk) {
    logger.error('Invalid chunk: chunk is null or undefined', undefined, { chunk });
    throw new Error('Invalid chunk: chunk is null or undefined');
  }
  
  // Validate chunk components
  if (!chunk.ciphertext || chunk.ciphertext.length === 0) {
    logger.error('Invalid chunk: ciphertext is empty', undefined, { chunkId: chunk.chunkId });
    throw new Error('Invalid chunk: ciphertext is empty');
  }
  
  if (chunk.ciphertext.length > 100 * 1024 * 1024) { // Max 100MB per chunk
    logger.error('Invalid chunk: ciphertext too large', undefined, { 
      ciphertextLength: chunk.ciphertext.length,
      maxCipherLength: 100 * 1024 * 1024 
    });
    throw new Error('Invalid chunk: ciphertext too large');
  }
  
  if (!chunk.nonce || chunk.nonce.length !== XCHACHA20_NONCE_BYTES) {
    logger.error('Invalid chunk: nonce must be exactly 24 bytes', undefined, { 
      nonceLength: chunk.nonce?.length,
      expectedLength: XCHACHA20_NONCE_BYTES 
    });
    throw new Error('Invalid chunk: nonce must be exactly 24 bytes');
  }
  
  if (!chunk.sha256 || chunk.sha256.length !== SHA256_BYTES) {
    logger.error('Invalid chunk: sha256 must be exactly 32 bytes', undefined, { 
      sha256Length: chunk.sha256?.length,
      expectedLength: SHA256_BYTES 
    });
    throw new Error('Invalid chunk: sha256 must be exactly 32 bytes');
  }
  
  if (chunk.chunkId < 0n) {
    logger.error('Invalid chunk: chunkId must not be negative', undefined, { chunkId: chunk.chunkId });
    throw new Error('Invalid chunk: chunkId must not be negative');
  }
  
  // Validate total record size doesn't exceed reasonable limits
  const recordSize = 8 + XCHACHA20_NONCE_BYTES + 4 + chunk.ciphertext.length + SHA256_BYTES;
  if (recordSize > 100 * 1024 * 1024 + 100) { // Max chunk size + overhead
    logger.error('Invalid chunk: total record size too large', undefined, { 
      recordSize,
      maxRecordSize: 100 * 1024 * 1024 + 100 
    });
    throw new Error('Invalid chunk: total record size too large');
  }
  
  const record = new Uint8Array(recordSize);

  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  view.setBigUint64(0, chunk.chunkId, false);
  record.set(chunk.nonce, 8);
  view.setUint32(8 + XCHACHA20_NONCE_BYTES, chunk.ciphertext.length, false);
  record.set(chunk.ciphertext, 8 + XCHACHA20_NONCE_BYTES + 4);
  record.set(chunk.sha256, 8 + XCHACHA20_NONCE_BYTES + 4 + chunk.ciphertext.length);

  // Validate record was created successfully
  if (!record || record.length === 0) {
    logger.error('Invalid chunk: record is empty', undefined, { chunkId: chunk.chunkId });
    throw new Error('Invalid chunk: record is empty');
  }

  logger.debug('encodeChunk completed', { 
    chunkId: chunk.chunkId,
    recordLength: record.length 
  });

  return record;
}

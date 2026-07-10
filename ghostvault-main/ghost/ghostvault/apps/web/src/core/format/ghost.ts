/**
 * MODULE: .ghost Format v5
 *
 * Verantwoordelijkheid:
 * - .ghost format v5 implementatie
 * - Streaming header parsing
 * - Streaming chunk parsing
 * - Backward compatibility (v1-v4)
 *
 * Gebruikt door:
 * - core/format/packer.ts
 * - core/format/unpacker.ts
 *
 * Afhankelijk van:
 * - core/crypto/encryption/xchacha20.ts
 * - core/crypto/kdf/argon2id.ts
 * - core/types/index.ts
 *
 * @module core/format/ghost
 */

import type { ChunkInfo } from '../types/index.js';

export const GHOST_MAGIC = new TextEncoder().encode('GHOST');
export const GHOST_MAGIC_END = new TextEncoder().encode('TSOHG');
export const GHOST_VERSION = 6; // Verhoogd naar v6 voor breaking change (salt grootte van 32 naar 64 bytes)

export const SALT_BYTES = 64; // Verhoogd van 32 naar 64 bytes voor betere beveiliging
export const XCHACHA20_NONCE_BYTES = 24;
export const XCHACHA20_TAG_BYTES = 16;
export const SHA256_BYTES = 32;

/**
 * Minimum password length. Single source of truth shared by packer and
 * unpacker so the pack/unpack policy can never drift out of sync.
 */
export const MIN_PASSWORD_LENGTH = 6;

export const GHOST_V5_CHUNK_PREFIX = 8 + XCHACHA20_NONCE_BYTES + 4; // chunkId + nonce + cipherLen

/** Size of the fixed .ghost header: magic(5) + version(1) + salt + opaqueLen(4) */
export const GHOST_HEADER_BYTES = 5 + 1 + SALT_BYTES + 4;

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
 * Parse .ghost header
 */
export function parseHeader(buffer: Uint8Array): GhostHeader {
  if (!buffer || buffer.length === 0) {
    throw new Error('Invalid header: buffer is empty');
  }

  if (buffer.length < GHOST_HEADER_BYTES) {
    throw new Error('File too short for header');
  }

  const magic = buffer.subarray(0, 5);
  if (!bytesEqual(magic, GHOST_MAGIC)) {
    throw new Error('Invalid .ghost magic header');
  }

  const version = buffer[5];
  if (version !== GHOST_VERSION) {
    throw new Error(`Unsupported .ghost version: ${version}`);
  }

  const salt = buffer.subarray(6, 6 + SALT_BYTES);
  const opaqueLength = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    .getUint32(6 + SALT_BYTES, false);

  return {
    magic,
    version,
    salt,
    opaqueLength,
  };
}

/**
 * Parse .ghost footer
 */
export function parseFooter(buffer: Uint8Array): GhostFooter {
  const footerStart = buffer.length - GHOST_MAGIC_END.length - 8 - 8 - SHA256_BYTES;

  // Validate footer position is within buffer bounds
  if (footerStart < 0 || footerStart >= buffer.length) {
    throw new Error('Invalid footer position: file too short for footer');
  }

  const magicEnd = buffer.subarray(footerStart, footerStart + GHOST_MAGIC_END.length);
  if (!bytesEqual(magicEnd, GHOST_MAGIC_END)) {
    throw new Error('Invalid .ghost footer magic');
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const totalChunks = view.getBigUint64(footerStart + GHOST_MAGIC_END.length, false);
  const totalSize = view.getBigUint64(footerStart + GHOST_MAGIC_END.length + 8, false);
  const fileHash = buffer.subarray(
    footerStart + GHOST_MAGIC_END.length + 16,
    footerStart + GHOST_MAGIC_END.length + 16 + SHA256_BYTES
  );

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
  const chunkId = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    .getBigUint64(offset, false);
  const nonce = buffer.subarray(offset + 8, offset + 8 + XCHACHA20_NONCE_BYTES);
  const cipherLen = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    .getUint32(offset + 8 + XCHACHA20_NONCE_BYTES, false);
  const ciphertext = buffer.subarray(
    offset + 8 + XCHACHA20_NONCE_BYTES + 4,
    offset + 8 + XCHACHA20_NONCE_BYTES + 4 + cipherLen
  );
  const sha256 = buffer.subarray(
    offset + 8 + XCHACHA20_NONCE_BYTES + 4 + cipherLen,
    offset + 8 + XCHACHA20_NONCE_BYTES + 4 + cipherLen + SHA256_BYTES
  );

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
  const record = new Uint8Array(
    8 + XCHACHA20_NONCE_BYTES + 4 + chunk.ciphertext.length + SHA256_BYTES
  );

  const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
  view.setBigUint64(0, chunk.chunkId, false);
  record.set(chunk.nonce, 8);
  view.setUint32(8 + XCHACHA20_NONCE_BYTES, chunk.ciphertext.length, false);
  record.set(chunk.ciphertext, 8 + XCHACHA20_NONCE_BYTES + 4);
  record.set(chunk.sha256, 8 + XCHACHA20_NONCE_BYTES + 4 + chunk.ciphertext.length);

  return record;
}

/**
 * Utility: compare two Uint8Arrays
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

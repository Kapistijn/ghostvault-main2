/**
 * MODULE: XChaCha20-Poly1305 Encryption
 *
 * Verantwoordelijkheid:
 * - XChaCha20-Poly1305 encryptie/decryptie
 * - Streaming ondersteuning
 * - Parallel chunk encryptie
 * - AAD metadata voor integriteit
 * - HMAC-SHA256 voor extra authenticatie
 *
 * Gebruikt door:
 * - core/format/packer.ts
 * - core/format/unpacker.ts
 *
 * Afhankelijk van:
 * - @noble/ciphers
 * - core/crypto/kdf/argon2id.ts
 *
 * @module core/crypto/encryption/xchacha20
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha';

export const XCHACHA20_KEY_BYTES = 32;
export const XCHACHA20_NONCE_BYTES = 24;
export const XCHACHA20_TAG_BYTES = 16;
export const HMAC_SHA256_BYTES = 32;

// Precomputed hex lookup table (0x00-0xff -> '00'-'ff') for fast, allocation-
// light byte->hex conversion on the per-chunk hot path.
const HEX_TABLE: string[] = (() => {
  const t = new Array<string>(256);
  for (let i = 0; i < 256; i++) t[i] = i.toString(16).padStart(2, '0');
  return t;
})();

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX_TABLE[bytes[i]!];
  }
  return hex;
}

// Single shared encoder/decoder (avoids per-call allocation).
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// Track used nonces for reuse detection
const usedNonces = new Set<string>();
const MAX_NONCE_TRACKING = 10000; // Limit tracking to prevent memory issues

/**
 * Check if nonce has been used before (security measure).
 * Records the nonce only when it is new; clearing the set to stay under the
 * memory cap keeps the just-seen nonce so detection stays consistent.
 */
export function checkNonceReuse(nonce: Uint8Array): boolean {
  const nonceHex = bytesToHex(nonce);

  if (usedNonces.has(nonceHex)) {
    return true; // Nonce reuse detected
  }

  // Prevent unbounded memory growth.
  if (usedNonces.size >= MAX_NONCE_TRACKING) {
    usedNonces.clear();
  }

  usedNonces.add(nonceHex);
  return false;
}

/**
 * Clear nonce tracking (for testing or new session)
 */
export function clearNonceTracking(): void {
  usedNonces.clear();
}

export interface XChaChaResult {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  hmac?: Uint8Array;
}

export interface AADMetadata {
  fileName?: string;
  timestamp?: number;
  chunkIndex?: number;
  totalChunks?: number;
  checksum?: string;
}

/**
 * Encode AAD metadata naar bytes
 */
function encodeAAD(metadata: AADMetadata): Uint8Array {
  const parts: string[] = [];

  if (metadata.fileName) {
    parts.push(`fn:${metadata.fileName}`);
  }
  if (metadata.timestamp) {
    parts.push(`ts:${metadata.timestamp}`);
  }
  if (metadata.chunkIndex !== undefined) {
    parts.push(`ci:${metadata.chunkIndex}`);
  }
  if (metadata.totalChunks !== undefined) {
    parts.push(`tc:${metadata.totalChunks}`);
  }
  if (metadata.checksum) {
    parts.push(`cs:${metadata.checksum}`);
  }

  return TEXT_ENCODER.encode(parts.join('|'));
}

/**
 * Decode AAD metadata van bytes
 */
function decodeAAD(aad: Uint8Array): AADMetadata {
  const text = TEXT_DECODER.decode(aad);
  const parts = text.split('|');
  const metadata: AADMetadata = {};

  for (const part of parts) {
    const [key, value] = part.split(':');
    switch (key) {
      case 'fn':
        metadata.fileName = value;
        break;
      case 'ts':
        metadata.timestamp = parseInt(value, 10);
        break;
      case 'ci':
        metadata.chunkIndex = parseInt(value, 10);
        break;
      case 'tc':
        metadata.totalChunks = parseInt(value, 10);
        break;
      case 'cs':
        metadata.checksum = value;
        break;
    }
  }

  return metadata;
}

/**
 * Calculate checksum van data (SHA-256, hex-encoded)
 */
async function calculateChecksum(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return bytesToHex(new Uint8Array(hash));
}

/**
 * Build the buffer that HMAC covers: ciphertext || nonce (single allocation).
 */
function hmacInput(ciphertext: Uint8Array, nonce: Uint8Array): Uint8Array {
  const buf = new Uint8Array(ciphertext.length + nonce.length);
  buf.set(ciphertext, 0);
  buf.set(nonce, ciphertext.length);
  return buf;
}

/**
 * Calculate HMAC-SHA256 for extra authentication
 */
async function calculateHMAC(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (!key || key.length === 0) {
    throw new Error('HMAC key mag niet leeg zijn');
  }
  if (!data || data.length === 0) {
    throw new Error('HMAC data mag niet leeg zijn');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, data as unknown as BufferSource);
  return new Uint8Array(signature);
}

/**
 * Verify HMAC-SHA256 signature (constant-time)
 */
async function verifyHMAC(key: Uint8Array, data: Uint8Array, expectedHMAC: Uint8Array): Promise<boolean> {
  if (!key || key.length === 0) {
    throw new Error('HMAC key mag niet leeg zijn');
  }
  if (!data || data.length === 0) {
    throw new Error('HMAC data mag niet leeg zijn');
  }
  if (!expectedHMAC || expectedHMAC.length === 0) {
    throw new Error('HMAC signature mag niet leeg zijn');
  }

  const calculatedHMAC = await calculateHMAC(key, data);

  // Constant-time comparison to prevent timing attacks
  if (calculatedHMAC.length !== expectedHMAC.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < calculatedHMAC.length; i++) {
    result |= calculatedHMAC[i]! ^ expectedHMAC[i]!;
  }

  return result === 0;
}

/**
 * Encrypt data met XChaCha20-Poly1305 met AAD metadata en HMAC-SHA256
 */
export async function encryptXChaCha20(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
  nonce?: Uint8Array,
  metadata?: AADMetadata,
  enableHMAC: boolean = true
): Promise<XChaChaResult> {
  if (key.length !== XCHACHA20_KEY_BYTES) {
    throw new Error('XChaCha20 key must be 32 bytes');
  }

  const useNonce = nonce ?? crypto.getRandomValues(new Uint8Array(XCHACHA20_NONCE_BYTES));
  if (useNonce.length !== XCHACHA20_NONCE_BYTES) {
    throw new Error('XChaCha20 nonce must be 24 bytes');
  }

  // Check for nonce reuse (security measure)
  if (checkNonceReuse(useNonce)) {
    throw new Error('Nonce reuse detected - potential security issue');
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

  // Calculate HMAC if enabled
  let hmac: Uint8Array | undefined;
  if (enableHMAC) {
    hmac = await calculateHMAC(key, hmacInput(ciphertext, useNonce));
  }

  if (hmac) {
    return { ciphertext, nonce: useNonce, hmac };
  }
  return { ciphertext, nonce: useNonce };
}

/**
 * Decrypt data met XChaCha20-Poly1305 met AAD metadata validatie en HMAC-SHA256 verificatie
 */
export async function decryptXChaCha20(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
  expectedMetadata?: AADMetadata,
  expectedHMAC?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== XCHACHA20_KEY_BYTES) {
    throw new Error('XChaCha20 key must be 32 bytes');
  }
  if (nonce.length !== XCHACHA20_NONCE_BYTES) {
    throw new Error('XChaCha20 nonce must be 24 bytes');
  }

  // Verify HMAC if provided
  if (expectedHMAC) {
    const hmacValid = await verifyHMAC(key, hmacInput(ciphertext, nonce), expectedHMAC);
    if (!hmacValid) {
      throw new Error('HMAC verificatie mislukt');
    }
  }

  const cipher = xchacha20poly1305(key, nonce, aad);
  const plaintext = cipher.decrypt(ciphertext);

  // Validate metadata if provided
  if (expectedMetadata && aad) {
    const decodedMetadata = decodeAAD(aad);

    if (expectedMetadata.fileName && decodedMetadata.fileName !== expectedMetadata.fileName) {
      throw new Error('Filename mismatch in AAD');
    }

    if (expectedMetadata.timestamp && decodedMetadata.timestamp !== expectedMetadata.timestamp) {
      throw new Error('Timestamp mismatch in AAD');
    }

    if (expectedMetadata.chunkIndex !== undefined && decodedMetadata.chunkIndex !== expectedMetadata.chunkIndex) {
      throw new Error('Chunk index mismatch in AAD');
    }
  }

  return plaintext;
}

/**
 * Parallel encryptie van meerdere chunks met AAD metadata en HMAC-SHA256
 * Optimized: Batch processing with controlled concurrency
 *
 * NOTE: All chunks are processed. Memory is bounded by BATCH_SIZE batching
 * below, so there is no artificial cap that would silently drop chunks.
 */
export async function encryptChunksParallel(
  key: Uint8Array,
  chunks: Uint8Array[],
  aadPrefix?: string,
  fileName?: string,
  timestamp?: number,
  enableHMAC: boolean = true
): Promise<XChaChaResult[]> {
  const totalChunks = chunks.length;
  const timestampValue = timestamp ?? Date.now();

  // Process chunks in batches to avoid overwhelming the event loop
  const BATCH_SIZE = 100;
  const results: XChaChaResult[] = [];

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);

    const batchPromises = batch.map(async (chunk, batchIndex) => {
      const index = batchStart + batchIndex;
      const baseAAD = aadPrefix
        ? TEXT_ENCODER.encode(`${aadPrefix}/${index}`)
        : undefined;

      const checksum = await calculateChecksum(chunk);

      const metadata: AADMetadata = {
        fileName,
        timestamp: timestampValue,
        chunkIndex: index,
        totalChunks,
        checksum
      };

      return encryptXChaCha20(key, chunk, baseAAD, undefined, metadata, enableHMAC);
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Parallel decryptie van meerdere chunks met AAD metadata validatie en HMAC-SHA256 verificatie
 * Optimized: Batch processing with controlled concurrency
 */
export async function decryptChunksParallel(
  key: Uint8Array,
  chunks: { ciphertext: Uint8Array; nonce: Uint8Array; hmac?: Uint8Array }[],
  aadPrefix?: string,
  expectedFileName?: string,
  expectedTimestamp?: number
): Promise<Uint8Array[]> {
  // Process chunks in batches to avoid overwhelming the event loop
  const BATCH_SIZE = 100;
  const results: Uint8Array[] = [];

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);

    const batchPromises = batch.map(async (chunk, batchIndex) => {
      const index = batchStart + batchIndex;
      const baseAAD = aadPrefix
        ? TEXT_ENCODER.encode(`${aadPrefix}/${index}`)
        : undefined;

      const expectedMetadata: AADMetadata = {
        fileName: expectedFileName,
        timestamp: expectedTimestamp,
        chunkIndex: index
      };

      return decryptXChaCha20(key, chunk.ciphertext, chunk.nonce, baseAAD, expectedMetadata, chunk.hmac);
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

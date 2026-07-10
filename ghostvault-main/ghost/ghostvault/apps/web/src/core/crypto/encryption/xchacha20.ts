/**
 * MODULE: XChaCha20-Poly1305 Encryption
 *
 * Verantwoordelijkheid:
 * - XChaCha20-Poly1305 encryptie/decryptie
 * - Parallel chunk encryptie/decryptie
 * - Positie-gebonden AAD per chunk (voorkomt herordening)
 * - Optionele HMAC-SHA256 als extra authenticatielaag (standaard uit)
 *
 * BELANGRIJK: de AEAD-AAD moet aan beide kanten identiek en
 * reconstrueerbaar zijn. Daarom binden we ALLEEN de stabiele per-chunk tag
 * (bv. "GhostVault/v5/chunk/<index>") aan de Poly1305-tag - geen vluchtige
 * metadata zoals timestamp of plaintext-checksum, die de decrypter niet kan
 * reproduceren.
 *
 * XChaCha20-Poly1305 is een AEAD en authenticeert elke chunk al. De losse
 * HMAC-laag is optioneel en standaard uitgeschakeld (werd nooit opgeslagen).
 *
 * Gebruikt door:
 * - core/format/packer.ts
 * - core/format/unpacker.ts
 *
 * Afhankelijk van:
 * - @noble/ciphers
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

// Single shared encoder (avoids per-call allocation).
const TEXT_ENCODER = new TextEncoder();

// Track used nonces for reuse detection
const usedNonces = new Set<string>();
const MAX_NONCE_TRACKING = 10000; // Limit tracking to prevent memory issues

/**
 * Check if nonce has been used before (security measure).
 */
export function checkNonceReuse(nonce: Uint8Array): boolean {
  const nonceHex = bytesToHex(nonce);

  if (usedNonces.has(nonceHex)) {
    return true; // Nonce reuse detected
  }

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
 * Encrypt data met XChaCha20-Poly1305.
 *
 * De AEAD-AAD is exact de meegegeven `aad` (bv. de per-chunk positie-tag),
 * zodat de decrypter dezelfde AAD kan reconstrueren. Er wordt GEEN vluchtige
 * metadata aan de tag gebonden. HMAC is optioneel (standaard uit).
 */
export async function encryptXChaCha20(
  key: Uint8Array,
  plaintext: Uint8Array,
  aad?: Uint8Array,
  nonce?: Uint8Array,
  enableHMAC: boolean = false
): Promise<XChaChaResult> {
  if (key.length !== XCHACHA20_KEY_BYTES) {
    throw new Error('XChaCha20 key must be 32 bytes');
  }

  const useNonce = nonce ?? crypto.getRandomValues(new Uint8Array(XCHACHA20_NONCE_BYTES));
  if (useNonce.length !== XCHACHA20_NONCE_BYTES) {
    throw new Error('XChaCha20 nonce must be 24 bytes');
  }

  if (checkNonceReuse(useNonce)) {
    throw new Error('Nonce reuse detected - potential security issue');
  }

  const cipher = xchacha20poly1305(key, useNonce, aad);
  const ciphertext = cipher.encrypt(plaintext);

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
 * Decrypt data met XChaCha20-Poly1305.
 *
 * Gebruikt exact dezelfde `aad` als bij encryptie (symmetrisch), plus
 * optionele HMAC-verificatie wanneer een HMAC is meegegeven.
 */
export async function decryptXChaCha20(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array,
  expectedHMAC?: Uint8Array
): Promise<Uint8Array> {
  if (key.length !== XCHACHA20_KEY_BYTES) {
    throw new Error('XChaCha20 key must be 32 bytes');
  }
  if (nonce.length !== XCHACHA20_NONCE_BYTES) {
    throw new Error('XChaCha20 nonce must be 24 bytes');
  }

  if (expectedHMAC) {
    const hmacValid = await verifyHMAC(key, hmacInput(ciphertext, nonce), expectedHMAC);
    if (!hmacValid) {
      throw new Error('HMAC verificatie mislukt');
    }
  }

  const cipher = xchacha20poly1305(key, nonce, aad);
  return cipher.decrypt(ciphertext);
}

/**
 * Parallel encryptie van meerdere chunks.
 *
 * Elke chunk krijgt een positie-gebonden AAD (`<aadPrefix>/<index>`) zodat
 * de volgorde is geauthenticeerd. Alle chunks worden verwerkt; het geheugen
 * wordt begrensd door batch-gewijze verwerking (geen kunstmatige cap).
 *
 * HMAC staat standaard uit: XChaCha20-Poly1305 authenticeert al, en de
 * HMAC werd nooit in het formaat opgeslagen.
 */
export async function encryptChunksParallel(
  key: Uint8Array,
  chunks: Uint8Array[],
  aadPrefix?: string,
  _fileName?: string,
  _timestamp?: number,
  enableHMAC: boolean = false
): Promise<XChaChaResult[]> {
  const BATCH_SIZE = 100;
  const results: XChaChaResult[] = [];

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);

    const batchPromises = batch.map((chunk, batchIndex) => {
      const index = batchStart + batchIndex;
      const baseAAD = aadPrefix ? TEXT_ENCODER.encode(`${aadPrefix}/${index}`) : undefined;
      return encryptXChaCha20(key, chunk, baseAAD, undefined, enableHMAC);
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Parallel decryptie van meerdere chunks. Reconstrueert dezelfde
 * positie-gebonden AAD als bij encryptie.
 */
export async function decryptChunksParallel(
  key: Uint8Array,
  chunks: { ciphertext: Uint8Array; nonce: Uint8Array; hmac?: Uint8Array }[],
  aadPrefix?: string,
  _expectedFileName?: string,
  _expectedTimestamp?: number
): Promise<Uint8Array[]> {
  const BATCH_SIZE = 100;
  const results: Uint8Array[] = [];

  for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length);
    const batch = chunks.slice(batchStart, batchEnd);

    const batchPromises = batch.map((chunk, batchIndex) => {
      const index = batchStart + batchIndex;
      const baseAAD = aadPrefix ? TEXT_ENCODER.encode(`${aadPrefix}/${index}`) : undefined;
      return decryptXChaCha20(key, chunk.ciphertext, chunk.nonce, baseAAD, chunk.hmac);
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  return results;
}

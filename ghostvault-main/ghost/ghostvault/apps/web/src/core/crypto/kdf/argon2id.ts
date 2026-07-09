/**
 * MODULE: Argon2id Key Derivation
 *
 * Verantwoordelijkheid:
 * - Argon2id KDF implementatie
 * - Vervangt PBKDF2 voor betere beveiliging
 * - Parameters: t=3, m=64MB, p=4
 *
 * Gebruikt door:
 * - core/crypto/encryption/xchacha20.ts
 * - core/format/packer.ts
 *
 * Afhankelijk van:
 * - argon2-browser
 *
 * @module core/crypto/kdf/argon2id
 */

import * as argon2 from 'argon2-browser';

/**
 * Argon2id variant id.
 *
 * The bundled ESM build of argon2-browser does not always expose the
 * ArgonType enum on the namespace import, which caused a hard runtime
 * crash ("Cannot read properties of undefined (reading 'Argon2id')").
 * Resolve it defensively and fall back to the known enum value: in
 * argon2-browser ArgonType is { Argon2d: 0, Argon2i: 1, Argon2id: 2 }.
 */
const ARGON2ID_TYPE: number = (argon2 as any)?.ArgonType?.Argon2id ?? 2;

export interface Argon2idParams {
  salt?: Uint8Array;
  iterations: number;
  memory: number; // in KB
  parallelism: number;
  hashLength: number;
}

export interface Argon2idResult {
  hash: Uint8Array;
  encoded: string;
}

const DEFAULT_PARAMS: Omit<Argon2idParams, 'salt'> = {
  iterations: 3,
  memory: 64 * 1024, // 64MB
  parallelism: 4,
  hashLength: 32,
};

/**
 * Encode raw salt bytes into a lossless binary (Latin1) string.
 *
 * argon2-browser accepts the salt as a string. Decoding random bytes as
 * UTF-8 is lossy (invalid sequences become U+FFFD), which destroys salt
 * entropy. Mapping each byte to a char code preserves all 256 byte values
 * 1:1 and is fully deterministic across pack/unpack.
 */
function saltToBinaryString(salt: Uint8Array): string {
  let out = '';
  for (let i = 0; i < salt.length; i++) {
    out += String.fromCharCode(salt[i]!);
  }
  return out;
}

/**
 * Adaptive parameters op basis van device performance
 */
export function getAdaptiveParams(): Partial<Argon2idParams> {
  // Detecteer device capabilities
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;

  // Validate hardwareConcurrency
  const cores = navigator.hardwareConcurrency || 4;

  if (isMobile || isLowEnd) {
    return {
      iterations: Math.max(1, Math.min(2, 10)), // Clamp between 1-10
      memory: Math.max(8 * 1024, Math.min(32 * 1024, 512 * 1024)), // Clamp between 8MB-512MB
      parallelism: Math.max(1, Math.min(2, cores)), // Clamp between 1 and available cores
    };
  }

  // High-end device
  if (cores >= 8) {
    return {
      iterations: Math.max(1, Math.min(4, 10)), // Clamp between 1-10
      memory: Math.max(8 * 1024, Math.min(128 * 1024, 512 * 1024)), // Clamp between 8MB-512MB
      parallelism: Math.max(1, Math.min(6, cores)), // Clamp between 1 and available cores
    };
  }

  // Default (mid-range)
  return {
    iterations: Math.max(1, Math.min(3, 10)), // Clamp between 1-10
    memory: Math.max(8 * 1024, Math.min(64 * 1024, 512 * 1024)), // Clamp between 8MB-512MB
    parallelism: Math.max(1, Math.min(4, cores)), // Clamp between 1 and available cores
  };
}

/**
 * Genereer willekeurige salt
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive sleutel met Argon2id
 */
export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  params: Partial<Argon2idParams> = {}
): Promise<Argon2idResult> {
  const adaptiveParams = getAdaptiveParams();
  const finalParams: Argon2idParams = { ...DEFAULT_PARAMS, ...adaptiveParams, ...params, salt };

  const result = await argon2.hash({
    pass: password,
    salt: saltToBinaryString(salt),
    type: ARGON2ID_TYPE,
    mem: finalParams.memory,
    time: finalParams.iterations,
    parallelism: finalParams.parallelism,
    hashLen: finalParams.hashLength,
  });

  const hash = new TextEncoder().encode(result.hashHex);

  return {
    hash,
    encoded: result.hashHex,
  };
}

/**
 * Derive meerdere sleutels van één master key (HKDF-style met SHA-256)
 * Gebruikt Web Crypto API's HKDF voor betere security
 */
export async function deriveSubKeys(
  masterKey: Uint8Array,
  labels: string[]
): Promise<Uint8Array[]> {
  // Validate master key
  if (!masterKey || masterKey.length === 0) {
    throw new Error('Master key cannot be empty');
  }

  if (typeof masterKey.length !== 'number' || masterKey.length < 16) {
    throw new Error('Master key must be at least 16 bytes');
  }

  // Validate labels
  if (!labels || labels.length === 0) {
    throw new Error('Labels array cannot be empty');
  }

  if (!Array.isArray(labels)) {
    throw new Error('Labels must be an array');
  }

  const subKeys: Uint8Array[] = [];

  // Gebruik Web Crypto API's HKDF voor betere security
  for (const label of labels) {
    // Validate label
    if (typeof label !== 'string' || label.length === 0) {
      throw new Error('Each label must be a non-empty string');
    }

    const labelBytes = new TextEncoder().encode(label);
    const info = labelBytes;

    const key = await crypto.subtle.importKey(
      'raw',
      masterKey.buffer as ArrayBuffer,
      { name: 'HKDF' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0), // No salt for subkey derivation
        info: info
      },
      key,
      256 // 32 bytes
    );

    subKeys.push(new Uint8Array(derivedBits));
  }

  return subKeys;
}

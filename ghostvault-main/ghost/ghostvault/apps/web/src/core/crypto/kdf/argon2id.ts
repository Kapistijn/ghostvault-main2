/**
 * MODULE: Argon2id Key Derivation
 *
 * Verantwoordelijkheid:
 * - Argon2id KDF implementatie (deterministisch)
 * - Vervangt PBKDF2 voor betere beveiliging
 * - Vaste parameters: t=3, m=64MB, p=4, 32-byte hash
 *
 * BELANGRIJK: sleutelafleiding MOET deterministisch zijn. De parameters
 * worden niet in het .ghost-formaat opgeslagen, dus als ze per apparaat
 * zouden verschillen, kan een bestand op het ene apparaat niet op een
 * ander worden ontsleuteld. Daarom gebruiken we altijd vaste parameters.
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
import { EncryptionError } from '../../errors.js';

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

/**
 * Salt size in bytes. MUST match SALT_BYTES in the .ghost format (v6 = 64),
 * otherwise pack derives the key from a different-length salt than unpack
 * and every decryption fails.
 */
const SALT_LENGTH = 64;

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

/**
 * Vaste, deterministische parameters voor sleutelafleiding.
 * Wijzig deze NIET zonder een formaat-versiebump: bestaande .ghost
 * bestanden zijn afgeleid met deze exacte waarden.
 */
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
 * Adaptive parameters op basis van device performance.
 *
 * LET OP: gebruik dit NOOIT voor sleutelafleiding. De parameters worden
 * niet in het .ghost-formaat opgeslagen, dus device-afhankelijke waarden
 * maken bestanden niet-uitwisselbaar tussen apparaten. Dit is alleen
 * bedoeld voor niet-cryptografische afstemming (bijv. UI-schattingen).
 */
export function getAdaptiveParams(): Partial<Argon2idParams> {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
  const cores = navigator.hardwareConcurrency || 4;

  if (isMobile || isLowEnd) {
    return {
      iterations: Math.max(1, Math.min(2, 10)),
      memory: Math.max(8 * 1024, Math.min(32 * 1024, 512 * 1024)),
      parallelism: Math.max(1, Math.min(2, cores)),
    };
  }

  if (cores >= 8) {
    return {
      iterations: Math.max(1, Math.min(4, 10)),
      memory: Math.max(8 * 1024, Math.min(128 * 1024, 512 * 1024)),
      parallelism: Math.max(1, Math.min(6, cores)),
    };
  }

  return {
    iterations: Math.max(1, Math.min(3, 10)),
    memory: Math.max(8 * 1024, Math.min(64 * 1024, 512 * 1024)),
    parallelism: Math.max(1, Math.min(4, cores)),
  };
}

/**
 * Genereer willekeurige salt (64 bytes, conform het v6 .ghost formaat)
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Derive sleutel met Argon2id.
 *
 * Gebruikt ALTIJD vaste parameters (DEFAULT_PARAMS) zodat dezelfde
 * (password, salt) op elk apparaat exact dezelfde sleutel oplevert. De
 * `params`-parameter kan alleen de hashLength/expliciete waarden overschrijven
 * voor tests; voor normaal gebruik niet meegeven.
 */
export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  params: Partial<Argon2idParams> = {}
): Promise<Argon2idResult> {
  // Deterministisch: geen device-afhankelijke parameters.
  const finalParams: Argon2idParams = { ...DEFAULT_PARAMS, ...params, salt };

  try {
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
  } catch (error) {
    // Een falende wasm-load/exec mag niet als rauwe crash naar buiten komen.
    throw new EncryptionError('Sleutelafleiding (Argon2id) mislukt', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Derive meerdere sleutels van een master key (HKDF-style met SHA-256)
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

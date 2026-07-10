/**
 * MODULE: Streaming Decrypt
 *
 * Verantwoordelijkheid:
 * - Streaming/progressieve decryptie voor grote bestanden
 * - Per-chunk nonce (verplicht: XChaCha20 mag een nonce nooit hergebruiken)
 *
 * LET OP: dit is een op zichzelf staande helper. De hoofd-unpackflow
 * (unpackGhostV5) doet zijn eigen geverifieerde AEAD+HMAC-decryptie en
 * gebruikt deze module niet. Bewaard voor callers die progressieve
 * decryptie willen, zonder de eerdere onveilige fallbacks.
 *
 * Gebruikt door:
 * - (optioneel) externe callers
 *
 * Afhankelijk van:
 * - core/crypto/encryption/xchacha20.ts
 *
 * @module core/stream/streaming-decrypt
 */

import { decryptXChaCha20 } from '../crypto/encryption/xchacha20.js';

export interface StreamingDecryptOptions {
  key: Uint8Array;
  /** Per-chunk nonces. Index i hoort bij chunk i. Verplicht. */
  nonces: Uint8Array[];
  chunkSize?: number;
}

export interface DecryptProgress {
  decrypted: Uint8Array;
  position: number;
  total: number;
}

function requireNonce(nonces: Uint8Array[], index: number): Uint8Array {
  const nonce = nonces[index];
  if (!nonce) {
    throw new Error(
      `Ontbrekende nonce voor chunk ${index}. XChaCha20 vereist een unieke nonce per chunk.`
    );
  }
  return nonce;
}

/**
 * Streaming decryptie met TransformStream.
 * Elke chunk wordt ontsleuteld met zijn eigen nonce (options.nonces[i]).
 */
export function createStreamingDecrypt(
  options: StreamingDecryptOptions
): TransformStream<Uint8Array, Uint8Array> {
  if (!options.key || options.key.length === 0) {
    throw new Error('Streaming decrypt vereist een geldige sleutel');
  }

  let position = 0;
  let chunkIndex = 0;

  return new TransformStream({
    async transform(chunk, controller) {
      try {
        const nonce = requireNonce(options.nonces, chunkIndex);
        const decrypted = await decryptXChaCha20(options.key, chunk, nonce);
        controller.enqueue(decrypted);
        position += chunk.length;
        chunkIndex++;
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

/**
 * Progressieve decryptie - decrypt chunks terwijl ze binnenkomen.
 * Elke chunk gebruikt zijn eigen nonce (options.nonces[i]).
 */
export async function progressiveDecrypt(
  chunks: Uint8Array[],
  options: StreamingDecryptOptions,
  onProgress?: (progress: DecryptProgress) => void
): Promise<Uint8Array[]> {
  if (!options.key || options.key.length === 0) {
    throw new Error('Progressive decrypt vereist een geldige sleutel');
  }

  const results: Uint8Array[] = [];
  let totalDecrypted = 0;
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const nonce = requireNonce(options.nonces, i);

    const decrypted = await decryptXChaCha20(options.key, chunk, nonce);

    results.push(decrypted);
    totalDecrypted += chunk.length;

    onProgress?.({
      decrypted,
      position: totalDecrypted,
      total: totalSize,
    });
  }

  return results;
}

/**
 * MODULE: Streaming Decrypt
 *
 * Verantwoordelijkheid:
 *  - Streaming decryptie voor grote bestanden
 *  - Progressieve decryptie tijdens download
 *  - Seek functionaliteit voor specifieke posities
 *
 * Gebruikt door:
 *  - core/format/unpacker.ts
 *
 * Afhankelijk van:
 *  - core/crypto/encryption/xchacha20.ts
 *
 * @module core/stream/streaming-decrypt
 */

import { decryptXChaCha20 } from '../crypto/encryption/xchacha20.js';

export interface StreamingDecryptOptions {
  key: Uint8Array;
  nonce: Uint8Array;
  chunkSize?: number;
  nonces?: Uint8Array[]; // Array van nonces voor elke chunk
}

export interface DecryptProgress {
  decrypted: Uint8Array;
  position: number;
  total: number;
}

/**
 * Streaming decryptie met TransformStream
 * Let op: Elke chunk heeft zijn eigen nonce nodig voor XChaCha20
 */
export function createStreamingDecrypt(
  options: StreamingDecryptOptions
): TransformStream<Uint8Array, Uint8Array> {
  const chunkSize = options.chunkSize || 1024 * 1024; // 1MB default
  let position = 0;
  let chunkIndex = 0;

  return new TransformStream({
    async transform(chunk, controller) {
      try {
        // Gebruik specifieke nonce voor deze chunk als beschikbaar
        const nonce = options.nonces && options.nonces[chunkIndex]
          ? options.nonces[chunkIndex]
          : options.nonce;

        const decrypted = await decryptXChaCha20(
          options.key,
          chunk,
          nonce
        );
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
 * Progressieve decryptie - decrypt chunks terwijl ze binnenkomen
 * Let op: Elke chunk heeft zijn eigen nonce nodig
 */
export async function progressiveDecrypt(
  chunks: Uint8Array[],
  options: StreamingDecryptOptions,
  onProgress?: (progress: DecryptProgress) => void
): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];
  let totalDecrypted = 0;
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // Gebruik specifieke nonce voor deze chunk als beschikbaar
    const nonce = options.nonces && options.nonces[i]
      ? options.nonces[i]
      : options.nonce;

    const decrypted = await decryptXChaCha20(
      options.key,
      chunk,
      nonce
    );

    results.push(decrypted);
    totalDecrypted += chunk.length;

    onProgress?.({
      decrypted: decrypted,
      position: totalDecrypted,
      total: totalSize,
    });
  }

  return results;
}

/**
 * Seek naar specifieke positie in encrypted data
 * Let op: XChaCha20 is een stream cipher, dus seek is niet triviaal
 * Voor nu returnt dit de raw encrypted chunk - decryptie vereist volledige stream
 */
export function seekDecrypt(
  data: Uint8Array,
  position: number,
  options: StreamingDecryptOptions
): Uint8Array {
  const chunk = data.slice(position, position + (options.chunkSize || 1024 * 1024));
  // XChaCha20 is een stream cipher, dus seek vereist her-berekening van nonce
  // Dit is een beperking van de huidige implementatie
  throw new Error('Seek functionaliteit is niet geïmplementeerd voor XChaCha20 stream cipher - volledige stream decryptie vereist');
}

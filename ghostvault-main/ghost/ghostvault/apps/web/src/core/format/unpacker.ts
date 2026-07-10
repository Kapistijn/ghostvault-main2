/**
 * MODULE: Ghost Stream Unpacker
 *
 * Verantwoordelijkheid:
 * - Streaming unpacking van .ghost bestanden
 * - Decryptie pipeline orchestration
 * - Chunk parsing en reconstructie
 *
 * Gebruikt door:
 * - apps/web/src/ui/DecryptPanel
 *
 * Afhankelijk van:
 * - core/crypto/compression/zstd.ts
 * - core/crypto/encryption/xchacha20.ts
 * - core/stream/file-system-access.ts
 * - core/format/ghost.ts
 * - core/crypto/kdf/argon2id.ts
 * - core/errors.ts
 * - jszip
 *
 * @module core/format/unpacker
 */

import { decompressParallel } from '../crypto/compression/zstd.js';
import { decryptChunksParallel } from '../crypto/encryption/xchacha20.js';
import { openFileForWriting } from '../stream/file-system-access.js';
import { parseHeader, parseFooter, parseChunk, GHOST_VERSION, GHOST_HEADER_BYTES, MIN_PASSWORD_LENGTH } from './ghost.js';
import { deriveKeyArgon2id, deriveSubKeys } from '../crypto/kdf/argon2id.js';
import { getWorkerCount } from '../stream/adaptive-chunk.js';
import { DecryptionError, ValidationError, OperationCancelledError } from '../errors.js';
import JSZip from 'jszip';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

/** Same salt-bound AAD prefix the packer used, rebuilt from the header salt. */
function chunkAadPrefix(salt: Uint8Array): string {
  return `GhostVault/v6/${bytesToHex(salt)}/chunk`;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export interface UnpackOptions {
  password: string;
  secondPassword?: string;
  fileName?: string;
  cancellationToken?: AbortSignal;
  recoveryMode?: boolean;
}

export interface UnpackProgress {
  phase: 'reading' | 'decrypting' | 'decompressing' | 'writing' | 'verifying';
  percent: number;
  message?: string;
  verifiedChunks?: number;
  totalChunks?: number;
}

export type UnpackProgressCallback = (progress: UnpackProgress) => void;

/**
 * Unpack .ghost format v6 met streaming
 */
export async function unpackGhostV5(
  file: File,
  options: UnpackOptions,
  onProgress?: UnpackProgressCallback
): Promise<void> {
  const report = (phase: UnpackProgress['phase'], percent: number, message?: string) =>
    onProgress?.({ phase, percent, message });

  if (options.cancellationToken?.aborted) {
    throw new OperationCancelledError();
  }

  if (!options.password || options.password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn`);
  }

  if (!file || file.size === 0) {
    throw new ValidationError('Ongeldig bestand: bestand is leeg of niet geselecteerd');
  }

  report('reading', 0, 'Bestand lezen...');

  if (file.size > 10 * 1024 * 1024 * 1024) {
    console.warn(`Large file detected (${formatFileSize(file.size)}), using streaming mode`);
  }

  const buffer = new Uint8Array(await file.arrayBuffer());

  const header = parseHeader(buffer);
  if (header.version !== GHOST_VERSION) {
    throw new Error(`Unsupported .ghost version: ${header.version}`);
  }
  report('reading', 10, 'Header geparsed');

  const footer = parseFooter(buffer);
  report('reading', 20, 'Footer geparsed');

  const keyResult = await deriveKeyArgon2id(options.password, header.salt);
  const subKeys = await deriveSubKeys(keyResult.hash, ['encryption', 'manifest']);
  report('decrypting', 30, 'Sleutels afgeleid');

  // Chunk data starts right after the fixed header.
  const chunks: { ciphertext: Uint8Array; nonce: Uint8Array; sha256: Uint8Array }[] = [];
  let offset = GHOST_HEADER_BYTES;
  let corruptedChunks = 0;

  while (offset < buffer.length - footer.magicEnd.length - 8 - 8 - 32) {
    try {
      const chunk = parseChunk(buffer, offset);
      chunks.push({ ciphertext: chunk.ciphertext, nonce: chunk.nonce, sha256: chunk.sha256 });
      offset += 8 + 24 + 4 + chunk.ciphertext.length + 32;
    } catch (error) {
      if (options.recoveryMode) {
        corruptedChunks++;
        console.warn(`Corrupted chunk at offset ${offset}, skipping in recovery mode`);
        offset += 8 + 24 + 4 + 32;
        continue;
      } else {
        throw error;
      }
    }
  }

  if (options.recoveryMode && corruptedChunks > 0) {
    report('decrypting', 40, `${chunks.length} chunks gevonden (${corruptedChunks} corrupt, overgeslagen in recovery mode)`);
  } else {
    report('decrypting', 40, `${chunks.length} chunks gevonden`);
  }

  // Decrypt ALL chunks with the salt-bound AAD reconstructed from the header.
  report('decrypting', 45, 'Decrypten...');
  let decryptedChunks = await decryptChunksParallel(
    subKeys[0],
    chunks,
    chunkAadPrefix(header.salt)
  );

  // Double decryption if a second password is provided
  if (options.secondPassword) {
    report('decrypting', 50, 'Dubbele decryptie toepassen...');

    if (options.secondPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Tweede wachtwoord moet minimaal ${MIN_PASSWORD_LENGTH} tekens zijn`);
    }

    let secondSalt: Uint8Array | null = null;
    if (decryptedChunks.length > 0 && decryptedChunks[0].length > 33) {
      const firstChunk = decryptedChunks[0];
      if (firstChunk[0] === 0xFF) {
        secondSalt = firstChunk.subarray(1, 33);
        decryptedChunks[0] = firstChunk.subarray(33);
      }
    }

    if (!secondSalt) {
      throw new DecryptionError('Dubbele encryptie marker niet gevonden - bestand is niet dubbel versleuteld');
    }

    const secondKeyResult = await deriveKeyArgon2id(options.secondPassword, secondSalt);
    const secondSubKeys = await deriveSubKeys(secondKeyResult.hash, ['encryption']);

    decryptedChunks = await decryptChunksParallel(
      secondSubKeys[0],
      decryptedChunks.map((chunk, i) => ({ ciphertext: chunk, nonce: chunks[i].nonce })),
      `GhostVault/v6/${bytesToHex(secondSalt)}/double`
    );
  }

  report('decompressing', 60, 'Gedecrypt');
  report('decompressing', 65, 'Decomprimeren...');

  const originalSizes = decryptedChunks.map(() => 0);
  const decompressedChunks = await decompressParallel(
    decryptedChunks,
    originalSizes,
    getWorkerCount()
  );

  const decompressedSize = decompressedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  report('decompressing', 80, `Gedecomprimeerd: ${formatFileSize(decompressedSize)}`);

  // Combine
  report('verifying', 85, 'Bestandsintegriteit verifieren...');
  const totalSize = decompressedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combinedBuffer = new Uint8Array(totalSize);
  let bufferOffset = 0;
  for (const chunk of decompressedChunks) {
    combinedBuffer.set(chunk, bufferOffset);
    bufferOffset += chunk.length;
  }

  // Real end-to-end integrity check against the footer content hash.
  report('verifying', 90, 'Bestandsintegriteit verifieren...');
  const finalHash = await crypto.subtle.digest('SHA-256', combinedBuffer.buffer as ArrayBuffer);
  const finalHashArray = new Uint8Array(finalHash);

  if (!bytesEqual(finalHashArray, footer.fileHash)) {
    if (options.recoveryMode) {
      console.warn('Final file hash mismatch - continuing due to recovery mode');
      report('verifying', 90, 'Waarschuwing: hash mismatch (recovery mode)');
    } else {
      throw new DecryptionError('Bestandsintegriteit mislukt: hash mismatch. Bestand mogelijk beschadigd of verkeerd wachtwoord.');
    }
  } else {
    report('verifying', 90, 'Bestandsintegriteit geverifieerd');
  }

  // ZIP detection
  const isZip = combinedBuffer.length >= 4 &&
    combinedBuffer[0] === 0x50 &&
    combinedBuffer[1] === 0x4B &&
    (combinedBuffer[2] === 0x03 || combinedBuffer[2] === 0x05 || combinedBuffer[2] === 0x07) &&
    (combinedBuffer[3] === 0x04 || combinedBuffer[3] === 0x06 || combinedBuffer[3] === 0x08);

  if (isZip) {
    report('writing', 90, 'ZIP bestand gedetecteerd - uitpakken...');
    try {
      const zip = await JSZip.loadAsync(combinedBuffer);
      const files = Object.keys(zip.files);
      const outputZip = new JSZip();

      for (const filename of files) {
        const zipEntry = zip.files[filename];
        if (!zipEntry.dir) {
          const content = await zipEntry.async('uint8array');
          outputZip.file(filename, content);
        }
      }

      const outputBlob = await outputZip.generateAsync({ type: 'blob' });
      const handle = await openFileForWriting((options.fileName || file.name.replace('.ghost', '')) + '.zip');
      try {
        const arrayBuffer = await outputBlob.arrayBuffer();
        await handle.writable.write(new Uint8Array(arrayBuffer));
        report('writing', 100, 'ZIP uitgepakt met directory structuur');
      } finally {
        await handle.close();
      }
    } catch (error) {
      console.error('ZIP extraction error:', error);
      throw new Error('Fout bij uitpakken ZIP: ' + (error instanceof Error ? error.message : 'Onbekende fout'));
    }
  } else {
    report('writing', 90, 'Schrijven naar schijf...');
    const handle = await openFileForWriting(options.fileName || file.name.replace('.ghost', ''));
    try {
      const WRITE_BATCH_SIZE = 100;
      for (let i = 0; i < decompressedChunks.length; i += WRITE_BATCH_SIZE) {
        const batch = decompressedChunks.slice(i, i + WRITE_BATCH_SIZE);
        for (const chunk of batch) {
          await handle.writable.write(chunk as any);
        }
        const progress = 90 + ((i + batch.length) / decompressedChunks.length) * 10;
        report('writing', Math.min(100, progress), `Schrijven: ${i + batch.length}/${decompressedChunks.length} chunks`);
      }
      report('writing', 100, 'Klaar');
    } finally {
      await handle.close();
    }
  }
}

/**
 * Validate .ghost file integrity
 */
export async function validateGhostV5(file: File): Promise<boolean> {
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    const header = parseHeader(buffer);
    parseFooter(buffer);
    return header.version === GHOST_VERSION;
  } catch {
    return false;
  }
}

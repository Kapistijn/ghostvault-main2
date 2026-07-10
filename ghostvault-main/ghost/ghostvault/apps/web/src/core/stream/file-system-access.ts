/**
 * MODULE: File System Access API
 *
 * Verantwoordelijkheid:
 * - Directe schrijftoegang naar schijf voor 1TB+ bestanden (waar beschikbaar)
 * - Fallback naar Blob-download voor browsers zonder File System Access API
 * - Streaming naar schijf i.p.v. RAM waar mogelijk
 *
 * Gebruikt door:
 * - core/format/packer.ts
 * - core/format/unpacker.ts
 *
 * Afhankelijk van:
 * - core/types/index.ts
 *
 * @module core/stream/file-system-access
 */

import type { FileSystemAccessHandle } from '../types/index.js';
import { OperationCancelledError } from '../errors.js';

/**
 * Check of de File System Access API beschikbaar is.
 * Guard tegen SSR / non-window contexts.
 */
export function isFileSystemAccessAvailable(): boolean {
  return typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    'showOpenFilePicker' in window;
}

/**
 * Type voor File System Access API
 */
interface FileSystemAccessAPI {
  showSaveFilePicker: (options: any) => Promise<FileSystemFileHandle>;
  showOpenFilePicker: (options: any) => Promise<FileSystemFileHandle[]>;
}

/**
 * Trigger een browser-download van een Blob (fallback zonder FS Access API).
 */
function triggerBlobDownload(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Revoke asynchronously so the download has time to start.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/**
 * Minimale WritableStream-achtige sink die alle chunks in geheugen verzamelt
 * en bij close() een Blob-download start. Gebruikt als fallback wanneer de
 * File System Access API niet beschikbaar is.
 */
function createBlobWritable(fileName: string, mimeType: string): FileSystemWritableFileStream {
  const parts: BlobPart[] = [];

  const sink = {
    write(chunk: any): Promise<void> {
      // Ondersteun zowel { type: 'write', data } als rauwe chunks.
      const data = chunk && typeof chunk === 'object' && 'data' in chunk ? chunk.data : chunk;
      if (data != null) {
        // Kopieer Uint8Array views zodat hergebruikte buffers niet muteren.
        if (data instanceof Uint8Array) {
          parts.push(data.slice());
        } else {
          parts.push(data);
        }
      }
      return Promise.resolve();
    },
    seek(_position: number): Promise<void> {
      // Niet ondersteund in de Blob-fallback; genegeerd.
      return Promise.resolve();
    },
    truncate(_size: number): Promise<void> {
      return Promise.resolve();
    },
    close(): Promise<void> {
      triggerBlobDownload(fileName, new Blob(parts, { type: mimeType }));
      parts.length = 0;
      return Promise.resolve();
    },
    abort(): Promise<void> {
      parts.length = 0;
      return Promise.resolve();
    },
  };

  return sink as unknown as FileSystemWritableFileStream;
}

/**
 * Open bestand voor schrijven. Gebruikt de File System Access API waar
 * beschikbaar (echte streaming naar schijf), anders een Blob-download-fallback
 * zodat de app ook in Firefox/Safari werkt.
 */
export async function openFileForWriting(
  fileName: string,
  mimeType: string = 'application/octet-stream'
): Promise<FileSystemAccessHandle> {
  if (isFileSystemAccessAvailable()) {
    const api = window as unknown as FileSystemAccessAPI;
    try {
      const handle = await api.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'GhostVault File',
            accept: { [mimeType]: ['.ghost'] },
          },
        ],
      });

      const writable = await handle.createWritable();
      return {
        writable,
        close: async () => {
          await writable.close();
        },
      };
    } catch (error) {
      // De gebruiker die de save-dialog annuleert is een echte annulering,
      // geen fout die we als 'API niet beschikbaar' moeten maskeren.
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new OperationCancelledError('Opslaan geannuleerd door gebruiker');
      }
      // Anders: val terug op de Blob-download hieronder.
      console.warn('File System Access save failed, falling back to Blob download:', error);
    }
  }

  // Fallback: verzamel in geheugen en download als Blob bij close().
  const writable = createBlobWritable(fileName, mimeType);
  return {
    writable,
    close: async () => {
      await writable.close();
    },
  };
}

/**
 * Open bestand voor lezen via File System Access API.
 */
export async function openFileForReading(): Promise<File> {
  if (!isFileSystemAccessAvailable()) {
    throw new Error('File System Access API not available');
  }

  const api = window as unknown as FileSystemAccessAPI;
  const [handle] = await api.showOpenFilePicker({
    types: [
      {
        description: 'GhostVault File',
        accept: { 'application/octet-stream': ['.ghost'] },
      },
    ],
  });

  const file = await handle.getFile();
  return file;
}

/**
 * Schrijf een stream naar schijf (geen RAM-buffering bij de native writer).
 * Bij een fout wordt de writable afgebroken zodat er geen half bestand
 * blijft staan.
 */
export async function writeStreamToDisk(
  stream: ReadableStream<Uint8Array>,
  handle: FileSystemAccessHandle
): Promise<void> {
  const writer = handle.writable.getWriter();
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
    }
    await writer.close();
  } catch (error) {
    // Voorkom een half-geschreven bestand: breek de writer af.
    try {
      await writer.abort(error);
    } catch {
      /* ignore secondary abort errors */
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Lees stream van schijf.
 */
export async function readStreamFromDisk(
  file: File
): Promise<ReadableStream<Uint8Array>> {
  return file.stream() as ReadableStream<Uint8Array>;
}

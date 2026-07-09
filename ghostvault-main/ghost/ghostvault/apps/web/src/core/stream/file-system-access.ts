/**
 * MODULE: File System Access API
 *
 * Verantwoordelijkheid:
 *  - Directe schrijftoegang naar schijf voor 1TB+ bestanden
 *  - Fallback naar Blob voor oudere browsers
 *  - Streaming naar schijf, niet naar RAM
 *
 * Gebruikt door:
 *  - core/format/packer.ts
 *  - core/format/unpacker.ts
 *
 * Afhankelijk van:
 *  - core/types/index.ts
 *
 * @module core/stream/file-system-access
 */

import type { FileSystemAccessHandle } from '../types/index.js';

/**
 * Check of File System Access API beschikbaar is
 */
export function isFileSystemAccessAvailable(): boolean {
  return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
}

/**
 * Type voor File System Access API
 */
interface FileSystemAccessAPI {
  showSaveFilePicker: (options: any) => Promise<FileSystemFileHandle>;
  showOpenFilePicker: (options: any) => Promise<FileSystemFileHandle[]>;
}

/**
 * Open bestand voor schrijven via File System Access API
 */
export async function openFileForWriting(
  fileName: string,
  mimeType: string = 'application/octet-stream'
): Promise<FileSystemAccessHandle> {
  if (!isFileSystemAccessAvailable()) {
    throw new Error('File System Access API not available');
  }

  const api = window as unknown as FileSystemAccessAPI;
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
}

/**
 * Open bestand voor lezen via File System Access API
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
 * Schrijf stream naar schijf (geen RAM buffering)
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
  } finally {
    await writer.close();
  }
}

/**
 * Lees stream van schijf
 */
export async function readStreamFromDisk(
  file: File
): Promise<ReadableStream<Uint8Array>> {
  return file.stream() as ReadableStream<Uint8Array>;
}

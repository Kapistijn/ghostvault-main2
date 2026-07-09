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
import { getLogger } from '../utils/logger.js';

const logger = getLogger('file-system-access');

/**
 * Check of File System Access API beschikbaar is
 */
export function isFileSystemAccessAvailable(): boolean {
  return 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
}

/**
 * Open bestand voor schrijven via File System Access API
 */
export async function openFileForWriting(
  fileName: string,
  mimeType: string = 'application/octet-stream'
): Promise<FileSystemAccessHandle> {
  logger.info('openFileForWriting gestart', { fileName, mimeType });

  // Validate fileName
  if (!fileName || fileName.length === 0) {
    logger.error('Bestandsnaam mag niet leeg zijn', undefined, { fileName });
    throw new Error('Bestandsnaam mag niet leeg zijn');
  }
  
  if (fileName.length > 255) {
    logger.error('Bestandsnaam te lang (max 255 karakters)', undefined, { fileNameLength: fileName.length });
    throw new Error('Bestandsnaam te lang (max 255 karakters)');
  }
  
  // Validate fileName for invalid characters
  const invalidChars = /[<>:"/\\|?*]/;
  if (invalidChars.test(fileName)) {
    logger.error('Bestandsnaam bevat ongeldige karakters', undefined, { fileName });
    throw new Error('Bestandsnaam bevat ongeldige karakters');
  }
  
  // Validate mimeType
  if (!mimeType || mimeType.length === 0) {
    logger.error('MIME type mag niet leeg zijn', undefined, { mimeType });
    throw new Error('MIME type mag niet leeg zijn');
  }
  
  if (mimeType.length > 255) {
    logger.error('MIME type te lang (max 255 karakters)', undefined, { mimeTypeLength: mimeType.length });
    throw new Error('MIME type te lang (max 255 karakters)');
  }
  
  if (!isFileSystemAccessAvailable()) {
    logger.error('File System Access API niet beschikbaar', undefined, { 
      hasShowSaveFilePicker: 'showSaveFilePicker' in window,
      hasShowOpenFilePicker: 'showOpenFilePicker' in window 
    });
    throw new Error('File System Access API niet beschikbaar');
  }

  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description: 'GhostVault Bestand',
          accept: { [mimeType]: ['.ghost'] },
        },
      ],
    });

    const writable = await handle.createWritable();

    logger.info('openFileForWriting voltooid', { fileName });

    return {
      writable,
      close: async () => {
        await writable.close();
        logger.debug('Bestand gesloten', { fileName });
      },
    };
  } catch (error) {
    logger.error('Fout bij openen bestand voor schrijven', error as Error, { fileName });
    throw error;
  }
}

/**
 * Open bestand voor lezen via File System Access API
 */
export async function openFileForReading(): Promise<File> {
  logger.info('openFileForReading gestart');

  if (!isFileSystemAccessAvailable()) {
    logger.error('File System Access API niet beschikbaar', undefined, { 
      hasShowSaveFilePicker: 'showSaveFilePicker' in window,
      hasShowOpenFilePicker: 'showOpenFilePicker' in window 
    });
    throw new Error('File System Access API niet beschikbaar');
  }

  try {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [
        {
          description: 'GhostVault Bestand',
          accept: { 'application/octet-stream': ['.ghost'] },
        },
      ],
    });

    const file = await handle.getFile();
    
    logger.info('openFileForReading voltooid', { 
      fileName: file.name,
      fileSize: file.size 
    });
    
    return file;
  } catch (error) {
    logger.error('Fout bij openen bestand voor lezen', error as Error);
    throw error;
  }
}

/**
 * Schrijf stream naar schijf (geen RAM buffering)
 */
export async function writeStreamToDisk(
  stream: ReadableStream<Uint8Array>,
  handle: FileSystemAccessHandle
): Promise<void> {
  logger.info('writeStreamToDisk gestart', { 
    hasStream: !!stream,
    hasHandle: !!handle,
    hasWritable: !!handle?.writable 
  });

  if (!stream) {
    logger.error('Stream mag niet null of undefined zijn', undefined, { stream });
    throw new Error('Stream mag niet null of undefined zijn');
  }
  
  if (!handle || !handle.writable) {
    logger.error('Handle of writable is ongeldig', undefined, { 
      hasHandle: !!handle,
      hasWritable: !!handle?.writable 
    });
    throw new Error('Handle of writable is ongeldig');
  }
  
  const writer = handle.writable.getWriter();
  const reader = stream.getReader();
  
  let totalBytesWritten = 0;
  let chunkCount = 0;

  try {
    // Use a buffer to reduce write operations
    const BUFFER_SIZE = 1024 * 1024; // 1MB buffer
    const buffer = new Uint8Array(BUFFER_SIZE);
    let bufferOffset = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      if (!value || value.length === 0) {
        logger.debug('Lege chunk overgeslagen', { chunkCount });
        continue; // Skip empty chunks
      }
      
      // Validate chunk size to prevent memory issues
      if (value.length > 100 * 1024 * 1024) { // Max 100MB per chunk
        logger.error('Chunk te groot (max 100MB)', undefined, { 
          chunkLength: value.length,
          chunkCount 
        });
        throw new Error('Chunk te groot (max 100MB)');
      }
      
      // Write directly if chunk is larger than buffer
      if (value.length >= BUFFER_SIZE) {
        // Flush buffer first if it has data
        if (bufferOffset > 0) {
          const bufferToWrite = buffer.subarray(0, bufferOffset);
          // Validate buffer before writing
          if (!bufferToWrite || bufferToWrite.length === 0) {
            logger.error('Failed to flush buffer: buffer is empty', undefined, { bufferOffset });
            throw new Error('Failed to flush buffer: buffer is empty');
          }
          await writer.write(bufferToWrite);
          totalBytesWritten += bufferToWrite.length;
          bufferOffset = 0;
        }
        await writer.write(value);
        totalBytesWritten += value.length;
        chunkCount++;
      } else {
        // Add to buffer
        if (bufferOffset + value.length > BUFFER_SIZE) {
          // Flush buffer
          const bufferToWrite = buffer.subarray(0, bufferOffset);
          // Validate buffer before writing
          if (!bufferToWrite || bufferToWrite.length === 0) {
            logger.error('Failed to flush buffer: buffer is empty', undefined, { bufferOffset });
            throw new Error('Failed to flush buffer: buffer is empty');
          }
          await writer.write(bufferToWrite);
          totalBytesWritten += bufferToWrite.length;
          bufferOffset = 0;
        }
        // Validate value fits in buffer before setting
        if (bufferOffset + value.length > BUFFER_SIZE) {
          logger.error('Value too large for buffer, cannot fit even after flush', undefined, { 
            bufferOffset, 
            valueLength: value.length, 
            bufferSize: BUFFER_SIZE 
          });
          throw new Error('Value too large for buffer');
        }
        buffer.set(value, bufferOffset);
        bufferOffset += value.length;
      }
    }
    
    // Flush remaining buffer
    if (bufferOffset > 0) {
      const bufferToWrite = buffer.subarray(0, bufferOffset);
      // Validate buffer before writing
      if (!bufferToWrite || bufferToWrite.length === 0) {
        logger.error('Failed to flush final buffer: buffer is empty', undefined, { bufferOffset });
        throw new Error('Failed to flush final buffer: buffer is empty');
      }
      await writer.write(bufferToWrite);
      totalBytesWritten += bufferToWrite.length;
    }
    
    logger.info('writeStreamToDisk voltooid', { 
      totalBytesWritten,
      chunkCount 
    });
  } catch (error) {
    logger.error('Fout bij schrijven stream naar schijf', error as Error, { 
      totalBytesWritten,
      chunkCount 
    });
    throw error;
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
  logger.info('readStreamFromDisk gestart', { 
    fileName: file?.name,
    fileSize: file?.size 
  });

  if (!file) {
    logger.error('File cannot be null or undefined', undefined, { file });
    throw new Error('File cannot be null or undefined');
  }
  
  if (file.size === 0) {
    logger.warn('File is empty, allowing for empty file operations', { fileName: file.name });
    // Allow empty files - they may be valid in some contexts
    // The caller can decide whether to reject empty files
  }
  
  if (file.size > 10 * 1024 * 1024 * 1024) { // Max 10GB
    logger.error('File too large (max 10GB)', undefined, { 
      fileName: file.name,
      fileSize: file.size 
    });
    throw new Error('File too large (max 10GB)');
  }
  
  // Create a transform stream to chunk the data for better performance
  const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
  const baseStream = file.stream() as ReadableStream<Uint8Array>;
  
  // Validate base stream exists
  if (!baseStream) {
    logger.error('File stream is null or undefined', undefined, { fileName: file.name });
    throw new Error('File stream is null or undefined');
  }
  
  let totalBytesRead = 0;
  let chunkCount = 0;
  
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = baseStream.getReader();
      const buffer = new Uint8Array(CHUNK_SIZE);
      let bufferOffset = 0;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Flush remaining buffer
            if (bufferOffset > 0) {
              controller.enqueue(buffer.subarray(0, bufferOffset));
              totalBytesRead += bufferOffset;
            }
            logger.info('readStreamFromDisk voltooid', { 
              totalBytesRead,
              chunkCount 
            });
            controller.close();
            break;
          }
          
          if (!value || value.length === 0) {
            logger.debug('Lege chunk overgeslagen', { chunkCount });
            continue;
          }
          
          // Add to buffer
          let valueOffset = 0;
          while (valueOffset < value.length) {
            const remainingSpace = CHUNK_SIZE - bufferOffset;
            const bytesToCopy = Math.min(remainingSpace, value.length - valueOffset);
            
            // Validate bytesToCopy is positive
            if (bytesToCopy <= 0) {
              logger.error('bytesToCopy is niet positief', undefined, { 
                bytesToCopy,
                remainingSpace,
                valueLength: value.length,
                valueOffset 
              });
              break;
            }
            
            buffer.set(value.subarray(valueOffset, valueOffset + bytesToCopy), bufferOffset);
            bufferOffset += bytesToCopy;
            valueOffset += bytesToCopy;
            
            // Flush buffer if full
            if (bufferOffset >= CHUNK_SIZE) {
              const chunkToEnqueue = new Uint8Array(buffer.subarray(0, bufferOffset));
              // Validate chunk before enqueuing
              if (!chunkToEnqueue || chunkToEnqueue.length === 0) {
                logger.error('Failed to create chunk: chunk is empty', undefined, { bufferOffset });
                throw new Error('Failed to create chunk: chunk is empty');
              }
              controller.enqueue(chunkToEnqueue);
              totalBytesRead += chunkToEnqueue.length;
              chunkCount++;
              bufferOffset = 0;
            }
          }
        }
      } catch (error) {
        logger.error('Fout bij lezen stream van schijf', error as Error, { 
          totalBytesRead,
          chunkCount 
        });
        controller.error(error);
      }
    },
  });
}

/**
 * Web Worker for Encryption Operations
 * Offloads heavy encryption computations to a separate thread
 */

let encryptionKey: Uint8Array | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  try {
    switch (type) {
      case 'setKey':
        // Validate key data
        if (!data || !(data instanceof Uint8Array) || data.length !== 32) {
          throw new Error('Invalid encryption key: must be 32 bytes');
        }
        encryptionKey = new Uint8Array(data);
        self.postMessage({ type: 'keySet', success: true });
        break;

      case 'encryptChunk':
        if (!encryptionKey) {
          throw new Error('Encryption key not set');
        }
        // Validate input data
        if (!data || !data.plaintext || !(data.plaintext instanceof Uint8Array)) {
          throw new Error('Invalid plaintext data');
        }
        if (data.plaintext.length === 0) {
          throw new Error('Plaintext cannot be empty');
        }
        if (data.plaintext.length > 100 * 1024 * 1024) {
          throw new Error('Plaintext too large (max 100MB)');
        }
        const encrypted = await encryptChunk(data.plaintext, data.nonce, data.aad);
        self.postMessage({ type: 'encryptResult', data: encrypted, chunkId: data.chunkId });
        break;

      case 'decryptChunk':
        if (!encryptionKey) {
          throw new Error('Encryption key not set');
        }
        // Validate input data
        if (!data || !data.ciphertext || !(data.ciphertext instanceof Uint8Array)) {
          throw new Error('Invalid ciphertext data');
        }
        if (data.ciphertext.length === 0) {
          throw new Error('Ciphertext cannot be empty');
        }
        if (data.ciphertext.length > 100 * 1024 * 1024) {
          throw new Error('Ciphertext too large (max 100MB)');
        }
        const decrypted = await decryptChunk(data.ciphertext, data.nonce, data.aad);
        self.postMessage({ type: 'decryptResult', data: decrypted, chunkId: data.chunkId });
        break;

      case 'encryptBatch':
        if (!encryptionKey) {
          throw new Error('Encryption key not set');
        }
        // Validate input data
        if (!data || !data.chunks || !Array.isArray(data.chunks)) {
          throw new Error('Invalid chunks data');
        }
        if (data.chunks.length === 0) {
          throw new Error('Chunks array cannot be empty');
        }
        if (data.chunks.length > 10000) {
          throw new Error('Too many chunks (max 10000)');
        }
        const batchEncrypted = await encryptBatch(data.chunks, data.nonces, data.aads);
        self.postMessage({ type: 'encryptBatchResult', data: batchEncrypted });
        break;

      case 'decryptBatch':
        if (!encryptionKey) {
          throw new Error('Encryption key not set');
        }
        // Validate input data
        if (!data || !data.chunks || !Array.isArray(data.chunks)) {
          throw new Error('Invalid chunks data');
        }
        if (data.chunks.length === 0) {
          throw new Error('Chunks array cannot be empty');
        }
        if (data.chunks.length > 10000) {
          throw new Error('Too many chunks (max 10000)');
        }
        const batchDecrypted = await decryptBatch(data.chunks, data.nonces, data.aads);
        self.postMessage({ type: 'decryptBatchResult', data: batchDecrypted });
        break;

      case 'calculateChecksum':
        const checksum = calculateChecksum(data);
        self.postMessage({ type: 'checksumResult', data: checksum, chunkId: data.chunkId });
        break;

      case 'calculateChecksums':
        const checksums = calculateChecksums(data.chunks);
        self.postMessage({ type: 'checksumsResult', data: checksums });
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      chunkId: data?.chunkId
    });
  }
};

async function encryptChunk(
  plaintext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  // Import xchacha20poly1305 dynamically
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha');
  
  const cipher = xchacha20poly1305(encryptionKey!, nonce, aad);
  const ciphertext = cipher.encrypt(plaintext);
  
  return { ciphertext, nonce };
}

async function decryptChunk(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  aad?: Uint8Array
): Promise<Uint8Array> {
  // Import xchacha20poly1305 dynamically
  const { xchacha20poly1305 } = await import('@noble/ciphers/chacha');
  
  const cipher = xchacha20poly1305(encryptionKey!, nonce, aad);
  const plaintext = cipher.decrypt(ciphertext);
  
  return plaintext;
}

async function encryptBatch(
  chunks: Uint8Array[],
  nonces: Uint8Array[],
  aads?: Uint8Array[]
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }[]> {
  const results: { ciphertext: Uint8Array; nonce: Uint8Array }[] = [];
  
  // Process in batches to avoid overwhelming memory
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, chunks.length);
    
    for (let j = i; j < batchEnd; j++) {
      const result = await encryptChunk(chunks[j], nonces[j], aads?.[j]);
      results.push(result);
    }
    
    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return results;
}

async function decryptBatch(
  chunks: Uint8Array[],
  nonces: Uint8Array[],
  aads?: Uint8Array[]
): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];
  
  // Process in batches to avoid overwhelming memory
  const BATCH_SIZE = 10;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, chunks.length);
    
    for (let j = i; j < batchEnd; j++) {
      const result = await decryptChunk(chunks[j], nonces[j], aads?.[j]);
      results.push(result);
    }
    
    // Yield to event loop
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  
  return results;
}

function calculateChecksum(data: Uint8Array): string {
  if (!data || data.length === 0) {
    return '00';
  }
  
  // Simple checksum: XOR van alle bytes
  let checksum = 0;
  for (let i = 0; i < data.length; i++) {
    checksum ^= data[i]!;
  }
  return checksum.toString(16).padStart(2, '0');
}

function calculateChecksums(chunks: Uint8Array[]): string[] {
  return chunks.map(chunk => calculateChecksum(chunk));
}

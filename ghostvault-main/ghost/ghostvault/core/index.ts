/**
 * MODULE: Core Library Index
 *
 * Verantwoordelijkheid:
 *  - Export alle core library modules
 *  - Centrale entry point voor @ghostvault/core
 *
 * Gebruikt door:
 *  - apps/web
 *  - server
 *
 * Afhankelijk van:
 *  - Alle core modules
 *
 * @module core/index
 */

// Types
export * from './types/index.js';

// Stream
export * from './stream/adaptive-chunk.js';
export * from './stream/file-system-access.js';

// Crypto - KDF
export * from './crypto/kdf/argon2id.js';

// Crypto - Encryption
export * from './crypto/encryption/xchacha20.js';

// Crypto - Compression
export * from './crypto/compression/zstd.js';

// Format
export { packToGhostV5, unpackGhostV5, validateGhostV5 } from './format/index.js';

// Utils
export * from './utils/logger.js';

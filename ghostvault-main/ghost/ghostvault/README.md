# GhostVault v2.2.5

Streaming-based encrypted file storage for large files (1TB+).

## Features

- **Streaming-first:** No full files in RAM
- **No artificial limits:** File size limited only by browser, OS, storage, RAM, network
- **Modular:** Clear separation of concerns
- **AI-friendly:** Self-documenting code with module headers and .ai/ database
- **Transfer management:** Pause, resume, retry, checksums, queue
- **File System Access API:** Direct disk access for 1TB+ files
- **Multi-threading:** CPU cores detection, cores-2 usage
- **Adaptive chunking:** Automatic chunk size (4MB-64MB)
- **Compression presets:** Pre-configured compression levels (none, fast, default, good, ultra, maximum, extreme)
- **Adaptive compression:** Automatic level selection based on file type and size
- **Compression statistics:** Optional collection of compression metrics
- **React Error Boundary:** Graceful error handling with user-friendly error messages
- **Loading states:** Improved loading indicators with progress bars
- **Drag & drop:** Drag and drop support for file uploads
- **Service Worker:** Offline support and caching for better performance
- **TypeScript strict mode:** Enhanced type safety with strictNullChecks and noImplicitAny
- **Unit tests:** Vitest testing framework for core library

## Security

- **Encryption:** XChaCha20-Poly1305
- **Key derivation:** Argon2id (t=10, m=256MB, p=8, salt=64 bytes)
- **Compression:** Zstandard (zstd) with levels 0-22
- **Input validation:** Comprehensive validation for passwords, file names, and user inputs
- **Memory wiping:** Secure memory sanitization with multiple overwrite passes
- **Content Security Policy:** CSP headers for enhanced web security

## Installation

```bash
npm install
npm run build
npm run dev
```

## Usage

```typescript
import { packToGhostV5, unpackGhostV5 } from '@ghostvault/core';

// Pack a file
await packToGhostV5(file, {
  password: 'my-password',
  compressionLevel: 3,
  fileName: 'output.ghost'
}, (progress) => {
  console.log(`${progress.phase}: ${progress.percent}%`);
});

// Unpack a file
await unpackGhostV5(ghostFile, {
  password: 'my-password',
  fileName: 'output.txt'
}, (progress) => {
  console.log(`${progress.phase}: ${progress.percent}%`);
});
```

## Compression Presets

```typescript
import { getCompressionLevel } from '@ghostvault/core';

// Use presets for easy configuration
const level = getCompressionLevel('default'); // Returns 3
const ultraLevel = getCompressionLevel('ultra'); // Returns 12
const extremeLevel = getCompressionLevel('extreme'); // Returns 22
```

## Testing

```bash
# Run unit tests
npm run test

# Run tests with coverage
npm run test:coverage
```

## Architecture

See [ARCHITECTUUR.md](./ARCHITECTUUR.md) for detailed architecture documentation.

## Development

```bash
# Generate AI architecture database
npm run generate-ai-db

# Generate documentation
npm run generate-docs

# Run tests
npm test
```

## Recent Improvements

- **Performance:** Optimized bundle size by splitting large dependencies into smaller chunks
- **Type Safety:** Added TypeScript strict mode (strictNullChecks, noImplicitAny)
- **Testing:** Added Vitest testing framework for core library
- **UI/UX:** Improved loading states with LoadingSpinner and ProgressBar components
- **Error Handling:** Added React Error Boundary for graceful error handling
- **User Experience:** Added drag & drop support for file uploads
- **Performance:** Added service worker for offline support and caching
- **Error Messages:** Improved error messages with context-specific suggestions
- **Compression:** Added compression presets and adaptive level selection
- **Statistics:** Added optional compression statistics collection

## License

See LICENSE.md for details.

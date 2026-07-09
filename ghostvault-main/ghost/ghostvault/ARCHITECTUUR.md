# GhostVault v2 Architectuur

Dit document beschrijft de volledige architectuur van GhostVault v2, een streaming-based encrypted file storage systeem ontworpen voor grote bestanden (1TB+).

## Overzicht

GhostVault v2 is een volledige herbouw van GhostVault v1 met de volgende kernprincipes:
- **Streaming-first:** Geen volledige bestanden in RAM
- **Geen kunstmatige limieten:** Bestandsgrootte bepaald door fysieke beperkingen (browser, OS, opslag, RAM, netwerk)
- **Modulair:** Duidelijke scheiding van concerns
- **AI-vriendelijk:** Zelfdocumenterende code met module headers en .ai/ database
- **Transfer management:** Pause, resume, retry, checksums, queue
- **File System Access API:** Direct streamen naar schijf voor 1TB+ bestanden
- **Multi-threading:** CPU cores detecteren, cores-2 gebruiken
- **Adaptive chunking:** Automatische chunk size (4MB-64MB)

## Projectstructuur

```
ghostvaultv2/
├── apps/                      # Applications
│   ├── web/                   # Web application (React)
│   │   ├── src/
│   │   │   ├── ui/           # UI components
│   │   │   ├── hooks/        # React hooks
│   │   │   └── main.tsx
│   │   └── package.json
│   └── cli/                   # CLI tool (optional)
├── core/                      # Core library (shared)
│   ├── crypto/                # Cryptography
│   │   ├── encryption/       # Encryption algorithms
│   │   │   └── xchacha20.ts  # XChaCha20-Poly1305
│   │   ├── compression/       # Compression
│   │   │   └── zstd.ts       # Zstandard streaming
│   │   └── kdf/              # Key derivation
│   │       └── argon2id.ts    # Argon2id
│   ├── format/                # File formats
│   │   ├── ghost.ts          # .ghost format v5
│   │   ├── ghostkey.ts       # .ghostkey format
│   │   └── ghosttrusted.ts   # .ghosttrusted format
│   ├── stream/                # Streaming utilities
│   │   ├── file-stream.ts    # File streaming
│   │   ├── transform.ts      # Stream transforms
│   │   ├── pipeline.ts       # Pipeline orchestration
│   │   ├── adaptive-chunk.ts # Adaptive chunk size
│   │   └── file-system-access.ts # File System Access API
│   └── types/                 # TypeScript types
│       └── index.ts
├── server/                    # Server (optional for relay)
│   ├── src/
│   │   ├── api/              # API routes
│   │   ├── relay/            # Relay service
│   │   └── storage/          # Storage abstraction
│   │       └── database.ts    # Database schema
│   └── package.json
├── workers/                   # Web workers
│   ├── compression.worker.ts
│   └── encryption.worker.ts
├── scripts/                   # Build and utility scripts
│   ├── build.ts              # Smart build system
│   ├── dev.ts                # Development server
│   ├── migrate.ts            # Migration utilities
│   └── generate-ai-db.mjs    # AI architecture database generator
├── docs/                      # Documentation
│   ├── ARCHITECTUUR.md       # Main architecture doc
│   ├── BESTANDEN.md          # File index
│   ├── API.md                # API documentation
│   ├── DATABASE.md           # Database schema
│   ├── SOCKETS.md            # Socket.IO events
│   ├── SECURITY.md           # Security model
│   └── FILE_FORMAT.md        # .ghost format specification
├── .ai/                      # AI architecture database
│   ├── project-index.json    # Module dependencies
│   ├── dependencies.json     # Package dependencies
│   ├── modules.json          # Module registry
│   └── ownership.json        # Code ownership
├── package.json               # Root package.json
└── tsconfig.json              # Root TypeScript config
```

## Streaming Architectuur

### Pack Flow (Encryption)

```
File Stream (File System Access API when available)
  → ReadableStream (file.stream())
  → TransformStream (Compression - Zstd, multi-threaded)
  → TransformStream (Encryption - XChaCha20-Poly1305, parallel per chunk)
  → TransformStream (Chunking - Adaptive size chunks)
  → WritableStream (Direct to disk, no Blob)
```

### Unpack Flow (Decryption)

```
File Stream
  → ReadableStream (file.stream())
  → TransformStream (De-chunking)
  → TransformStream (Decryption - XChaCha20-Poly1305, parallel per chunk)
  → TransformStream (Decompression - Zstd, multi-threaded)
  → WritableStream (Direct to disk via File System Access API)
```

## Core Modules

### core/stream/adaptive-chunk.ts

**Verantwoordelijkheid:**
- Automatische detectie van optimale chunk size
- SSD + veel RAM: 64MB chunks
- Gemiddelde PC: 16MB chunks
- Oude PC: 4MB chunks

**Gebruikt door:**
- core/format/packer.ts
- core/stream/transfer.ts

**Afhankelijk van:**
- core/types/index.ts

### core/stream/file-system-access.ts

**Verantwoordelijkheid:**
- Directe schrijftoegang naar schijf voor 1TB+ bestanden
- Fallback naar Blob voor oudere browsers
- Streaming naar schijf, niet naar RAM

**Gebruikt door:**
- core/format/packer.ts
- core/format/unpacker.ts

**Afhankelijk van:**
- core/types/index.ts

### core/crypto/kdf/argon2id.ts

**Verantwoordelijkheid:**
- Argon2id KDF implementatie
- Vervangt PBKDF2 voor betere beveiliging
- Parameters: t=3, m=64MB, p=4

**Gebruikt door:**
- core/crypto/encryption/xchacha20.ts
- core/format/packer.ts

**Afhankelijk van:**
- argon2-browser

### core/crypto/encryption/xchacha20.ts

**Verantwoordelijkheid:**
- XChaCha20-Poly1305 encryptie/decryptie
- Streaming ondersteuning
- Parallel chunk encryptie

**Gebruikt door:**
- core/format/packer.ts
- core/format/unpacker.ts

**Afhankelijk van:**
- @noble/ciphers
- core/crypto/kdf/argon2id.ts

### core/crypto/compression/zstd.ts

**Verantwoordelijkheid:**
- Zstd compressie/decompressie met streaming
- Multi-threaded compressie
- Fix "payload too small" bug

**Gebruikt door:**
- core/format/packer.ts
- core/format/unpacker.ts

**Afhankelijk van:**
- @oneidentity/zstd-js

## Database Schema

### Tabellen

**Users:**
- id: string
- username: string
- passwordHash: string
- createdAt: Date

**Devices:**
- id: string
- userId: string
- deviceId: string
- name: string
- lastSeen: Date
- online: boolean

**TrustedDevices:**
- id: string
- userId: string
- connectionId: string
- friendName: string
- createdAt: Date

**Transfers:**
- id: string
- transferId: string
- currentChunk: number
- totalChunks: number
- checksumStatus: string
- lastProcessed: Date
- status: 'pending' | 'in_progress' | 'completed' | 'failed'
- createdAt: Date
- fileName: string
- fileSize: number

**TransferChunks:**
- id: string
- transferId: string
- chunkId: number
- offset: number
- compressedSize: number
- originalSize: number
- sha256: string
- status: 'pending' | 'completed' | 'failed'

**AuditLog:**
- id: string
- userId: string
- action: string
- details: string
- createdAt: Date

**Settings:**
- id: string
- userId: string
- key: string
- value: string

**Sessions:**
- id: string
- userId: string
- deviceId: string
- createdAt: Date
- expiresAt: Date

## Transfer Systeem

### Resume na Crash

- Transfer database tracking
- Scan actieve transfers bij herstart
- Hervat vanaf laatste geldige chunk

### Chunk Manifest

- Per chunk: chunkId, offset, compressedSize, originalSize, sha256
- Corruptie herstel: alleen corrupte chunks opnieuw downloaden

### Transfer Management

- Pause/resume functionality
- Retry failed chunks
- Checksum per chunk
- Transfer queue management

## .ghost Format v5

### Structuur

```
[HEADER]
├─ Magic (5): "GHOST"
├─ Version (1): 5
├─ Salt (32): Argon2id salt
├─ Opaque length (4)
└─ [OPAQUE HEADER]
   ├─ Encrypted metadata
   └─ Argon2id params

[STREAMING CHUNKS]
└─ Per chunk:
   ├─ Chunk ID (8): Sequential ID
   ├─ Nonce (24): XChaCha20 nonce
   ├─ Ciphertext (N + 16): Data + Poly1305 tag
   └─ SHA-256 (32): Chunk integrity

[FOOTER]
├─ Magic end (5): "TSOHG"
├─ Total chunks (8)
├─ Total size (8)
└─ SHA-256 (32): File integrity
```

### Veranderingen vs v4

1. **Streaming-first:** Geen manifest, chunks zijn zelfstandig
2. **Chunk IDs:** Voor out-of-order chunking
3. **Argon2id:** Vervangt PBKDF2 voor betere beveiliging
4. **Geen padding:** Niet nodig voor streaming
5. **Metadata:** Opgeslagen in eerste chunk

## Security Model

### Encryptie

- **Algoritme:** XChaCha20-Poly1305
- **Key derivation:** Argon2id (t=3, m=64MB, p=4)
- **Nonce:** 24 bytes (XChaCha20)
- **Tag:** 16 bytes (Poly1305)

### Compressie

- **Algoritme:** Zstandard (zstd)
- **Levels:** 0-22 (adaptive)
- **Streaming:** Ja, geen volledige bestanden in RAM

### Key Management

- **Salt:** 32 bytes willekeurig
- **HKDF:** Domain-separated subkeys
- **Wipe:** Secure zero na gebruik

## Build Systeem

### Smart Build

- Hash-based build detection
- Cache build artifacts
- Incremental builds
- Check source files, last build timestamp, file hashes

### Scripts

- `npm run build` - Build alle workspaces
- `npm run dev` - Development server
- `npm run generate-docs` - Genereer documentatie
- `npm run generate-ai-db` - Genereer AI architectuur database

## AI Architectuur Database

### Doel

Help toekomstige AI's direct begrijpen waar alles zit.

### Bestanden

- `.ai/project-index.json` - Module dependencies
- `.ai/dependencies.json` - Package dependencies
- `.ai/modules.json` - Module registry
- `.ai/ownership.json` - Code ownership

### Voorbeeld

```json
{
  "module": "packer",
  "path": "core/format/packer.ts",
  "dependsOn": ["zstd", "xchacha20", "pipeline"],
  "usedBy": ["EncryptPanel"]
}
```

## Multi-threading

### Compressie

- Gebruik meerdere workers
- CPU cores detecteren
- Gebruik: cores - 2

### Encryptie

- Parallel per chunk
- Promise.all voor parallel processing

## Bug Fix: "Length of the payload is too small"

### Onderzoeksplan

1. Exacte oorzaak identificeren
2. Mogelijke oorzaken:
   - zstd-js library limitatie (< 100 bytes)
   - Verkeerde buffer wordt gedecomprimeerd (offset fout)
   - Header corruptie
   - Encryptie fout (verkeerde nonce/IV)
   - Chunk parsing fout
3. Diagnose procedure met logging
4. Oplossing NA diagnose (geen workaround zonder bewijs)

## Implementatie Status

- [x] Projectstructuur
- [x] Package.json bestanden
- [x] Core library foundation
- [x] Adaptive chunk size
- [x] File System Access API
- [x] Multi-threading
- [x] Argon2id KDF
- [x] XChaCha20-Poly1305
- [x] Zstd streaming
- [x] Database schema
- [x] AI architectuur database generator
- [x] ARCHITECTUUR.md
- [ ] Format v5 implementation
- [ ] Web application UI
- [ ] Server implementation
- [ ] Testing en bug fixes

## Deployment

### Requirements

- Node.js >= 18.0.0
- Modern browser met File System Access API support
- Minimaal 4GB RAM
- SSD aanbevolen voor grote bestanden

### Installatie

```bash
npm install
npm run build
npm run dev
```

## License

Zie LICENSE.md voor details.

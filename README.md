# GhostVault v2

Streaming-based, client-side encrypted file storage. Files are encrypted in
the browser with **XChaCha20-Poly1305** (AEAD), keys derived with
**Argon2id**, and payloads compressed with **Zstandard**. Nothing leaves
your machine.

> Status: the **core library** (crypto, format, compression, config,
> security) is stable and round-trip correct. A few **UI blockers** remain,
> see [Known limitations](#known-limitations).

## Where the app lives

The application source is at:

```
ghostvault-main/ghost/ghostvault/apps/web
```

(The nested `ghostvault-main/ghost/ghostvault/` path is a historical
artifact of how the project was packaged; flattening it is planned.)

## Requirements

- Node.js >= 18
- A Chromium-based browser (Chrome/Edge) for the full File System Access
  experience. Firefox/Safari work too via an automatic Blob-download
  fallback (see note under Limitations).

## Run in development

```bash
cd ghostvault-main/ghost/ghostvault/apps/web
npm install
npm run dev
```

Then open the printed URL (default http://localhost:3000/).

## Build for production

```bash
cd ghostvault-main/ghost/ghostvault/apps/web
npm install
npm run build      # tsc + vite build
npm run preview    # serve the production build locally
```

## Windows installer (portable)

`ghostvault-main/ghost/install.bat` provides a menu-driven installer with a
portable `node.exe` bundled, so it can run on machines **without** Node.js
installed:

- **Option 1** installs/updates to `C:\ghostvault`
- **Option 4** runs fully portable from USB (no install, no data left behind)

The app honors `APP_LOGS_DIR`, `GHOST_LOGS_DIR` and `APP_VERSION`
environment variables (set by the generated `start.bat`) so logs land in the
actual install location.

## Security model (short)

- **Cipher:** XChaCha20-Poly1305, 24-byte nonce, 16-byte Poly1305 tag.
- **KDF:** Argon2id with fixed, deterministic parameters (t=3, m=64MB, p=4)
  so the same password + salt yields the same key on every device.
- **Salt:** 64 random bytes, stored in the `.ghost` header.
- **Integrity:** SHA-256 of the original content is stored in the footer and
  verified on unpack; a mismatch fails hard (outside recovery mode).
- **Compression:** Zstandard; each chunk carries a 1-byte marker so
  incompressible data (already-zipped files, images, video) round-trips
  correctly.

## Known limitations

These live in the UI layer and are tracked for a follow-up:

- **Very large single operations (~20GB):** unpack currently reads the whole
  `.ghost` into memory; true streaming-to-disk on the read path is not wired
  up yet. Packing streams; unpacking does not.
- **File-count caps:** the encrypt panel still caps batches; large folders
  (tens of thousands of files) are limited.
- **Firefox/Safari:** saving works via a Blob download that buffers the
  output in memory, so it is not suitable for multi-GB files on those
  browsers. Chromium streams to disk.

## License

MIT. See [LICENSE](./LICENSE).

#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootPackagePath = join(__dirname, '..', 'package.json');
const webPackagePath = join(__dirname, '..', 'apps', 'web', 'package.json');

try {
  // Read root package.json
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf-8'));
  const rootVersion = rootPackage.version;

  // Read web package.json
  const webPackage = JSON.parse(readFileSync(webPackagePath, 'utf-8'));

  // Update web package.json version
  webPackage.version = rootVersion;

  // Write back to web package.json
  writeFileSync(webPackagePath, JSON.stringify(webPackage, null, 2), 'utf-8');

  console.log(`✅ Version synced: ${rootVersion} -> web/package.json`);
} catch (error) {
  console.error('❌ Error syncing version:', error);
  process.exit(1);
}

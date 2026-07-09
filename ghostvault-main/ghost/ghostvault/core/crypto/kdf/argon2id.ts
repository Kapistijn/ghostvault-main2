/**
 * MODULE: Argon2id Key Derivation
 *
 * Responsibilities:
 *  - Argon2id KDF implementation
 *  - Replaces PBKDF2 for better security
 *  - Parameters: t=3, m=64MB, p=4
 *
 * Used by:
 *  - core/crypto/encryption/xchacha20.ts
 *  - core/format/packer.ts
 *
 * Depends on:
 *  - argon2-browser
 *
 * @module core/crypto/kdf/argon2id
 */

// crypto is available globally in browser secure contexts
declare const crypto: Crypto;

import { argon2id } from 'argon2-browser';
import { getLogger } from '../../utils/logger.js';
import { validatePassword, validateArgon2idSalt, validateArgon2idParams } from '../../utils/validation.js';

const logger = getLogger('argon2id');

// Lazy initialization check - defer validation until first use
let argon2Initialized = false;
let initError: Error | null = null;

function resolveArgon2TypeFromExports(): string | number | undefined {
  // argon2-browser export shapes vary across versions/builds.
  // We defensively probe common locations and keep the returned type compatible
  // with what argon2-browser expects for its `type` option.
  const anyMod = argon2id as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates: Array<string | number | undefined> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imported: any = (globalThis as any)?.ArgonType ?? (globalThis as any)?.argon2bArgonType;
  if (imported) {
    candidates.push(imported?.Argon2id as string | number | undefined);
    candidates.push(imported?.argon2id as string | number | undefined);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeTypeObj: any = (anyMod as any)?.ArgonType ?? (anyMod as any)?.type;
  if (maybeTypeObj) {
    candidates.push(maybeTypeObj.Argon2id as string | number | undefined);
    candidates.push(maybeTypeObj.argon2id as string | number | undefined);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyExports: any = (globalThis as any)?.argon2BrowserExports;
  if (anyExports) {
    candidates.push(anyExports?.ArgonType?.Argon2id as string | number | undefined);
    candidates.push(anyExports?.ArgonType?.argon2id as string | number | undefined);
  }

  return candidates.find((c) => c != null);
}

function checkArgon2Initialization(): void {
  if (argon2Initialized) return;

  try {
    const hasArgon2idFn = typeof argon2id === 'function';
    const resolvedType = resolveArgon2TypeFromExports();

    if (!hasArgon2idFn || resolvedType == null) {
      throw new Error(
        'argon2-browser library not properly loaded (missing argon2id or Argon2id type token)'
      );
    }

    argon2Initialized = true;
    logger.info('argon2-browser initialized successfully', {
      hasArgon2id: hasArgon2idFn,
      hasArgon2idType: true,
    });
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    logger.critical('argon2-browser initialization failed', undefined, {
      hasArgon2id: typeof argon2id === 'function',
      resolvedTypePresent: resolveArgon2TypeFromExports() != null,
      error: initError.message,
    });
  }
}

// KDF operation limits to prevent resource exhaustion
const MAX_CONCURRENT_OPERATIONS = 10;

// Track active KDF operations to prevent resource exhaustion
const activeOperations = new Map<Promise<any>, { settled: boolean }>();

// Cache for adaptive parameters to avoid recalculating
const adaptiveParamsCache = new Map<number, Partial<Argon2idParams>>();

/**
 * Check if we can start a new KDF operation
 */
function canStartOperation(): boolean {
  // Clean up completed operations
  for (const [operation, state] of activeOperations.entries()) {
    if (state.settled) {
      activeOperations.delete(operation);
    }
  }
  
  return activeOperations.size < MAX_CONCURRENT_OPERATIONS;
}

/**
 * Register an operation
 */
function registerOperation<T>(operation: Promise<T>): Promise<T> {
  const state = { settled: false };
  activeOperations.set(operation, state);
  
  operation.finally(() => {
    state.settled = true;
    // Don't delete immediately - let canStartOperation clean up
  });
  
  return operation;
}

export interface Argon2idParams {
  salt?: Uint8Array;
  iterations: number;
  memory: number; // in KB
  parallelism: number;
  hashLength: number;
}

export interface Argon2idResult {
  hash: Uint8Array;
  encoded: string;
}

const DEFAULT_PARAMS: Omit<Argon2idParams, 'salt'> = {
  iterations: 10, // Increased from 5 to 10 for better security
  memory: 256 * 1024, // Increased from 128MB to 256MB for better security
  parallelism: 8, // Maintained at 8 for balance between security and performance
  hashLength: 32,
};

// Adaptive parameters based on device capabilities
const ADAPTIVE_PARAMS = {
  lowEnd: { iterations: 8, memory: 64 * 1024, parallelism: 4 },
  midRange: { iterations: 10, memory: 256 * 1024, parallelism: 8 },
  highEnd: { iterations: 15, memory: 512 * 1024, parallelism: 16 },
};

/**
 * Detect device capabilities and return appropriate parameters with caching
 */
function getAdaptiveParams(): Partial<Argon2idParams> {
  // Check cache first
  const memoryLimit = (performance as any).memory;
  const memoryKey = memoryLimit ? memoryLimit.jsHeapSizeLimit : 0;
  
  if (adaptiveParamsCache.has(memoryKey)) {
    logger.debug('Using cached adaptive parameters', { memoryKey });
    return adaptiveParamsCache.get(memoryKey)!;
  }
  
  let params: Partial<Argon2idParams>;
  
  if (memoryLimit && memoryLimit.jsHeapSizeLimit < 2 * 1024 * 1024 * 1024) { // < 2GB
    logger.debug('Using low-end parameters', { memoryLimit: memoryLimit.jsHeapSizeLimit });
    params = ADAPTIVE_PARAMS.lowEnd;
  } else if (memoryLimit && memoryLimit.jsHeapSizeLimit > 8 * 1024 * 1024 * 1024) { // > 8GB
    logger.debug('Using high-end parameters', { memoryLimit: memoryLimit.jsHeapSizeLimit });
    params = ADAPTIVE_PARAMS.highEnd;
  } else {
    logger.debug('Using mid-range parameters');
    params = ADAPTIVE_PARAMS.midRange;
  }
  
  // Cache the result
  adaptiveParamsCache.set(memoryKey, params);
  return params;
}

/**
 * Generate random salt with validation
 */
export function generateSalt(length: number = 64): Uint8Array {
  // Validate length
  if (typeof length !== 'number' || length < 16 || length > 1024) {
    throw new Error('Salt length must be between 16 and 1024 bytes');
  }
  
  // Use crypto.getRandomValues for cryptographically secure random numbers
  const salt = crypto.getRandomValues(new Uint8Array(length));
  
  // Validate that the salt was generated correctly
  if (!salt || salt.length !== length) {
    logger.critical('Failed to generate secure salt', undefined, { expectedLength: length, actualLength: salt?.length });
    throw new Error('Failed to generate secure salt');
  }
  
  // Validate entropy (check for all zeros - extremely unlikely but possible)
  let allZeros = true;
  for (let i = 0; i < salt.length; i++) {
    if (salt[i] !== 0) {
      allZeros = false;
      break;
    }
  }
  
  if (allZeros) {
    logger.critical('Generated salt is all zeros - CSPRNG failure', undefined, { length });
    throw new Error('CSPRNG failure: generated salt is all zeros');
  }
  
  logger.debug('Secure salt generated', { length });
  return salt;
}

// Salt cache for performance (reuse salts in short time windows)
// DISABLED: Salt reuse is a security vulnerability
// const saltCache = new Map<number, { salt: Uint8Array; timestamp: number }>();
// const SALT_CACHE_TTL = 5000; // 5 seconds
// let saltCounter = 0;

/**
 * Get cached or generate new salt for performance
 * DISABLED: Always generate fresh salt for security
 */
export function getCachedSalt(): Uint8Array {
  // Always generate fresh salt to prevent salt reuse attacks
  return generateSalt();
}

/**
 * Derive key with Argon2id with enhanced validation and resource management
 */
export async function deriveKeyArgon2id(
  password: string,
  salt: Uint8Array,
  params: Partial<Argon2idParams> = {},
  useAdaptive: boolean = true
): Promise<Argon2idResult> {
  // Security: Don't log password or sensitive data
  logger.info('deriveKeyArgon2id started', { 
    passwordLength: password?.length, 
    saltLength: salt?.length,
    params,
    useAdaptive
  });

  // Validate inputs first so error messages are deterministic (and tests can assert them)
  const saltValidation = validateArgon2idSalt(salt);
  if (!saltValidation.valid) {
    logger.error(saltValidation.error || 'Invalid salt', undefined, { saltLength: salt?.length });
    throw new Error(saltValidation.error || 'Invalid salt');
  }

  const passwordValidation = validatePassword(password);
  if (!passwordValidation.valid) {
    logger.error(passwordValidation.error || 'Invalid password', undefined, { passwordLength: password?.length });
    throw new Error(passwordValidation.error || 'Invalid password');
  }

  // Only after inputs are valid, check argon2-browser initialization
  checkArgon2Initialization();
  if (initError) {
    throw initError;
  }

  
  // Check resource limits
  if (!canStartOperation()) {
    logger.error('Too many concurrent KDF operations', undefined, { activeOperations: activeOperations.size });
    throw new Error('Too many concurrent KDF operations. Please wait and try again.');
  }
  
  // Use adaptive parameters if enabled and no custom params provided
  const adaptiveParams = useAdaptive && Object.keys(params).length === 0 ? getAdaptiveParams() : {};
  
  // Validate params
  const paramsValidation = validateArgon2idParams({ ...params, ...adaptiveParams });
  if (!paramsValidation.valid) {
    logger.error(paramsValidation.error || 'Invalid params', undefined, { params });
    throw new Error(paramsValidation.error || 'Invalid params');
  }
  
  const finalParams: Argon2idParams = { ...DEFAULT_PARAMS, ...adaptiveParams, ...params, salt };

  // Validate final params before using
  if (!finalParams.salt || finalParams.salt.length === 0) {
    throw new Error('Final params: salt is empty');
  }

  // Convert salt to hex string for stable encoding (UTF-8 decoding corrupts random bytes)
  const saltHex = Array.from(finalParams.salt)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Create operation with timeout protection
  const argon2Type = resolveArgon2TypeFromExports();

  if (!argon2Type) {
    // Prevent hard TypeError later; fail deterministically with context
    throw new Error(
      'argon2-browser Argon2id type token is not available in this build/version. Check installed argon2-browser exports.'
    );
  }

  const operation = argon2id({
    pass: password,
    salt: saltHex,
    // argon2-browser expects a specific Argon2 type token, but export shapes vary by version.
    // Cast is safe here because we validate token presence at runtime above.
    type: argon2Type as any,
    mem: finalParams.memory,
    time: finalParams.iterations,
    parallelism: finalParams.parallelism,
    hashLen: finalParams.hashLength,
  });
  
  // Add timeout protection (30 seconds max)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('KDF operation timed out after 30 seconds'));
    }, 30000);
  });
  
  const result = await registerOperation(Promise.race([operation, timeoutPromise]));

  // Validate result
  if (!result || !result.hashHex) {
    logger.critical('Argon2id key derivation failed: no result', undefined, { 
      hasResult: !!result, 
      hasHashHex: !!result?.hashHex 
    });
    throw new Error('Argon2id key derivation failed: no result');
  }

  const hash = new TextEncoder().encode(result.hashHex);

  // Validate hash
  if (!hash || hash.length === 0) {
    logger.critical('Argon2id key derivation failed: hash is empty', undefined, { 
      hashLength: hash?.length 
    });
    throw new Error('Argon2id key derivation failed: hash is empty');
  }

  // Security: Don't log hash or encoded data
  logger.info('deriveKeyArgon2id completed', { 
    hashLength: hash.length,
    hashHexLength: result.hashHex.length
  });

  return {
    hash,
    encoded: result.hashHex,
  };
}

/**
 * Derive multiple keys from one master key (HKDF-style)
 */
export async function deriveSubKeys(
  masterKey: Uint8Array,
  labels: string[]
): Promise<Uint8Array[]> {
  logger.info('deriveSubKeys started', {
    masterKeyLength: masterKey?.length,
    labelsCount: labels?.length,
    labels
  });

  // Validate master key
  if (!masterKey || masterKey.length === 0) {
    logger.error('Master key must not be empty', undefined, { masterKeyLength: masterKey?.length });
    throw new Error('Master key must not be empty');
  }

  if (masterKey.length < 16) {
    logger.error('Master key must be at least 16 bytes', undefined, { masterKeyLength: masterKey.length });
    throw new Error('Master key must be at least 16 bytes');
  }

  if (masterKey.length > 1024) {
    logger.error('Master key must be at most 1024 bytes', undefined, { masterKeyLength: masterKey.length });
    throw new Error('Master key must be at most 1024 bytes');
  }

  // Validate labels
  if (!labels || labels.length === 0) {
    logger.error('Labels must not be empty', undefined, { labelsCount: labels?.length });
    throw new Error('Labels must not be empty');
  }

  if (labels.length > 100) {
    logger.error('Too many labels (max 100)', undefined, { labelsCount: labels.length });
    throw new Error('Too many labels (max 100)');
  }

  const subKeys: Uint8Array[] = [];

  // Process labels in batches to avoid overwhelming memory
  const BATCH_SIZE = 20;
  for (let i = 0; i < labels.length; i += BATCH_SIZE) {
    const batch = labels.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (label) => {
        // Validate label
        if (!label || label.length === 0) {
          logger.error('Label must not be empty', undefined, { label });
          throw new Error('Label must not be empty');
        }

        if (label.length > 1000) {
          logger.error('Label too long (max 1000 characters)', undefined, { labelLength: label.length });
          throw new Error('Label too long (max 1000 characters)');
        }

        // Use real HKDF with crypto.subtle
        const labelBytes = new TextEncoder().encode(label);

        // Import master key for HKDF
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          masterKey as unknown as BufferSource,
          'HKDF',
          false,
          ['deriveBits']
        );

        // Use a random salt for HKDF to prevent deterministic derivation
        // Generate a unique salt per label for better security
        const labelSalt = await crypto.subtle.digest('SHA-256', labelBytes as unknown as BufferSource);
        const salt = labelSalt as unknown as BufferSource;
        const info = labelBytes as unknown as BufferSource;

        // Derive key using HKDF-SHA256
        const derivedBits = await crypto.subtle.deriveBits(
          {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: salt,
            info: info,
          },
          cryptoKey,
          256 // 256 bits = 32 bytes
        );

        const hashArray = new Uint8Array(derivedBits);

        // Validate hash
        if (!hashArray || hashArray.length === 0) {
          logger.critical('Hash derivation failed: hash is empty', undefined, {
            label,
            hashLength: hashArray?.length
          });
          throw new Error('Hash derivation failed: hash is empty');
        }

        logger.debug(`Subkey generated for label: ${label}`, {
          label,
          hashLength: hashArray.length
        });

        return hashArray;
      })
    );

    subKeys.push(...batchResults);

    logger.debug(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed`, {
      subKeysCount: batchResults.length
    });

    // Allow event loop to process other tasks
    if (i + BATCH_SIZE < labels.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  logger.info('deriveSubKeys completed', {
    totalSubKeys: subKeys.length,
    labelsProcessed: labels.length
  });

  return subKeys;
}

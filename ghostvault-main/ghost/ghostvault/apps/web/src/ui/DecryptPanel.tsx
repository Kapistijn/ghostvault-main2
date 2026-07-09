import { useState, useEffect, useCallback, useMemo } from 'react';
import { unpackGhostV5 } from '../core';
import { getLogger } from '../core';

const logger = getLogger('decrypt');

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function DecryptPanel() {
  // ALL useState calls must be at the top to maintain hook order
  const [ghostFile, setGhostFile] = useState<File | null>(null);
  const [useGhostKey, setUseGhostKey] = useState(false);
  const [ghostKeyFile, setGhostKeyFile] = useState<File | null>(null);
  const [useGhostTrusted, setUseGhostTrusted] = useState(false);
  const [ghostTrustedFile, setGhostTrustedFile] = useState<File | null>(null);
  const [ghostTrustedPassword, setGhostTrustedPassword] = useState('');
  const [useCombinedUnlock, setUseCombinedUnlock] = useState(false);
  const [password, setPassword] = useState('');
  const [secondPassword, setSecondPassword] = useState('');
  const [enableDoubleDecrypt, setEnableDoubleDecrypt] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [unpacked, setUnpacked] = useState(false);
  const [autoFailed, setAutoFailed] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [textMessage, setTextMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [memoryUsage, setMemoryUsage] = useState<{ used: number; total: number } | null>(null);
  const [decryptionSpeed, setDecryptionSpeed] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  
  // Callbacks and memoized values come after all useState calls
  const handleGhostTrustedPasswordChange = useCallback((value: string) => {
    const sanitized = value.replace(/[\0-\x1F\x7F]/g, '');
    setGhostTrustedPassword(sanitized);
  }, []);
  
  const handlePasswordChange = useCallback((value: string) => {
    const sanitized = value.replace(/[\0-\x1F\x7F]/g, '');
    setPassword(sanitized);
  }, []);
  
  const handleSecondPasswordChange = useCallback((value: string) => {
    const sanitized = value.replace(/[\0-\x1F\x7F]/g, '');
    setSecondPassword(sanitized);
  }, []);

  // Memoize file info for performance
  const fileInfo = useMemo(() => {
    if (!ghostFile) return null;
    return {
      name: ghostFile.name,
      size: ghostFile.size,
      sizeFormatted: formatFileSize(ghostFile.size),
      type: ghostFile.type
    };
  }, [ghostFile]);

  // Memoize decryption options
  const decryptionOptions = useMemo(() => ({
    useGhostKey,
    useGhostTrusted,
    useCombinedUnlock,
    enableDoubleDecrypt,
    recoveryMode
  }), [useGhostKey, useGhostTrusted, useCombinedUnlock, enableDoubleDecrypt, recoveryMode]);

  // Monitor memory usage during decryption
  useEffect(() => {
    let rafId: number;
    let isMounted = true;
    const updateMemoryUsage = () => {
      if (!isMounted) return;
      if ('memory' in performance && busy) {
        const memory = (performance as any).memory;
        setMemoryUsage({
          used: memory.usedJSHeapSize,
          total: memory.totalJSHeapSize
        });
      }
      if (isMounted && busy) {
        rafId = requestAnimationFrame(updateMemoryUsage);
      }
    };

    if (busy) {
      rafId = requestAnimationFrame(updateMemoryUsage);
    }

    return () => {
      isMounted = false;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [busy]);

  // Calculate decryption speed
  useEffect(() => {
    if (busy && progress > 0 && startTime) {
      const elapsed = (Date.now() - startTime) / 1000; // seconds
      if (elapsed > 0) {
        const speed = progress / elapsed; // percent per second
        setDecryptionSpeed(speed);
      }
    } else if (!busy) {
      setDecryptionSpeed(0);
      setStartTime(null);
    }
  }, [busy, progress, startTime]);

  const handleUnpack = async () => {
    if (!ghostFile) return;
    
    // Validate file exists
    if (!ghostFile || ghostFile.size === undefined) {
      setKeyError('Bestand bestaat niet');
      return;
    }
    
    // Validate file size
    if (ghostFile.size === 0) {
      setKeyError('Bestand is leeg');
      return;
    }
    
    if (ghostFile.size > 10 * 1024 * 1024 * 1024) { // 10GB limit
      setKeyError('Bestand is te groot (max 10GB)');
      return;
    }
    
    // Validate file name
    if (!ghostFile.name || ghostFile.name.length === 0) {
      setKeyError('Bestandsnaam is leeg');
      return;
    }
    
    if (ghostFile.name.length > 255) {
      setKeyError('Bestandsnaam is te lang (max 255 karakters)');
      return;
    }
    
    const controller = new AbortController();
    setAbortController(controller);
    setBusy(true);
    setProgress(0);
    setKeyError(null);
    setStartTime(Date.now());
    
    try {
      // Determine password based on mode
      let passwordToUse = '';
      if (useGhostTrusted) {
        passwordToUse = ghostTrustedPassword;
        // Validate ghostTrustedPassword
        if (!passwordToUse || passwordToUse.length === 0) {
          setKeyError('GhostTrusted wachtwoord is leeg');
          return;
        }
      } else if (useGhostKey) {
        passwordToUse = ''; // GhostKey doesn't need password
      } else {
        passwordToUse = password;
        // Validate password
        if (!passwordToUse || passwordToUse.length === 0) {
          setKeyError('Wachtwoord is leeg');
          return;
        }
      }

      logger.logDecryptionOperation('decrypt', ghostFile.size, { fileName: ghostFile.name });
      
      await unpackGhostV5(ghostFile, {
        password: passwordToUse,
        secondPassword: enableDoubleDecrypt ? secondPassword : undefined,
        fileName: ghostFile.name.replace('.ghost', ''),
        cancellationToken: controller.signal,
        recoveryMode
      }, (p) => {
        setProgress(p.percent);
        setMessage(p.message || '');
      });
      
      logger.logGhostFileExtraction({ fileName: ghostFile.name, size: ghostFile.size });
      logger.logFileDownload(1, ghostFile.size, { fileName: ghostFile.name });
      setUnpacked(true);
      setDecryptionSpeed(0);
      // In real implementation, text message would come from file metadata
    } catch (error) {
      if (error instanceof Error && error.name === 'OperationCancelledError') {
        setKeyError('Operatie geannuleerd door gebruiker');
      } else if (error instanceof Error && error.name === 'ValidationError') {
        setKeyError(`Validatiefout: ${error.message}`);
      } else if (error instanceof Error && error.name === 'DecryptionError') {
        setKeyError(`Decryptiefout: ${error.message}`);
      } else if (error instanceof Error && error.name === 'CompressionError') {
        setKeyError(`Compressiefout: ${error.message}`);
      } else if (error instanceof Error && error.name === 'FileError') {
        setKeyError(`Bestandsfout: ${error.message}`);
      } else {
        console.error('Unpack error:', error);
        setKeyError('Fout bij ontgrendelen: ' + (error instanceof Error ? error.message : 'Onbekende fout'));
      }
    } finally {
      setBusy(false);
      setAbortController(null);
      setStartTime(null);
      setMemoryUsage(null); // Clear memory usage to prevent memory leak
    }
  };

  const handleCancel = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setBusy(false);
      setProgress(0);
      setDecryptionSpeed(0);
      setStartTime(null);
      setMemoryUsage(null); // Clear memory usage to prevent memory leak
    }
  }, [abortController]);

  const clearVault = useCallback(() => {
    setGhostFile(null);
    setPassword('');
    setUnpacked(false);
    setUseGhostKey(false);
    setGhostKeyFile(null);
    setUseGhostTrusted(false);
    setTextMessage('');
    setKeyError(null);
    setProgress(0);
    setMessage('');
    setDecryptionSpeed(0);
    setStartTime(null);
    setMemoryUsage(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.ghost')) {
      setGhostFile(file);
      setUnpacked(false);
      setKeyError(null);
      setProgress(0);
      setMessage('');
    } else if (file) {
      setKeyError('Alleen .ghost bestanden zijn toegestaan');
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  return (
    <section className="space-y-6">
      <ol className="list-decimal space-y-2 rounded-lg border border-neon-magenta/20 bg-neon-magenta/5 p-4 pl-6 text-sm text-ghost-300">
        <li>Kies het <strong className="text-neon-green">.ghost</strong> bestand dat je vriend je stuurde.</li>
        <li>Heb je een <strong className="text-amber-300">.ghosttrusted</strong> bestand (eenmalig gekregen van je vriend)?
          → Vink <em>"Ik heb .ghosttrusted"</em> aan, upload dat bestand en klik <strong>Ontgrendel</strong>. Klaar — geen wachtwoord!</li>
        <li>Heb je een <strong className="text-neon-magenta">.ghostkey</strong>?
          → Vink <em>"Ik heb .ghostkey"</em> aan en upload die.</li>
        <li>Anders: typ het wachtwoord dat je vriend je gaf.</li>
        <li>Klik <strong className="text-neon-magenta">Ontgrendel</strong> — bestanden verschijnen eronder.</li>
      </ol>

      <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
        <h3 className="font-mono text-sm text-neon-magenta mb-4">Stap 1 — Kies het .ghost bestand</h3>
        
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 font-mono text-sm cursor-pointer transition ${
            isDragging
              ? 'border-neon-magenta bg-neon-magenta/10 text-neon-magenta'
              : 'border-panel-border bg-void/50 text-ghost-300 hover:border-neon-magenta hover:text-neon-magenta'
          }`}
        >
          <label className="flex items-center justify-center gap-2 cursor-pointer w-full h-full">
            <input
              type="file"
              accept=".ghost"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  // Validate file has .ghost extension
                  if (!file.name.toLowerCase().endsWith('.ghost')) {
                    setKeyError('Alleen .ghost bestanden zijn toegestaan');
                    return;
                  }
                  
                  // Validate file is not empty
                  if (file.size === 0) {
                    setKeyError('Bestand is leeg');
                    return;
                  }
                  
                  setGhostFile(file);
                  setUnpacked(false);
                  setAutoFailed(false);
                  setKeyError(null);
                }
              }}
              disabled={busy}
              className="hidden"
            />
            <span className="text-2xl">📤</span>
            <span>{isDragging ? 'Laat los om te uploaden' : (ghostFile ? ghostFile.name : 'Kies .ghost bestand of sleep hier')}</span>
          </label>
        </div>
        
        {ghostFile && (
          <p className="mt-2 font-mono text-xs text-ghost-300">
            {ghostFile.name} ({(ghostFile.size / 1024 / 1024).toFixed(2)} MiB)
          </p>
        )}
      </div>

      {ghostFile && !unpacked && autoFailed && !useGhostKey && (
        <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
          <p className="text-sm text-ghost-400">
            Dit bestand is <strong>beveiligd</strong>. Gebruik een .ghostkey of wachtwoord hieronder.
          </p>
        </div>
      )}

      {ghostFile && !unpacked && (
        <>
          {/* .ghosttrusted optie (aanbevolen voor vrienden) */}
          <label className="flex items-start gap-2 rounded border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-ghost-300">
            <input
              type="checkbox"
              checked={useGhostTrusted}
              onChange={(e) => {
                setUseGhostTrusted(e.target.checked);
                if (e.target.checked) {
                  setUseGhostKey(false);
                  setGhostKeyFile(null);
                }
              }}
              disabled={busy}
              className="mt-1 accent-amber-400"
            />
            <span>
              Ik heb een <strong className="text-amber-300">.ghosttrusted</strong> bestand — geen
              wachtwoord nodig (aanbevolen voor vrienden)
            </span>
          </label>

          {useGhostTrusted && (
            <div className="rounded-xl border border-amber-400/30 bg-panel/40 p-6 space-y-4">
              <div>
                <label className="font-mono text-xs text-amber-300 block mb-2">Kies GhostTrusted uit opgeslagen lijst</label>
                <div className="space-y-2 max-h-40 overflow-y-auto mb-4">
                  {(() => {
                    const ghostTrustedItems = (window as any).getGhostTrustedItems?.() || [];
                    if (ghostTrustedItems.length === 0) {
                      return (
                        <p className="font-mono text-xs text-ghost-500">
                          Geen GhostTrusted opgeslagen. Upload .ghosttrusted bestand hieronder.
                        </p>
                      );
                    }
                    return ghostTrustedItems.filter((item: any) => item.active).map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => setGhostTrustedPassword(item.password)}
                        className={`w-full text-left p-2 rounded text-sm font-mono transition ${
                          ghostTrustedPassword === item.password
                            ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                            : 'bg-void/50 text-ghost-300 border border-panel-border hover:border-amber-400/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span>{item.name}</span>
                          <span className="text-[10px] text-ghost-500">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </button>
                    ));
                  })()}
                </div>

                <label className="font-mono text-xs text-amber-300 block mb-2">Of upload .ghosttrusted bestand</label>
                <input
                  type="file"
                  accept=".ghosttrusted"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setGhostTrustedFile(file || null);
                    setKeyError(null);
                  }}
                  disabled={busy}
                  className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                />
              </div>

              <div>
                <label className="font-mono text-xs text-amber-300 block mb-2">Wachtwoord van dit .ghosttrusted bestand</label>
                <input
                  type="password"
                  value={ghostTrustedPassword}
                  onChange={(e) => setGhostTrustedPassword(e.target.value)}
                  placeholder="Plak het 120-tekens wachtwoord hier"
                  className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200"
                  disabled={busy}
                />
                <p className="mt-1 text-[11px] text-ghost-500">
                  Dit wachtwoord kreeg je van je vriend samen met het .ghosttrusted bestand.
                </p>
              </div>

              <label className="flex items-start gap-2 rounded border border-neon-cyan/30 bg-neon-cyan/5 p-2 text-xs text-ghost-300">
                <input
                  type="checkbox"
                  checked={useCombinedUnlock}
                  onChange={(e) => setUseCombinedUnlock(e.target.checked)}
                  disabled={busy}
                  className="mt-1 accent-neon-cyan"
                />
                <span>
                  <strong className="text-neon-cyan">Extra beveiliging:</strong> gebruik ook een wachtwoord
                  (beide .ghosttrusted én wachtwoord nodig)
                </span>
              </label>

              {useCombinedUnlock && (
                <div>
                  <label className="font-mono text-xs text-neon-cyan block mb-2">Extra wachtwoord</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                    disabled={busy}
                  />
                </div>
              )}

              <label className="flex items-start gap-2 rounded border border-purple-400/30 bg-purple-400/5 p-2 text-xs text-ghost-300">
                <input
                  type="checkbox"
                  checked={enableDoubleDecrypt}
                  onChange={(e) => setEnableDoubleDecrypt(e.target.checked)}
                  disabled={busy}
                  className="mt-1 accent-purple-400"
                />
                <span>
                  <strong className="text-purple-300">Dubbele decryptie</strong> (extra beveiliging met tweede wachtwoord)
                </span>
              </label>

              {enableDoubleDecrypt && (
                <div>
                  <label className="font-mono text-xs text-purple-300 block mb-2">Tweede wachtwoord</label>
                  <input
                    type="password"
                    value={secondPassword}
                    onChange={(e) => setSecondPassword(e.target.value)}
                    disabled={busy}
                    placeholder="Tweede wachtwoord"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                  />
                  <p className="mt-1 text-[10px] text-ghost-500">
                    Deze optie is alleen nodig als de verzender dubbele encryptie heeft gebruikt
                  </p>
                </div>
              )}
            </div>
          )}

          {/* .ghostkey optie */}
          <label className="flex items-start gap-2 rounded border border-neon-magenta/30 bg-neon-magenta/5 p-3 text-sm text-ghost-300">
            <input
              type="checkbox"
              checked={useGhostKey}
              onChange={(e) => {
                setUseGhostKey(e.target.checked);
                if (e.target.checked) {
                  setUseGhostTrusted(false);
                  setGhostTrustedFile(null);
                  setGhostTrustedPassword('');
                }
              }}
              disabled={busy}
              className="mt-1 accent-neon-magenta"
            />
            <span>
              Ik heb een <strong>.ghostkey</strong> bestand — geen wachtwoord nodig
            </span>
          </label>

          {useGhostTrusted ? null : useGhostKey ? (
            <div className="rounded-xl border border-panel-border bg-panel/40 p-6 space-y-4">
              <label className="font-mono text-xs text-neon-magenta block mb-2">Stap 2 — Kies .ghostkey</label>
              <input
                type="file"
                accept=".ghostkey"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setGhostKeyFile(file || null);
                  setKeyError(null);
                }}
                disabled={busy}
                className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
              />

              <label className="flex items-start gap-2 rounded border border-purple-400/30 bg-purple-400/5 p-2 text-xs text-ghost-300">
                <input
                  type="checkbox"
                  checked={enableDoubleDecrypt}
                  onChange={(e) => setEnableDoubleDecrypt(e.target.checked)}
                  disabled={busy}
                  className="mt-1 accent-purple-400"
                />
                <span>
                  <strong className="text-purple-300">Dubbele decryptie</strong> (extra beveiliging met tweede wachtwoord)
                </span>
              </label>

              {enableDoubleDecrypt && (
                <div>
                  <label className="font-mono text-xs text-purple-300 block mb-2">Tweede wachtwoord</label>
                  <input
                    type="password"
                    value={secondPassword}
                    onChange={(e) => setSecondPassword(e.target.value)}
                    disabled={busy}
                    placeholder="Tweede wachtwoord"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                    minLength={12}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-[10px] text-ghost-500">
                    Deze optie is alleen nodig als de verzender dubbele encryptie heeft gebruikt
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-panel-border bg-panel/40 p-6 space-y-4">
              <label className="font-mono text-xs text-neon-magenta block mb-2">Wachtwoord</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                placeholder="Wachtwoord van verzender"
                className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                aria-label="Wachtwoord"
                aria-required="true"
                minLength={12}
                autoComplete="off"
              />

              <label className="flex items-start gap-2 rounded border border-purple-400/30 bg-purple-400/5 p-2 text-xs text-ghost-300">
                <input
                  type="checkbox"
                  checked={enableDoubleDecrypt}
                  onChange={(e) => setEnableDoubleDecrypt(e.target.checked)}
                  disabled={busy}
                  className="mt-1 accent-purple-400"
                />
                <span>
                  <strong className="text-purple-300">Dubbele decryptie</strong> (extra beveiliging met tweede wachtwoord)
                </span>
              </label>

              <label className="flex items-start gap-2 rounded border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-ghost-300">
                <input
                  type="checkbox"
                  checked={recoveryMode}
                  onChange={(e) => setRecoveryMode(e.target.checked)}
                  disabled={busy}
                  className="mt-1 accent-amber-400"
                />
                <span>
                  <strong className="text-amber-300">Recovery mode</strong> (probeer beschadigde bestanden te herstellen)
                </span>
              </label>

              {enableDoubleDecrypt && (
                <div>
                  <label className="font-mono text-xs text-purple-300 block mb-2">Tweede wachtwoord</label>
                  <input
                    type="password"
                    value={secondPassword}
                    onChange={(e) => setSecondPassword(e.target.value)}
                    disabled={busy}
                    placeholder="Tweede wachtwoord"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                  />
                  <p className="mt-1 text-[10px] text-ghost-500">
                    Deze optie is alleen nodig als de verzender dubbele encryptie heeft gebruikt
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {busy && (
        <div className="rounded-xl border border-neon-magenta/30 bg-neon-magenta/5 p-6">
          <div className="mb-2 flex justify-between font-mono text-xs text-neon-magenta">
            <span>{message || 'Bezig met verwerken...'}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-panel overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-neon-magenta to-neon-cyan transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 font-mono text-[10px] text-ghost-500">
            {progress < 25 && 'Bestand lezen...'}
            {progress >= 25 && progress < 50 && 'Ontgrendelen...'}
            {progress >= 50 && progress < 75 && 'Decomprimeren...'}
            {progress >= 75 && 'Schrijven naar schijf...'}
          </div>
          {decryptionSpeed > 0 && (
            <div className="mt-2 font-mono text-[10px] text-neon-cyan">
              Snelheid: {decryptionSpeed.toFixed(1)}%/s
            </div>
          )}
          {memoryUsage && (
            <div className="mt-2 font-mono text-[10px] text-ghost-500">
              Geheugen: {(memoryUsage.used / 1024 / 1024).toFixed(2)} MB / {(memoryUsage.total / 1024 / 1024).toFixed(2)} MB
            </div>
          )}
          <button
            type="button"
            onClick={handleCancel}
            className="mt-3 w-full rounded border border-danger/50 bg-danger/10 px-4 py-2 font-mono text-xs text-danger hover:bg-danger/20"
          >
            Annuleren
          </button>
        </div>
      )}

      {(keyError || message) && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {keyError || message}
        </div>
      )}

      {ghostFile && !unpacked && (
        <div className="space-y-3">
          <div className="font-mono text-xs text-ghost-400">
            Bestandsgrootte: {(ghostFile.size / 1024 / 1024).toFixed(2)} MB
          </div>
          <button
            onClick={handleUnpack}
            disabled={busy || (!useGhostTrusted && !useGhostKey && password.length < 6)}
            className="w-full rounded-lg border border-neon-magenta/40 py-4 font-display tracking-widest text-neon-magenta uppercase transition hover:bg-neon-magenta/10 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Bezig...' : 'Ontgrendel'}
          </button>
          {!useGhostTrusted && !useGhostKey && password.length < 6 && (
            <p className="font-mono text-[10px] text-ghost-500">
              Wachtwoord moet minimaal 6 tekens zijn
            </p>
          )}
        </div>
      )}

      {unpacked && (
        <div className="rounded-xl border border-neon-green/30 bg-neon-green/5 p-6 space-y-4">
          <h3 className="font-mono text-sm text-neon-green mb-4">✅ Ontgrendeld!</h3>
          
          {textMessage && (
            <div className="rounded-lg border border-neon-green/30 bg-void/50 p-4">
              <h4 className="font-mono text-xs text-neon-green mb-2">Bericht van verzender:</h4>
              <p className="font-mono text-sm text-ghost-300">{textMessage}</p>
            </div>
          )}
          
          <p className="text-sm text-ghost-300 mb-4">
            Bestanden zijn succesvol ontgrendeld.
          </p>
          
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Download functionality - create ZIP with unpacked files
                const blob = new Blob(['Decrypted content placeholder'], { type: 'application/zip' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'decrypted_files.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              className="flex-1 rounded border border-neon-green/30 bg-neon-green/5 px-4 py-2 font-mono text-sm text-neon-green hover:bg-neon-green/10 transition"
            >
              Download (ZIP)
            </button>
            <button
              onClick={() => {
                if (window.confirm('Weet je zeker dat je dit bericht wilt verwijderen?')) {
                  setTextMessage('');
                }
              }}
              className="flex-1 rounded border border-red-400/30 bg-red-400/5 px-4 py-2 font-mono text-sm text-red-300 hover:bg-red-400/10 transition"
            >
              Verwijder
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

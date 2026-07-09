import { useState, useEffect, useCallback } from 'react';

interface GhostTrustedItem {
  id: string;
  name: string;
  password: string;
  createdAt: number;
  active: boolean;
}

// Encrypt wachtwoorden voor opslag in localStorage (AES-GCM encryption)
const STORAGE_KEY = 'ghostTrustedItems';
const ENCRYPTION_KEY = 'ghostvault-ghosttrusted-encryption';

// Verbeterde encryptie met Web Crypto API (AES-GCM)
async function encryptAES(text: string): Promise<string> {
  try {
    // Genereer een sleutel van de master key
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(ENCRYPTION_KEY),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(text)
    );
    
    // Combineer salt, iv en encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error('Encryptie fout:', error);
    // Fallback naar XOR als Web Crypto API faalt
    return simpleEncryptFallback(text);
  }
}

// Verbeterde decryptie met Web Crypto API (AES-GCM)
async function decryptAES(encoded: string): Promise<string> {
  try {
    const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    
    if (combined.length < 28) { // 16 salt + 12 iv minimum
      return '';
    }
    
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);
    
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(ENCRYPTION_KEY),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );
    
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryptie fout:', error);
    // Fallback naar XOR als Web Crypto API faalt
    return simpleDecryptFallback(encoded);
  }
}

// Fallback XOR encryptie (compatibiliteit)
function simpleEncryptFallback(text: string): string {
  const key = ENCRYPTION_KEY;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return btoa(result);
}

// Fallback XOR decryptie (compatibiliteit)
function simpleDecryptFallback(encoded: string): string {
  try {
    const text = atob(encoded);
    const key = ENCRYPTION_KEY;
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return result;
  } catch {
    return '';
  }
}

// Password strength validation
function validatePasswordStrength(password: string): { valid: boolean; error?: string } {
  if (!password || password.length === 0) {
    return { valid: false, error: 'Wachtwoord mag niet leeg zijn' };
  }
  
  if (password.length < 12) {
    return { valid: false, error: 'Wachtwoord moet minimaal 12 tekens zijn' };
  }
  
  if (password.length > 500) {
    return { valid: false, error: 'Wachtwoord mag maximaal 500 tekens zijn' };
  }
  
  // Check for complexity: at least one uppercase, one lowercase, one number, one special char
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  
  if (!hasUppercase) {
    return { valid: false, error: 'Wachtwoord moet minimaal één hoofdletter bevatten' };
  }
  
  if (!hasLowercase) {
    return { valid: false, error: 'Wachtwoord moet minimaal één kleine letter bevatten' };
  }
  
  if (!hasNumber) {
    return { valid: false, error: 'Wachtwoord moet minimaal één cijfer bevatten' };
  }
  
  if (!hasSpecial) {
    return { valid: false, error: 'Wachtwoord moet minimaal één speciaal teken bevatten' };
  }
  
  return { valid: true };
}

export default function GhostTrustedManager() {
  // ALL useState calls must be at the top to maintain hook order
  const [trustedItems, setTrustedItems] = useState<GhostTrustedItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // Try XOR fallback first for backward compatibility
        try {
          const xorDecrypted = simpleDecryptFallback(saved);
          if (xorDecrypted && xorDecrypted.length > 0) {
            return JSON.parse(xorDecrypted);
          }
        } catch {
          // XOR failed, try AES-GCM
        }
        
        // Try AES-GCM (async, but we need sync for initial load)
        // For now, return empty and let useEffect handle it
        return [];
      }
    } catch (error) {
      console.error('Error loading GhostTrusted items:', error);
    }
    return [];
  });
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadPassword, setUploadPassword] = useState('');
  const [error, setError] = useState('');
  
  // Load AES-GCM encrypted data on mount
  useEffect(() => {
    const loadAESData = async () => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const decrypted = await decryptAES(saved);
          if (decrypted && decrypted.length > 0) {
            try {
              const items = JSON.parse(decrypted);
              setTrustedItems(items);
            } catch {
              // AES-GCM failed, already tried XOR in initial state
            }
          }
        }
      } catch (error) {
        console.error('Error loading AES-GCM encrypted data:', error);
      }
    };
    loadAESData();
  }, []);

  useEffect(() => {
    const saveItems = async () => {
      try {
        const encrypted = await encryptAES(JSON.stringify(trustedItems));
        localStorage.setItem(STORAGE_KEY, encrypted);
      } catch (error) {
        console.error('Error saving GhostTrusted items:', error);
        // Fallback to XOR if AES fails
        try {
          const encrypted = simpleEncryptFallback(JSON.stringify(trustedItems));
          localStorage.setItem(STORAGE_KEY, encrypted);
        } catch (fallbackError) {
          console.error('Fallback save also failed:', fallbackError);
        }
      }
    };
    saveItems();
  }, [trustedItems]);

  // Expose trustedItems for other components (only once)
  useEffect(() => {
    (window as any).getGhostTrustedItems = () => trustedItems;
    return () => {
      delete (window as any).getGhostTrustedItems;
    };
  }, [trustedItems]);

  // Callbacks and memoized values come after all useEffect calls
  const generatePassword = useCallback(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';
    const array = new Uint32Array(120);
    crypto.getRandomValues(array);
    for (let i = 0; i < 120; i++) {
      password += chars[array[i]! % chars.length];
    }
    // Validate generated password
    if (password.length < 12) {
      console.error('Generated password too short');
      return;
    }
    setNewPassword(password);
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    // Validate input
    if (!text || text.length === 0) {
      console.error('Cannot copy empty text to clipboard');
      return;
    }
    
    if (text.length > 10000) {
      console.error('Text too long to copy to clipboard (max 10000 characters)');
      return;
    }
    
    navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy to clipboard:', err);
    });
  }, []);


  const addTrusted = useCallback(() => {
    // Validate inputs
    if (!newName || !newPassword) return;
    
    // Validate name is not just whitespace
    if (newName.trim().length === 0) {
      setError('Naam mag niet leeg zijn');
      return;
    }
    
    // Sanitize name to prevent XSS
    const sanitizedName = newName.replace(/[<>\"'&]/g, '');
    if (sanitizedName.length < 2) {
      setError('Naam moet minimaal 2 tekens zijn');
      return;
    }
    
    if (sanitizedName.length > 100) {
      setError('Naam mag maximaal 100 tekens zijn');
      return;
    }
    
    // Validate password strength
    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      setError(passwordValidation.error || 'Ongeldig wachtwoord');
      return;
    }
    
    setError('');
    const newItem: GhostTrustedItem = {
      id: Date.now().toString(),
      name: sanitizedName,
      password: newPassword,
      createdAt: Date.now(),
      active: true,
    };
    setTrustedItems([...trustedItems, newItem]);
    setNewName('');
    setNewPassword('');
    
    // Download het .ghosttrusted bestand automatisch
    const blob = new Blob([newPassword], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Sanitize filename for download
    const safeFilename = sanitizedName.replace(/[<>:\"/\\|?*]/g, '_');
    a.download = `${safeFilename}.ghosttrusted`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [newName, newPassword, trustedItems]);

  const deleteTrusted = useCallback((id: string) => {
    setTrustedItems(trustedItems.filter(item => item.id !== id));
  }, [trustedItems]);

  const toggleActive = useCallback((id: string) => {
    setTrustedItems(trustedItems.map(item =>
      item.id === id ? { ...item, active: !item.active } : item
    ));
  }, [trustedItems]);

  const handleUpload = useCallback(() => {
    // Validate inputs
    if (!uploadName || !uploadPassword) return;
    
    // Sanitize name to prevent XSS
    const sanitizedName = uploadName.replace(/[<>\"'&]/g, '');
    if (sanitizedName.length < 2) {
      setError('Naam moet minimaal 2 tekens zijn');
      return;
    }
    
    if (sanitizedName.length > 100) {
      setError('Naam mag maximaal 100 tekens zijn');
      return;
    }
    
    if (uploadPassword.length < 6) {
      setError('Wachtwoord moet minimaal 6 tekens zijn');
      return;
    }
    
    if (uploadPassword.length > 500) {
      setError('Wachtwoord mag maximaal 500 tekens zijn');
      return;
    }
    
    setError('');
    const newItem: GhostTrustedItem = {
      id: Date.now().toString(),
      name: sanitizedName,
      password: uploadPassword,
      createdAt: Date.now(),
      active: true,
    };
    setTrustedItems([...trustedItems, newItem]);
    setUploadName('');
    setUploadPassword('');
  }, [uploadName, uploadPassword, trustedItems]);

  return (
    <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
      <h2 className="font-display text-2xl text-amber-400 mb-6">GhostTrusted Manager</h2>

      <div className="mb-6 rounded-lg border border-panel-border bg-void/50 p-4">
        <h3 className="font-mono text-sm text-ghost-300 mb-4">Nieuwe GhostTrusted Maken</h3>
        {error && (
          <div className="mb-4 p-2 rounded bg-danger/10 border border-danger/30">
            <p className="font-mono text-xs text-danger">{error}</p>
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="font-mono text-xs text-ghost-500 block mb-2">Naam</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Bijv. vriend1, backup, etc."
              className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
            />
          </div>
          <div>
            <label className="font-mono text-xs text-ghost-500 block mb-2">Wachtwoord (120 tekens)</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Genereer of typ een wachtwoord"
                maxLength={120}
                className="flex-1 rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200"
              />
              <button
                type="button"
                onClick={() => setNewPassword(newPassword === '' ? newPassword : newPassword)}
                className="px-3 py-2 rounded border border-panel-border bg-void font-mono text-xs text-ghost-300 hover:bg-panel/30"
                title="Toon/verberg wachtwoord"
              >
                👁️
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={generatePassword}
                className="font-mono text-[10px] text-amber-400 hover:text-amber-300"
              >
                Genereer wachtwoord
              </button>
              {newPassword && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(newPassword)}
                  className="font-mono text-[10px] text-blue-400 hover:text-blue-300"
                >
                  Kopieer
                </button>
              )}
            </div>
          </div>
          <button
            onClick={addTrusted}
            className="w-full rounded border border-amber-400/30 bg-amber-400/5 px-4 py-2 font-mono text-sm text-amber-300 hover:bg-amber-400/10 transition"
          >
            Toevoegen
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-panel-border bg-void/50 p-4">
        <h3 className="font-mono text-sm text-ghost-300 mb-4">GhostTrusted Uploaden</h3>
        <div className="space-y-4">
          <div
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file && file.name.endsWith('.ghosttrusted')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  const password = event.target?.result as string;
                  setUploadName(file.name.replace('.ghosttrusted', ''));
                  setUploadPassword(password);
                };
                reader.readAsText(file);
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 font-mono text-sm cursor-pointer transition ${
              uploadPassword
                ? 'border-amber-400 bg-amber-400/10 text-amber-300'
                : 'border-panel-border bg-void/50 text-ghost-300 hover:border-amber-400 hover:text-amber-300'
            }`}
          >
            <label className="flex items-center justify-center gap-2 cursor-pointer w-full h-full">
              <input
                type="file"
                accept=".ghosttrusted"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const password = event.target?.result as string;
                      setUploadName(file.name.replace('.ghosttrusted', ''));
                      setUploadPassword(password);
                    };
                    reader.readAsText(file);
                  }
                }}
                className="hidden"
              />
              <span className="text-2xl">📤</span>
              <span>{uploadPassword ? uploadName : 'Sleep .ghosttrusted bestand hier of klik om te uploaden'}</span>
            </label>
          </div>
          {uploadPassword && (
            <button
              onClick={handleUpload}
              className="w-full rounded border border-amber-400/30 bg-amber-400/5 px-4 py-2 font-mono text-sm text-amber-300 hover:bg-amber-400/10 transition"
            >
              Toevoegen aan lijst
            </button>
          )}
        </div>
      </div>

      <div>
        <h3 className="font-mono text-sm text-ghost-300 mb-4">Opgeslagen GhostTrusted ({trustedItems.length})</h3>
        {trustedItems.length === 0 ? (
          <p className="font-mono text-xs text-ghost-500">Nog geen GhostTrusted opgeslagen</p>
        ) : (
          <div className="space-y-2">
            {trustedItems.map((item) => (
              <div
                key={item.id}
                className="rounded border border-panel-border bg-void/50 p-3 flex items-center justify-between"
              >
                <div className="flex-1">
                  <div className="font-mono text-sm text-ghost-300">{item.name}</div>
                  <div className="font-mono text-[10px] text-ghost-500">
                    Aangemaakt: {new Date(item.createdAt).toLocaleString()}
                  </div>
                  <div className="font-mono text-[10px] text-ghost-600">
                    Status: {item.active ? 'Actief' : 'Inactief'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      // Download het .ghosttrusted bestand
                      const blob = new Blob([item.password], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${item.name}.ghosttrusted`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="font-mono text-[10px] px-2 py-1 rounded bg-blue-400/10 text-blue-400 border border-blue-400/30 hover:bg-blue-400/20"
                    title="Download .ghosttrusted bestand"
                  >
                    Download
                  </button>
                  <button
                    onClick={() => copyToClipboard(item.password)}
                    className="font-mono text-[10px] px-2 py-1 rounded bg-purple-400/10 text-purple-400 border border-purple-400/30 hover:bg-purple-400/20"
                    title="Kopieer wachtwoord"
                  >
                    Kopieer
                  </button>
                  <button
                    onClick={() => toggleActive(item.id)}
                    className={`font-mono text-[10px] px-2 py-1 rounded ${
                      item.active
                        ? 'bg-green-400/10 text-green-400 border border-green-400/30'
                        : 'bg-red-400/10 text-red-400 border border-red-400/30'
                    }`}
                    title={item.active ? 'Deactiveer' : 'Activeer'}
                  >
                    {item.active ? 'Actief' : 'Inactief'}
                  </button>
                  <button
                    onClick={() => deleteTrusted(item.id)}
                    className="font-mono text-[10px] px-2 py-1 rounded bg-red-400/10 text-red-400 border border-red-400/30 hover:bg-red-400/20"
                    title="Verwijder"
                  >
                    Verwijder
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

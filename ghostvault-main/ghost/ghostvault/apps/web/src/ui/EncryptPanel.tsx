import { useState, useEffect, useMemo, useCallback } from 'react';
import Toast from './Toast';
import { packToGhostV5 } from '../core';
import { getLogger } from '../core';
import { loadConfig } from '../core/config';
import JSZip from 'jszip';

const logger = getLogger('encrypt');

// Helper functions for progress visualization
const formatBytes = (bytes: number): string => {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes < 0) return '0 B';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Alias for formatBytes for consistency
const formatFileSize = formatBytes;

const formatETA = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
};

interface FileItem {
  file: File;
  path: string;
  size: number;
  lastModified?: number;
}

interface Settings {
  compressionLevel: number;
  enableCompression: boolean;
  enableDeduplication: boolean;
  enableChecksum: boolean;
  emitGhostKey: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  compressionLevel: 3,
  enableCompression: true,
  enableDeduplication: true,
  enableChecksum: true,
  emitGhostKey: true,
};

// Helper function to get file icon
const getFileIcon = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    'pdf': '📄',
    'doc': '📝', 'docx': '📝',
    'xls': '📊', 'xlsx': '📊',
    'ppt': '📽️', 'pptx': '📽️',
    'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️',
    'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬',
    'mp3': '🎵', 'wav': '🎵', 'flac': '🎵',
    'zip': '📦', 'rar': '📦', '7z': '📦',
    'txt': '📃',
    'js': '📜', 'ts': '📜', 'jsx': '📜', 'tsx': '📜',
    'html': '🌐', 'css': '🎨',
    'json': '📋', 'xml': '📋',
    'exe': '⚙️', 'msi': '⚙️',
    'py': '🐍', 'java': '☕', 'cpp': '⚡', 'c': '⚡', 'go': '🐹', 'rs': '🦀',
  };
  return iconMap[ext] || '📄';
};

export default function EncryptPanel() {
  // ALL useState calls must be at the top to maintain hook order
  const [files, setFiles] = useState<FileItem[]>([]);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [compressionProgress, setCompressionProgress] = useState<{ current: number; total: number; percentage: number } | null>(null);
  const [minPasswordLength, setMinPasswordLength] = useState(8);
  const [detailedProgress, setDetailedProgress] = useState<{
    currentFile: string;
    currentFileProgress: number;
    totalFiles: number;
    processedFiles: number;
    speed: number; // MB/s
    eta: number; // seconds
    totalSize: number;
    processedSize: number;
    startTime: number;
  } | null>(null);
  const [compressionLevel, setCompressionLevel] = useState(DEFAULT_SETTINGS.compressionLevel);
  const [fileName, setFileName] = useState('vault');
  const [simpleModeStep2, setSimpleModeStep2] = useState(true);
  const [simpleModeStep3, setSimpleModeStep3] = useState(true);
  const [enableChunking, setEnableChunking] = useState(true);
  const [chunkSize, setChunkSize] = useState(1024 * 1024); // 1MB default
  const [enableChecksum, setEnableChecksum] = useState(DEFAULT_SETTINGS.enableChecksum);
  const [enableCompression, setEnableCompression] = useState(DEFAULT_SETTINGS.enableCompression);
  const [compressionFormat, setCompressionFormat] = useState<'zstd' | 'lzma2' | 'brotli' | 'none' | 'auto'>('auto');
  const [enableDeduplication, setEnableDeduplication] = useState(DEFAULT_SETTINGS.enableDeduplication);
  const [enableStreamingDecrypt, setEnableStreamingDecrypt] = useState(true);
  const [enableMemoryWipe, setEnableMemoryWipe] = useState(true);
  const [autoDeleteAfter, setAutoDeleteAfter] = useState('');
  const [enableGhostTrusted, setEnableGhostTrusted] = useState(false);
  const [ghostTrustedPasswords, setGhostTrustedPasswords] = useState<string[]>([]);
  const [noPasswordMode, setNoPasswordMode] = useState(false);
  const [ghostTrustedOnlyMode, setGhostTrustedOnlyMode] = useState(false);
  const [selectedGhostTrusted, setSelectedGhostTrusted] = useState<string[]>([]);
  const [enableDoubleEncryption, setEnableDoubleEncryption] = useState(false);
  const [secondPassword, setSecondPassword] = useState('');
  const [secondPasswordConfirm, setSecondPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showSecondPassword, setShowSecondPassword] = useState(false);
  const [showSecondPasswordConfirm, setShowSecondPasswordConfirm] = useState(false);
  const [emitGhostKey, setEmitGhostKey] = useState(DEFAULT_SETTINGS.emitGhostKey);
  const [customIcon, setCustomIcon] = useState<File | null>(null);
  const [iconError, setIconError] = useState('');
  const [packError, setPackError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [isDirectory, setIsDirectory] = useState(false);
  const [textMessage, setTextMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [memoryUsage, setMemoryUsage] = useState<{ used: number; total: number } | null>(null);
  const [compressionPreview, setCompressionPreview] = useState<{ original: number; compressed: number; ratio: number } | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [forceAllFiles, setForceAllFiles] = useState(false);
  const [selfDestruct, setSelfDestruct] = useState(false);
  const [hiddenMetadata, setHiddenMetadata] = useState(true);
  const [decoyChunks, setDecoyChunks] = useState(true);
  const [maxOpens, setMaxOpens] = useState('');
  const [unlockAt, setUnlockAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // Callbacks and memoized values come after all useState calls
  const handlePasswordChange = useCallback((value: string) => {
    const sanitized = value.replace(/[\0-\x1F\x7F]/g, '');
    setPassword(sanitized);
  }, []);
  
  const handleConfirmChange = useCallback((value: string) => {
    const sanitized = value.replace(/[\0-\x1F\x7F]/g, '');
    setConfirm(sanitized);
  }, []);

  // Auto-expand all folders when files change - REMOVED: No longer needed with flat list

  // Monitor memory usage (optimized - only update during operations with RAF)
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

  // Compression preview - estimate compression ratio with debouncing
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | undefined;

    if (files.length > 0 && enableCompression) {
      const estimateCompression = async () => {
        try {
          const totalSize = files.reduce((sum, item) => sum + item.file.size, 0);

          // Simple estimation based on file type (no sampling for performance)
          let estimatedRatio = 0.5; // Default 50% compression
          const fileType = files[0]?.file.type || '';

          if (fileType.startsWith('image/') || fileType.startsWith('video/') || fileType.startsWith('audio/')) {
            estimatedRatio = 0.1; // Already compressed
          } else if (fileType.includes('zip') || fileType.includes('rar') || fileType.includes('7z')) {
            estimatedRatio = 0; // Already compressed
          } else if (fileType.includes('text') || fileType.includes('json') || fileType.includes('xml')) {
            estimatedRatio = 0.7; // Text compresses well
          }

          const estimatedCompressed = totalSize * (1 - estimatedRatio);
          setCompressionPreview({
            original: totalSize,
            compressed: estimatedCompressed,
            ratio: estimatedRatio * 100
          });
        } catch (error) {
          console.error('Error estimating compression:', error);
        }
      };

      timeoutId = setTimeout(estimateCompression, 300); // 300ms debounce
    } else {
      setCompressionPreview(null);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, enableCompression]);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('ghostvault-settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings) as Settings;
        setCompressionLevel(settings.compressionLevel || DEFAULT_SETTINGS.compressionLevel);
        setEnableCompression(settings.enableCompression ?? DEFAULT_SETTINGS.enableCompression);
        setEnableDeduplication(settings.enableDeduplication ?? DEFAULT_SETTINGS.enableDeduplication);
        setEnableChecksum(settings.enableChecksum ?? DEFAULT_SETTINGS.enableChecksum);
        setEmitGhostKey(settings.emitGhostKey ?? DEFAULT_SETTINGS.emitGhostKey);
      } catch (error) {
        console.error('Error loading settings:', error);
      }
    }

    // Load config to get minPasswordLength
    loadConfig().then(config => {
      setMinPasswordLength(config.security.minPasswordLength);
    }).catch(error => {
      console.error('Error loading config:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save settings to localStorage when they change
  useEffect(() => {
    const settings: Settings = {
      compressionLevel,
      enableCompression,
      enableDeduplication,
      enableChecksum,
      emitGhostKey,
    };
    localStorage.setItem('ghostvault-settings', JSON.stringify(settings));
  }, [compressionLevel, enableCompression, enableDeduplication, enableChecksum, emitGhostKey]);

  const calculatePasswordStrength = useCallback((pwd: string): { strength: number; label: string; color: string } => {
    if (pwd.length === 0) return { strength: 0, label: '', color: '' };
    
    let strength = 0;
    
    // Length check
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (pwd.length >= 16) strength++;
    
    // Character variety
    if (/[a-z]/.test(pwd)) strength++;
    if (/[A-Z]/.test(pwd)) strength++;
    if (/[0-9]/.test(pwd)) strength++;
    if (/[^a-zA-Z0-9]/.test(pwd)) strength++;
    
    // Common patterns (penalty)
    if (/^[a-zA-Z]+$/.test(pwd)) strength--;
    if (/^[0-9]+$/.test(pwd)) strength--;
    if (/^[a-z]+$/.test(pwd)) strength--;
    
    // Normalize strength to 0-5
    strength = Math.max(0, Math.min(5, strength));

    const labels = ['', 'Zwak', 'Matig', 'Goed', 'Sterk', 'Zeer sterk'];
    const colors = ['', 'text-red-400', 'text-yellow-400', 'text-green-400', 'text-blue-400', 'text-purple-400'];

    return { strength, label: labels[strength] || '', color: colors[strength] || '' };
  }, []);

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    // Check if file exists
    if (!file) {
      return { valid: false, error: 'Bestand bestaat niet' };
    }
    
    // Check for empty filename
    if (!file.name || file.name.trim().length === 0) {
      return { valid: false, error: 'Bestandsnaam mag niet leeg zijn' };
    }
    
    // Check file size (max 10TB)
    const MAX_SIZE = 10 * 1024 * 1024 * 1024 * 1024; // 10TB
    if (file.size > MAX_SIZE) {
      return { valid: false, error: `Bestand is te groot (${formatFileSize(file.size)} > 10TB)` };
    }
    
    // Check file name length
    if (file.name.length > 255) {
      return { valid: false, error: 'Bestandsnaam is te lang (max 255 karakters)' };
    }
    
    // Check for empty extension (e.g., "file." or just ".")
    const parts = file.name.split('.');
    if (parts.length > 1 && parts[parts.length - 1]?.length === 0) {
      return { valid: false, error: 'Bestandsextensie mag niet leeg zijn' };
    }
    
    // Check for path traversal attempts
    if (file.name.includes('..') || file.name.startsWith('/') || file.name.startsWith('\\')) {
      return { valid: false, error: 'Bestandsnaam bevat ongeldige pad karakters' };
    }
    
    // Check for invalid characters in file name
    const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
    if (invalidChars.test(file.name)) {
      return { valid: false, error: 'Bestandsnaam bevat ongeldige karakters' };
    }
    
    return { valid: true };
  };

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    
    // Limit concurrent file processing to prevent memory overload
    const MAX_FILES_AT_ONCE = 1000;
    const filesToProcess = selectedFiles.slice(0, MAX_FILES_AT_ONCE);
    
    if (selectedFiles.length > MAX_FILES_AT_ONCE) {
      showToast(`Alleen eerste ${MAX_FILES_AT_ONCE} bestanden worden verwerkt vanwege limiet`, 'info');
    }
    
    const fileItems: FileItem[] = [];
    const errors: string[] = [];
    let processedCount = 0;

    // Process files in batches to avoid UI freeze
    const processBatch = (batch: File[], startIndex: number) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          batch.forEach((file, index) => {
            // Validate file exists
            if (!file) {
              errors.push(`Ongeldig bestand op index ${startIndex + index}: null`);
              return;
            }

            const validation = validateFile(file);
            if (validation.valid) {
              fileItems.push({
                file,
                path: file.webkitRelativePath || file.name,
                size: file.size,
                lastModified: file.lastModified
              });
            } else {
              errors.push(`${file.name}: ${validation.error}`);
            }
          });
          resolve();
        }, 0);
      });
    };

    // Process files in batches of 100
    const BATCH_SIZE = 100;
    const processAllBatches = async () => {
      for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
        const batch = filesToProcess.slice(i, i + BATCH_SIZE);
        await processBatch(batch, i);
        processedCount += batch.length;
        
        // Update UI periodically
        if (processedCount % BATCH_SIZE === 0) {
          setMessage(`Bestanden laden: ${processedCount}/${filesToProcess.length}`);
          // Yield to UI thread
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      if (errors.length > 0) {
        setPackError(errors.slice(0, 10).join('; ') + (errors.length > 10 ? `... en ${errors.length - 10} meer` : ''));
      }

      // Voeg toe aan bestaande bestanden in plaats van te vervangen
      setFiles(prev => {
        const newFiles = [...prev, ...fileItems];
        // Limit total files to prevent memory issues
        if (newFiles.length > 10000) {
          showToast(`Maximum van 10000 bestanden bereikt, extra bestanden genegeerd`, 'error');
          return newFiles.slice(0, 10000);
        }
        return newFiles;
      });
      
      setMessage('');
    };

    processAllBatches().catch(error => {
      console.error('Error processing files:', error);
      setPackError(`Fout bij verwerken bestanden: ${error instanceof Error ? error.message : 'Onbekende fout'}`);
    });
  }, [validateFile, showToast]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedItems = Array.from(e.dataTransfer.items);
    
    // Limit concurrent file processing to prevent memory overload
    const MAX_FILES_AT_ONCE = 1000;
    const itemsToProcess = droppedItems.slice(0, MAX_FILES_AT_ONCE);
    
    if (droppedItems.length > MAX_FILES_AT_ONCE) {
      showToast(`Alleen eerste ${MAX_FILES_AT_ONCE} items worden verwerkt vanwege limiet`, 'info');
    }
    
    const newFiles: FileItem[] = [];
    const errors: string[] = [];
    let processedCount = 0;

    // Process items in batches to avoid UI freeze
    const processBatch = (batch: DataTransferItem[], startIndex: number) => {
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          batch.forEach((item, index) => {
            if (item.kind === 'file') {
              const file = item.getAsFile();
              if (file) {
                // Validate file exists
                if (!file || file.size === undefined) {
                  errors.push(`Ongeldig bestand op index ${startIndex + index}: null`);
                  return;
                }

                const validation = validateFile(file);
                if (validation.valid) {
                  newFiles.push({
                    file,
                    path: file.webkitRelativePath || file.name,
                    size: file.size,
                    lastModified: file.lastModified
                  });
                } else {
                  errors.push(`${file.name}: ${validation.error}`);
                }
              }
            }
          });
          resolve();
        }, 0);
      });
    };

    // Process items in batches of 100
    const BATCH_SIZE = 100;
    const processAllBatches = async () => {
      for (let i = 0; i < itemsToProcess.length; i += BATCH_SIZE) {
        const batch = itemsToProcess.slice(i, i + BATCH_SIZE);
        await processBatch(batch, i);
        processedCount += batch.length;
        
        // Update UI periodically
        if (processedCount % BATCH_SIZE === 0) {
          setMessage(`Items laden: ${processedCount}/${itemsToProcess.length}`);
          // Yield to UI thread
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      if (errors.length > 0) {
        setPackError(errors.slice(0, 10).join('; ') + (errors.length > 10 ? `... en ${errors.length - 10} meer` : ''));
      }

      // Voeg toe aan bestaande bestanden in plaats van te vervangen
      setFiles(prev => {
        const updatedFiles = [...prev, ...newFiles];
        // Limit total files to prevent memory issues
        if (updatedFiles.length > 10000) {
          showToast(`Maximum van 10000 bestanden bereikt, extra bestanden genegeerd`, 'error');
          return updatedFiles.slice(0, 10000);
        }
        return updatedFiles;
      });
      
      setMessage('');
    };

    processAllBatches().catch(error => {
      console.error('Error processing dropped items:', error);
      setPackError(`Fout bij verwerken items: ${error instanceof Error ? error.message : 'Onbekende fout'}`);
    });
  }, [validateFile, showToast]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handlePack = async () => {
    if (!files.length && !textMessage) {
      showToast('Selecteer bestanden of voeg een bericht toe', 'error');
      return;
    }
    
    // Validate password is not just whitespace
    if (!noPasswordMode && !ghostTrustedOnlyMode) {
      if (!password || password.trim().length === 0) {
        showToast('Wachtwoord mag niet leeg zijn', 'error');
        return;
      }
      if (password.length < minPasswordLength || password !== confirm) {
        showToast(`Wachtwoord moet minimaal ${minPasswordLength} tekens zijn en overeenkomen`, 'error');
        return;
      }
    }
    
    // Validate second password is not just whitespace
    if (enableDoubleEncryption) {
      if (!secondPassword || secondPassword.trim().length === 0) {
        showToast('Tweede wachtwoord mag niet leeg zijn', 'error');
        return;
      }
      if (secondPassword.length < minPasswordLength || secondPassword !== secondPasswordConfirm) {
        showToast(`Tweede wachtwoord moet minimaal ${minPasswordLength} tekens zijn en overeenkomen`, 'error');
        return;
      }
    }

    const controller = new AbortController();
    setAbortController(controller);
    setBusy(true);
    setProgress(0);
    setPackError('');

    try {
      if (batchMode && files.length > 1) {
        // Validate each file before batch processing
        for (const fileItem of files) {
          if (!fileItem || !fileItem.file) {
            showToast('Ongeldig bestand in batch', 'error');
            return;
          }
          const validation = validateFile(fileItem.file);
          if (!validation.valid) {
            showToast(`${fileItem.file.name}: ${validation.error}`, 'error');
            return;
          }
        }
        
        // Batch mode: encrypt each file individually with concurrency limit
        let completed = 0;
        const MAX_CONCURRENT = 3; // Limit concurrent operations for performance
        const queue = [...files];
        const active: Promise<void>[] = [];

        const processNext = async () => {
          if (queue.length === 0 || active.length >= MAX_CONCURRENT) return;

          const item = queue.shift();
          if (!item) return;

          const taskPromise = (async () => {
            try {
              setMessage(`Encrypten: ${item.path} (${completed + 1}/${files.length})`);
              setProgress((completed / files.length) * 100);

              const individualFileName = fileName + '_' + item.path.replace(/[^a-zA-Z0-9]/g, '_');

              logger.logEncryptionOperation('encrypt', item.size, { fileName: individualFileName, path: item.path });

              await packToGhostV5(item.file, {
                password,
                compressionLevel: enableCompression ? compressionLevel : 0,
                fileName: individualFileName + '.ghost',
                chunkSize: enableChunking ? chunkSize : undefined,
                enableChecksum,
                compressionFormat: enableCompression ? (compressionFormat === 'auto' ? undefined : compressionFormat) : undefined,
                enableDeduplication,
                enableStreamingDecrypt,
                enableMemoryWipe,
                autoDeleteAfter: autoDeleteAfter ? (parseInt(autoDeleteAfter) || undefined) : undefined,
                enableGhostTrusted,
                ghostTrustedPasswords: selectedGhostTrusted.map(id => {
                  const items = (window as any).getGhostTrustedItems?.() || [];
                  const item = items.find((i: any) => i.id === id);
                  return item?.password || '';
                }).filter(p => p),
                noPasswordMode: noPasswordMode || ghostTrustedOnlyMode,
                enableDoubleEncryption,
                secondPassword: enableDoubleEncryption ? secondPassword : undefined,
                emitGhostKey,
                cancellationToken: controller.signal
              }, (p) => {
                setProgress((completed / files.length) * 100 + (p.percent / files.length));
                setMessage(p.message || '');
              });

              logger.logGhostFileCreation({ fileName: individualFileName + '.ghost', size: item.size });
              completed++;
              logger.logFileUpload(1, item.size, { fileName: individualFileName, path: item.path });
            } catch (error) {
              const individualFileName = fileName + '_' + item.path.replace(/[^a-zA-Z0-9]/g, '_');
              console.error(`Error encrypting ${item.path}:`, error);
              logger.error(`Error encrypting ${item.path}`, error instanceof Error ? error : undefined, { fileName: individualFileName });
              setPackError(`Fout bij encrypten van ${item.path}: ${error instanceof Error ? error.message : 'Onbekende fout'}`);
            }
          })();

          active.push(taskPromise);
          taskPromise.finally(() => {
            const index = active.indexOf(taskPromise);
            if (index > -1) {
              active.splice(index, 1);
            }
            if (queue.length > 0 || active.length > 0) {
              processNext(); // Process next item
            }
          });
        };

        // Start initial batch
        for (let i = 0; i < MAX_CONCURRENT && i < files.length; i++) {
          processNext();
        }

        // Wait for all to complete
        await Promise.all(active);
        
        setProgress(100);
        setMessage('Batch encryptie voltooid');
        showToast(`${completed}/${files.length} bestanden succesvol geëncrypt`, 'success');
      } else {
        // Normal mode: pack all files into one .ghost
        let fileToPack: File;
        if (files.length === 0 && textMessage) {
          fileToPack = new File([textMessage], 'bericht.txt', { type: 'text/plain' });
        } else if (files.length === 1 && files[0]) {
          fileToPack = files[0].file;
        } else {
          // Multiple files - combineer in ZIP met JSZip
          const zip = new JSZip();
          const pathCounts = new Map<string, number>();
          
          for (const item of files) {
            const arrayBuffer = await item.file.arrayBuffer();
            let zipPath = item.path;
            
            // Handle duplicate files by adding a suffix
            const count = pathCounts.get(zipPath) || 0;
            if (count > 0) {
              const extIndex = zipPath.lastIndexOf('.');
              if (extIndex > 0) {
                zipPath = zipPath.substring(0, extIndex) + `_copy${count}` + zipPath.substring(extIndex);
              } else {
                zipPath = zipPath + `_copy${count}`;
              }
            }
            pathCounts.set(item.path, count + 1);
            
            zip.file(zipPath, arrayBuffer);
            
            // Add file metadata (last modified date)
            if (item.lastModified) {
              const metadata = {
                lastModified: item.lastModified,
                size: item.size
              };
              zip.file(zipPath + '.meta', JSON.stringify(metadata));
            }
          }
          
          // Generate ZIP with progress callback for better UX
          const zipBlob = await zip.generateAsync({ 
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          }, (metadata) => {
            if (metadata.percent) {
              setMessage(`ZIP genereren: ${metadata.percent.toFixed(0)}%`);
            }
          });
          fileToPack = new File([zipBlob], 'files.zip', { type: 'application/zip' });
        }

        await packToGhostV5(fileToPack, {
          password,
          compressionLevel: enableCompression ? compressionLevel : 0,
          fileName: fileName + '.ghost',
          chunkSize: enableChunking ? chunkSize : undefined,
          enableChecksum,
          compressionFormat: enableCompression ? (compressionFormat === 'auto' ? undefined : compressionFormat) : undefined,
          enableDeduplication,
          enableStreamingDecrypt,
          enableMemoryWipe,
          autoDeleteAfter: autoDeleteAfter ? parseInt(autoDeleteAfter) : undefined,
          enableGhostTrusted,
          ghostTrustedPasswords: selectedGhostTrusted.map(id => {
            const items = (window as any).getGhostTrustedItems?.() || [];
            const item = items.find((i: any) => i.id === id);
            return item?.password || '';
          }).filter(p => p),
          noPasswordMode: noPasswordMode || ghostTrustedOnlyMode,
          enableDoubleEncryption,
          secondPassword: enableDoubleEncryption ? secondPassword : undefined,
          emitGhostKey,
          cancellationToken: controller.signal
        }, (p) => {
          setProgress(p.percent);
          setMessage(p.message || '');
          
          // Calculate detailed progress metrics
          if (detailedProgress === null) {
            const totalSize = files.reduce((sum, f) => sum + f.size, 0);
            setDetailedProgress({
              currentFile: files[0]?.file.name || 'Unknown',
              currentFileProgress: p.percent,
              totalFiles: files.length,
              processedFiles: 0,
              speed: 0,
              eta: 0,
              totalSize,
              processedSize: 0,
              startTime: Date.now()
            });
          } else {
            const processedSize = (p.percent / 100) * detailedProgress.totalSize;
            const elapsedSeconds = (Date.now() - detailedProgress.startTime) / 1000;
            const speed = elapsedSeconds > 0 ? (processedSize / 1024 / 1024) / elapsedSeconds : 0;
            const remainingSize = detailedProgress.totalSize - processedSize;
            const eta = speed > 0 ? remainingSize / 1024 / 1024 / speed : 0;
            
            setDetailedProgress({
              ...detailedProgress,
              currentFileProgress: p.percent,
              processedSize,
              speed,
              eta
            });
          }
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'OperationCancelledError') {
        setPackError('Operatie geannuleerd door gebruiker');
        showToast('Operatie geannuleerd', 'info');
      } else if (error instanceof Error && error.name === 'ValidationError') {
        setPackError(`Validatiefout: ${error.message}`);
        showToast(`Validatiefout: ${error.message}`, 'error');
      } else if (error instanceof Error && error.name === 'EncryptionError') {
        setPackError(`Encryptiefout: ${error.message}`);
        showToast(`Encryptiefout: ${error.message}`, 'error');
      } else if (error instanceof Error && error.name === 'CompressionError') {
        setPackError(`Compressiefout: ${error.message}`);
        showToast(`Compressiefout: ${error.message}`, 'error');
      } else if (error instanceof Error && error.name === 'FileError') {
        setPackError(`Bestandsfout: ${error.message}`);
        showToast(`Bestandsfout: ${error.message}`, 'error');
      } else if (error instanceof Error && error.name === 'MemoryError') {
        setPackError(`Geheugenfout: ${error.message}. Probeer kleinere bestanden of schakel chunking in.`);
        showToast('Geheugenfout - probeer kleinere bestanden', 'error');
      } else if (error instanceof Error && error.name === 'NetworkError') {
        setPackError(`Netwerkfout: ${error.message}. Controleer je internetverbinding.`);
        showToast('Netwerkfout - controleer verbinding', 'error');
      } else {
        console.error('Pack error:', error);
        setPackError('Fout bij versleutelen: ' + (error instanceof Error ? error.message : 'Onbekende fout'));
        showToast('Fout bij versleutelen', 'error');
      }
    } finally {
      setBusy(false);
      setAbortController(null);
    }
  };

  const handleCancel = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  const handlePreview = (file: FileItem) => {
    setPreviewFile(file);
    setShowPreview(true);
  };

  const getFileTypeIcon = (file: File): string => {
    const type = file.type;
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎬';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('text') || type.includes('json') || type.includes('xml')) return '📝';
    if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return '📦';
    return '📁';
  };

  const isImageFile = (file: File): boolean => {
    return file.type.startsWith('image/');
  };

  const isTextFile = (file: File): boolean => {
    return file.type.startsWith('text/') || 
           file.name.endsWith('.txt') || 
           file.name.endsWith('.json') || 
           file.name.endsWith('.xml') ||
           file.name.endsWith('.md') ||
           file.name.endsWith('.js') ||
           file.name.endsWith('.ts') ||
           file.name.endsWith('.html') ||
           file.name.endsWith('.css');
  };

  return (
    <section className="space-y-6">
      <ol className="list-decimal space-y-2 rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 p-4 pl-6 text-sm text-ghost-300">
        <li>Kies bestanden of een map (mp3, mp4, foto's, andere .ghost — alles mag).</li>
        <li>Kies hoe je wilt vergrendelen (wachtwoord of .ghostkey).</li>
        <li>Klik op <strong className="text-neon-cyan">Genereer .ghost</strong> — download start automatisch.</li>
        <li>Stuur het .ghost bestand (+ .ghostkey als je die aanmaakte) naar je vriend.</li>
        <li>Je vriend opent tab <strong>Herstel</strong> en volgt de stappen daar.</li>
      </ol>

      <div className="grid gap-8 lg:grid-cols-2 max-w-7xl mx-auto">
        {/* Left column */}
        <div className="space-y-6">
          <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
            <h3 className="font-mono text-sm text-neon-cyan mb-4">Stap 1 — Bestanden selecteren</h3>

            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`flex items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 font-mono text-sm cursor-pointer transition ${
                isDragging
                  ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                  : 'border-panel-border bg-void/50 text-ghost-300 hover:border-neon-cyan hover:text-neon-cyan'
              }`}
              role="button"
              tabIndex={0}
              aria-label="Sleep bestanden hierheen of klik om te selecteren"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.onchange = (ev) => handleFileSelect(ev as any);
                  input.click();
                }
              }}
            >
              <label className="flex items-center justify-center gap-2 cursor-pointer w-full h-full">
                <input
                  type="file"
                  multiple={isDirectory}
                  {...(isDirectory ? { webkitdirectory: true as any } : {})}
                  onChange={handleFileSelect}
                  disabled={busy}
                  className="hidden"
                  aria-label="Bestanden selecteren"
                />
                <span className="text-2xl">📤</span>
                <span>{isDragging ? 'Laat los om te uploaden' : (isDirectory ? 'Kies een map of sleep hier' : 'Kies bestanden of sleep hier')}</span>
              </label>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.onchange = (e) => handleFileSelect(e as any);
                  input.click();
                }}
                disabled={busy}
                className="flex-1 font-mono text-xs px-4 py-2 rounded bg-panel border border-panel-border text-ghost-300 hover:border-neon-cyan transition"
                aria-label="Selecteer bestanden"
              >
                📁 Bestanden
              </button>
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.webkitdirectory = true as any;
                  input.onchange = (e) => handleFileSelect(e as any);
                  input.click();
                }}
                disabled={busy}
                className="flex-1 font-mono text-xs px-4 py-2 rounded bg-panel border border-panel-border text-ghost-300 hover:border-neon-cyan transition"
                aria-label="Selecteer map"
              >
                📂 Map
              </button>
            </div>

            {files.length > 1 && (
              <div className="mt-2 p-2 rounded bg-amber-400/10 border border-amber-400/30">
                <p className="font-mono text-[10px] text-amber-300">
                  ℹ️ {files.length} bestanden geselecteerd - alle bestanden worden verwerkt
                </p>
              </div>
            )}

            {packError && (
              <div className="mt-2 p-2 rounded bg-danger/10 border border-danger/30">
                <p className="font-mono text-[10px] text-danger">{packError}</p>
              </div>
            )}

            {files.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs text-ghost-500">
                    {files.length.toLocaleString()} bestand(en) geselecteerd
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Weet je zeker dat je alle geselecteerde bestanden wilt verwijderen?')) {
                        setFiles([]);
                      }
                    }}
                    disabled={busy}
                    className="font-mono text-[10px] text-danger/70 hover:text-danger"
                  >
                    Verwijder alles
                  </button>
                </div>

                <div className={files.length > 100 ? "max-h-96 overflow-y-auto rounded border border-panel-border bg-void/50" : "rounded border border-panel-border bg-void/50"}>
                  {files.map((fileItem, index) => (
                    <div
                      key={`${fileItem.path}-${index}`}
                      className="flex items-center justify-between px-3 py-2 border-b border-panel-border last:border-b-0 hover:bg-panel/30"
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-lg">{getFileIcon(fileItem.path)}</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs text-ghost-300 truncate block" title={fileItem.path}>
                            {fileItem.path}
                          </span>
                          <span className="font-mono text-[10px] text-ghost-500 block">
                            {formatFileSize(fileItem.size)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handlePreview(fileItem)}
                          disabled={busy}
                          className="text-neon-cyan/70 hover:text-neon-cyan text-sm"
                          title="Preview"
                        >
                          👁️
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          disabled={busy}
                          className="text-danger/70 hover:text-danger text-lg"
                          title="Verwijderen"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-mono text-sm text-neon-cyan">Stap 2 — Compressie (Zstd)</h3>
              <button
                type="button"
                onClick={() => setSimpleModeStep2((v) => !v)}
                className="shrink-0 font-mono text-[10px] text-ghost-500 hover:text-neon-cyan"
              >
                {simpleModeStep2 ? 'Meer opties ▼' : 'Minder opties ▲'}
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              {[0, 1, 3, 6, 9, 12, 15, 18, 22].map((level) => (
                <button
                  key={level}
                  onClick={() => setCompressionLevel(level)}
                  disabled={busy}
                  className={`font-mono text-xs px-3 py-1 rounded transition ${
                    compressionLevel === level
                      ? 'bg-neon-cyan text-void'
                      : 'bg-panel border border-panel-border text-ghost-300 hover:border-neon-cyan'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>

            {compressionPreview && (
              <div className="mt-3 p-2 rounded bg-neon-cyan/10 border border-neon-cyan/30">
                <p className="font-mono text-[10px] text-neon-cyan">
                  💾 Compressie preview: {formatFileSize(compressionPreview.original)} → {formatFileSize(compressionPreview.compressed)} ({compressionPreview.ratio.toFixed(1)}% besparing)
                </p>
              </div>
            )}

            {!simpleModeStep2 && (
              <div className="mt-4 space-y-4 pt-4 border-t border-panel-border">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableCompression}
                    onChange={(e) => setEnableCompression(e.target.checked)}
                    disabled={busy}
                    className="accent-neon-cyan"
                  />
                  <span className="text-sm text-ghost-300">Compressie inschakelen</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableDeduplication}
                    onChange={(e) => setEnableDeduplication(e.target.checked)}
                    disabled={busy}
                    className="accent-neon-cyan"
                  />
                  <span className="text-sm text-ghost-300">Deduplicatie inschakelen</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableChecksum}
                    onChange={(e) => setEnableChecksum(e.target.checked)}
                    disabled={busy}
                    className="accent-neon-cyan"
                  />
                  <span className="text-sm text-ghost-300">Checksum inschakelen</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableStreamingDecrypt}
                    onChange={(e) => setEnableStreamingDecrypt(e.target.checked)}
                    disabled={busy}
                    className="accent-neon-cyan"
                  />
                  <span className="text-sm text-ghost-300">Streaming decrypt</span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enableMemoryWipe}
                    onChange={(e) => setEnableMemoryWipe(e.target.checked)}
                    disabled={busy}
                    className="accent-neon-cyan"
                  />
                  <span className="text-sm text-ghost-300">Memory wipe</span>
                </label>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-mono text-sm text-neon-cyan">Stap 3 — GhostTrusted & Beveiliging</h3>
              <button
                type="button"
                onClick={() => setSimpleModeStep3((v) => !v)}
                className="shrink-0 font-mono text-[10px] text-ghost-500 hover:text-neon-cyan"
              >
                {simpleModeStep3 ? 'Meer opties ▼' : 'Minder opties ▲'}
              </button>
            </div>

            <div className="space-y-4">
              <label className="flex items-start gap-2 rounded border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-ghost-300">
                <input
                  type="checkbox"
                  checked={enableGhostTrusted}
                  onChange={(e) => {
                    setEnableGhostTrusted(e.target.checked);
                    if (e.target.checked) {
                      setEnableDoubleEncryption(false);
                    }
                  }}
                  disabled={busy || enableDoubleEncryption}
                  className="mt-1 accent-amber-400"
                />
                <span>
                  <strong className="text-amber-300">Gebruik GhostTrusted</strong> (voor vrienden)
                </span>
              </label>

              {enableGhostTrusted && (
                <div>
                  <label className="font-mono text-xs text-amber-300 block mb-2">Kies GhostTrusted uit opgeslagen lijst</label>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {(() => {
                      const ghostTrustedItems = (window as any).getGhostTrustedItems?.() || [];
                      if (ghostTrustedItems.length === 0) {
                        return (
                          <p className="font-mono text-xs text-ghost-500">
                            Geen GhostTrusted opgeslagen. Ga naar het GhostTrusted tab om er toe te voegen.
                          </p>
                        );
                      }
                      return ghostTrustedItems.filter((item: any) => item.active).map((item: any) => (
                        <label key={item.id} className="flex items-center gap-2 text-sm text-ghost-300 p-2 rounded hover:bg-panel/30">
                          <input
                            type="checkbox"
                            checked={selectedGhostTrusted.includes(item.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedGhostTrusted([...selectedGhostTrusted, item.id]);
                              } else {
                                setSelectedGhostTrusted(selectedGhostTrusted.filter(id => id !== item.id));
                              }
                            }}
                            className="accent-amber-400"
                          />
                          <span className="flex-1">{item.name}</span>
                          <span className="font-mono text-[10px] text-ghost-500">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        </label>
                      ));
                    })()}
                  </div>
                  <p className="mt-2 text-[10px] text-ghost-500">
                    Selecteer meerdere GhostTrusted voor multi-ghosttrusted support
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2 rounded border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-ghost-300">
                <input
                  type="checkbox"
                  checked={ghostTrustedOnlyMode}
                  onChange={(e) => {
                    setGhostTrustedOnlyMode(e.target.checked);
                    if (e.target.checked) {
                      setNoPasswordMode(false);
                    }
                  }}
                  disabled={busy}
                  className="mt-1 accent-amber-400"
                />
                <span>
                  <strong className="text-amber-300">GhostTrusted-only modus</strong> (geen wachtwoord, alleen GhostTrusted)
                </span>
              </label>

              <label className="flex items-start gap-2 rounded border border-red-400/30 bg-red-400/5 p-3 text-sm text-ghost-300">
                <input
                  type="checkbox"
                  checked={noPasswordMode}
                  onChange={(e) => {
                    setNoPasswordMode(e.target.checked);
                    if (e.target.checked) {
                      setGhostTrustedOnlyMode(false);
                    }
                  }}
                  disabled={busy}
                  className="mt-1 accent-red-400"
                />
                <span>
                  <strong className="text-red-300">Geen wachtwoord</strong> (niet aanbevolen, alleen voor lokaal gebruik)
                </span>
              </label>

              {!simpleModeStep3 && (
                <>
                  <label className="flex items-start gap-2 rounded border border-panel-border bg-panel/30 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={selfDestruct}
                      onChange={(e) => setSelfDestruct(e.target.checked)}
                      disabled={busy}
                      className="mt-1 accent-neon-cyan"
                    />
                    <span>
                      <strong className="text-neon-cyan">Zelfdestruct</strong> (bestand verwijdert zichzelf na ontgrendelen)
                    </span>
                  </label>

                  <label className="flex items-start gap-2 rounded border border-panel-border bg-panel/30 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={hiddenMetadata}
                      onChange={(e) => setHiddenMetadata(e.target.checked)}
                      disabled={busy}
                      className="mt-1 accent-neon-cyan"
                    />
                    <span>
                      <strong className="text-neon-cyan">Verberg metadata</strong> (verberg bestandsnamen en structure)
                    </span>
                  </label>

                  <label className="flex items-start gap-2 rounded border border-panel-border bg-panel/30 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={decoyChunks}
                      onChange={(e) => setDecoyChunks(e.target.checked)}
                      disabled={busy}
                      className="mt-1 accent-neon-cyan"
                    />
                    <span>
                      <strong className="text-neon-cyan">Decoy chunks</strong> (voeg neppe data toe voor verduistering)
                    </span>
                  </label>

                  <label className="flex items-start gap-2 rounded border border-panel-border bg-panel/30 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={enableChunking}
                      onChange={(e) => setEnableChunking(e.target.checked)}
                      disabled={busy}
                      className="mt-1 accent-neon-cyan"
                    />
                    <span>
                      <strong className="text-neon-cyan">Chunking</strong> (splits bestanden in chunks voor grote bestanden)
                    </span>
                  </label>

                  {enableChunking && (
                    <div>
                      <label className="font-mono text-xs text-ghost-500 block mb-2">Chunk grootte (MB)</label>
                      <input
                        type="number"
                        value={chunkSize / (1024 * 1024)}
                        onChange={(e) => setChunkSize(Number(e.target.value) * 1024 * 1024)}
                        disabled={busy}
                        min="1"
                        max="1024"
                        className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                      />
                    </div>
                  )}

                  <label className="flex items-start gap-2 rounded border border-panel-border bg-panel/30 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={forceAllFiles}
                      onChange={(e) => setForceAllFiles(e.target.checked)}
                      disabled={busy}
                      className="mt-1 accent-neon-cyan"
                    />
                    <span>
                      <strong className="text-neon-cyan">Forceer alle bestanden</strong> (verpak alle bestanden in één .ghost bestand)
                    </span>
                  </label>

                  <label className="flex items-start gap-2 rounded border border-emerald-400/30 bg-emerald-400/5 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={batchMode}
                      onChange={(e) => setBatchMode(e.target.checked)}
                      disabled={busy}
                      className="mt-1 accent-emerald-400"
                    />
                    <span>
                      <strong className="text-emerald-300">Batch mode</strong> (encrypt elk bestand individueel)
                    </span>
                  </label>

                  <label className="flex items-start gap-2 rounded border border-panel-border bg-panel/30 p-3 text-sm text-ghost-300">
                    <input
                      type="checkbox"
                      checked={autoDeleteAfter !== ''}
                      onChange={(e) => setAutoDeleteAfter(e.target.checked ? '30' : '')}
                      disabled={busy}
                      className="mt-1 accent-neon-cyan"
                    />
                    <span>
                      <strong className="text-neon-cyan">Auto delete</strong> (verwijder bestanden automatisch na ontgrendelen)
                    </span>
                  </label>

                  {autoDeleteAfter !== '' && (
                    <div>
                      <label className="font-mono text-xs text-ghost-500 block mb-2">Verwijderen na (minuten)</label>
                      <input
                        type="number"
                        value={autoDeleteAfter}
                        onChange={(e) => setAutoDeleteAfter(e.target.value)}
                        disabled={busy}
                        min="1"
                        max="1440"
                        className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
            <h3 className="font-mono text-sm text-neon-magenta mb-4">Tekst Bericht (optioneel)</h3>
            <textarea
              value={textMessage}
              onChange={(e) => setTextMessage(e.target.value)}
              disabled={busy}
              placeholder="Typ hier een bericht dat bij het bestand wordt opgeslagen..."
              rows={3}
              className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200"
            />
            <p className="mt-2 text-[10px] text-ghost-500">
              💡 Dit bericht wordt getoond bij ontgrendelen
            </p>
          </div>

          {!simpleModeStep3 && (
            <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
              <h3 className="font-mono text-sm text-neon-cyan mb-4">Tijdslot & Limieten</h3>

              <div className="space-y-4">
                <div>
                  <label className="font-mono text-xs text-ghost-500 block mb-2">Maximaal aantal keer openen</label>
                  <input
                    type="text"
                    value={maxOpens}
                    onChange={(e) => setMaxOpens(e.target.value)}
                    disabled={busy}
                    placeholder="Laat leeg voor onbeperkt"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                  />
                </div>

                <div>
                  <label className="font-mono text-xs text-ghost-500 block mb-2">Openen vanaf (datum/tijd)</label>
                  <input
                    type="datetime-local"
                    value={unlockAt}
                    onChange={(e) => setUnlockAt(e.target.value)}
                    disabled={busy}
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                  />
                </div>

                <div>
                  <label className="font-mono text-xs text-ghost-500 block mb-2">Verloopt op (datum/tijd)</label>
                  <input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    disabled={busy}
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
            <h3 className="font-mono text-sm text-neon-cyan mb-4">Stap 4 — Bestandsnaam & Wachtwoord</h3>

            <label className="font-mono text-xs text-ghost-500 block mb-2">Bestandsnaam</label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              disabled={busy}
              placeholder="vault"
              className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-300"
            />

            {!noPasswordMode && !ghostTrustedOnlyMode && (
              <>
                <label className="font-mono text-xs text-ghost-500 block mb-2 mt-4">Wachtwoord</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    placeholder="Minimaal 6 tekens"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200 pr-20"
                    aria-label="Wachtwoord"
                    aria-required="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={busy}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ghost-500 hover:text-neon-cyan"
                  >
                    {showPassword ? 'Verberg' : 'Toon'}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="mt-1 font-mono text-xs">
                    <span className={calculatePasswordStrength(password).color}>
                      {calculatePasswordStrength(password).label}
                    </span>
                    <span className="text-ghost-600 ml-2">({password.length}/6 tekens)</span>
                  </div>
                )}

                <label className="font-mono text-xs text-ghost-500 block mb-2 mt-4">Bevestig wachtwoord</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                    placeholder="Herhaal wachtwoord"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200 pr-20"
                    aria-label="Bevestig wachtwoord"
                    aria-required="true"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    disabled={busy}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ghost-500 hover:text-neon-cyan"
                  >
                    {showConfirmPassword ? 'Verberg' : 'Toon'}
                  </button>
                </div>
                {confirm.length > 0 && (
                  <div className="mt-1 font-mono text-xs">
                    {password === confirm ? (
                      <span className="text-green-400">Komt overeen ✓</span>
                    ) : (
                      <span className="text-red-400">Komt niet overeen ✗</span>
                    )}
                  </div>
                )}
              </>
            )}

            <label className="flex items-start gap-2 mt-4">
              <input
                type="checkbox"
                checked={emitGhostKey}
                onChange={(e) => {
                  setEmitGhostKey(e.target.checked);
                  if (e.target.checked) {
                    setEnableDoubleEncryption(false);
                  }
                }}
                disabled={busy || noPasswordMode || ghostTrustedOnlyMode || enableDoubleEncryption}
                className="mt-1 accent-neon-cyan"
              />
              <div>
                <span className="text-sm text-ghost-300">
                  Maak ook een <strong className="text-neon-magenta">.ghostkey</strong> bestand (geen txt). Alleen bruikbaar bij dit .ghost — veiliger dan wachtwoord per chat sturen.
                </span>
                <span className="text-[10px] text-ghost-500 block mt-1">
                  .ghostkey bevat de versleutelde sleutel en kan alleen met dit .ghost bestand worden gebruikt.
                </span>
              </div>
            </label>

            {!simpleModeStep3 && (
              <label className="flex items-start gap-2 mt-4 rounded border border-purple-400/30 bg-purple-400/5 p-3">
                <input
                  type="checkbox"
                  checked={enableDoubleEncryption}
                  onChange={(e) => {
                    setEnableDoubleEncryption(e.target.checked);
                    if (e.target.checked) {
                      setEmitGhostKey(false);
                      setEnableGhostTrusted(false);
                    }
                  }}
                  disabled={busy || noPasswordMode || ghostTrustedOnlyMode || enableGhostTrusted || emitGhostKey}
                  className="mt-1 accent-purple-400"
                />
                <span className="text-sm text-ghost-300">
                  <strong className="text-purple-300">Dubbele encryptie</strong> (extra beveiliging met tweede wachtwoord)
                </span>
              </label>
            )}

            {enableDoubleEncryption && (
              <>
                <label className="font-mono text-xs text-ghost-500 block mb-2 mt-4">Tweede wachtwoord</label>
                <div className="relative">
                  <input
                    type={showSecondPassword ? "text" : "password"}
                    value={secondPassword}
                    onChange={(e) => setSecondPassword(e.target.value)}
                    disabled={busy}
                    placeholder="Minimaal 6 tekens"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200 pr-20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecondPassword(!showSecondPassword)}
                    disabled={busy}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ghost-500 hover:text-neon-cyan"
                  >
                    {showSecondPassword ? 'Verberg' : 'Toon'}
                  </button>
                </div>
                {secondPassword.length > 0 && (
                  <div className="mt-1 font-mono text-xs">
                    <span className={calculatePasswordStrength(secondPassword).color}>
                      {calculatePasswordStrength(secondPassword).label}
                    </span>
                    <span className="text-ghost-600 ml-2">({secondPassword.length}/6 tekens)</span>
                  </div>
                )}

                <label className="font-mono text-xs text-ghost-500 block mb-2 mt-4">Bevestig tweede wachtwoord</label>
                <div className="relative">
                  <input
                    type={showSecondPasswordConfirm ? "text" : "password"}
                    value={secondPasswordConfirm}
                    onChange={(e) => setSecondPasswordConfirm(e.target.value)}
                    disabled={busy}
                    placeholder="Herhaal tweede wachtwoord"
                    className="w-full rounded border border-panel-border bg-void px-4 py-2 font-mono text-sm text-ghost-200 pr-20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecondPasswordConfirm(!showSecondPasswordConfirm)}
                    disabled={busy}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-ghost-500 hover:text-neon-cyan"
                  >
                    {showSecondPasswordConfirm ? 'Verberg' : 'Toon'}
                  </button>
                </div>
                {secondPasswordConfirm.length > 0 && (
                  <div className="mt-1 font-mono text-xs">
                    {secondPassword === secondPasswordConfirm ? (
                      <span className="text-green-400">Komt overeen ✓</span>
                    ) : (
                      <span className="text-red-400">Komt niet overeen ✗</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-panel-border bg-panel/40 p-6">
            <h3 className="font-mono text-sm text-neon-magenta mb-4">Custom Icon (optioneel)</h3>

            <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-panel-border bg-void/50 px-4 py-6 font-mono text-sm text-ghost-300 hover:border-neon-magenta hover:text-neon-magenta cursor-pointer transition">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && file.size <= 512 * 1024) {
                    setCustomIcon(file);
                    setIconError('');
                  } else if (file && file.size > 512 * 1024) {
                    setIconError('Icon mag maximaal 512 KB zijn');
                  }
                }}
                disabled={busy}
                className="hidden"
              />
              <span className="text-2xl">🎨</span>
              <span>Kies een icon (max 512 KB)</span>
            </label>
            {iconError && (
              <p className="mt-2 font-mono text-[10px] text-danger">{iconError}</p>
            )}

            {customIcon && (
              <div className="mt-4 flex items-center gap-4 p-3 rounded border border-panel-border bg-void/50">
                <img
                  src={URL.createObjectURL(customIcon)}
                  alt="Custom icon preview"
                  className="h-12 w-12 rounded-lg object-cover"
                />
                <div className="flex-1">
                  <p className="font-mono text-xs text-ghost-300">{customIcon.name}</p>
                  <p className="font-mono text-[10px] text-ghost-500">{formatFileSize(customIcon.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCustomIcon(null);
                    setIconError('');
                  }}
                  disabled={busy}
                  className="font-mono text-[10px] text-danger/70 hover:text-danger"
                >
                  Verwijderen
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {busy && (
        <div className="rounded-xl border border-neon-cyan/30 bg-neon-cyan/5 p-6">
          <div className="mb-2 flex justify-between font-mono text-xs text-neon-cyan">
            <span>{message || 'Bezig met verwerken...'}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 rounded-full bg-panel overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-neon-cyan to-neon-magenta transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 font-mono text-[10px] text-ghost-500">
            {progress < 25 && 'Comprimeren...'}
            {progress >= 25 && progress < 50 && 'Versleutelen...'}
            {progress >= 50 && progress < 75 && 'Chunks maken...'}
            {progress >= 75 && 'Schrijven naar schijf...'}
          </div>
          {detailedProgress && (
            <div className="mt-3 space-y-1 font-mono text-[10px] text-ghost-500">
              <div className="flex justify-between">
                <span>Huidig bestand:</span>
                <span className="text-neon-cyan">{detailedProgress.currentFile}</span>
              </div>
              <div className="flex justify-between">
                <span>Snelheid:</span>
                <span className="text-neon-cyan">{detailedProgress.speed.toFixed(2)} MB/s</span>
              </div>
              <div className="flex justify-between">
                <span>Resterende tijd:</span>
                <span className="text-neon-cyan">{formatETA(detailedProgress.eta)}</span>
              </div>
              <div className="flex justify-between">
                <span>Voortgang:</span>
                <span className="text-neon-cyan">{formatBytes(detailedProgress.processedSize)} / {formatBytes(detailedProgress.totalSize)}</span>
              </div>
              <div className="flex justify-between">
                <span>Bestanden:</span>
                <span className="text-neon-cyan">{detailedProgress.processedFiles} / {detailedProgress.totalFiles}</span>
              </div>
            </div>
          )}
          {memoryUsage && (
            <div className="mt-2 font-mono text-[10px] text-ghost-500">
              💾 Geheugen: {(memoryUsage.used / 1024 / 1024).toFixed(1)}MB / {(memoryUsage.total / 1024 / 1024).toFixed(1)}MB
            </div>
          )}
        </div>
      )}

      <button
        onClick={handlePack}
        disabled={!files.length && !textMessage || (!noPasswordMode && !ghostTrustedOnlyMode && (password.length < 6 || password !== confirm)) || busy}
        className="w-full rounded-lg bg-gradient-to-r from-neon-cyan/20 to-neon-magenta/20 py-4 font-display tracking-widest text-neon-cyan uppercase transition hover:from-neon-cyan/30 hover:to-neon-magenta/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? 'Bezig...' : 'Genereer .ghost'}
      </button>

      {busy && (
        <button
          onClick={handleCancel}
          className="w-full rounded-lg border border-danger/40 py-2 font-display tracking-widest text-danger uppercase transition hover:bg-danger/10"
        >
          Annuleren
        </button>
      )}

      <p className="text-center text-xs text-ghost-500">
        Na succes verschijnt een groene downloadknop. Alleen .ghost verlaat de browser versleuteld.
      </p>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* File Preview Modal */}
      {showPreview && previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setShowPreview(false)}>
          <div 
            className="bg-void border border-neon-cyan/30 rounded-lg p-6 max-w-4xl max-h-[80vh] overflow-y-auto w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display text-xl text-neon-cyan">Bestand Preview</h2>
              <button 
                onClick={() => setShowPreview(false)}
                className="text-ghost-500 hover:text-ghost-300 text-2xl"
              >
                ×
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-ghost-300">
                <span className="text-2xl">{getFileTypeIcon(previewFile.file)}</span>
                <span className="font-mono text-sm">{previewFile.file.name}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 font-mono text-xs text-ghost-500">
                <div>
                  <span className="text-ghost-400">Grootte:</span> {formatBytes(previewFile.file.size)}
                </div>
                <div>
                  <span className="text-ghost-400">Type:</span> {previewFile.file.type || 'Onbekend'}
                </div>
                <div>
                  <span className="text-ghost-400">Pad:</span> {previewFile.path}
                </div>
                {previewFile.lastModified && (
                  <div>
                    <span className="text-ghost-400">Gewijzigd:</span> {new Date(previewFile.lastModified).toLocaleString('nl-NL')}
                  </div>
                )}
              </div>

              {isImageFile(previewFile.file) && (
                <div className="mt-4">
                  <img 
                    src={URL.createObjectURL(previewFile.file)} 
                    alt={previewFile.file.name}
                    className="max-w-full max-h-96 rounded border border-panel-border"
                    onLoad={(e) => {
                      const url = (e.target as HTMLImageElement).src;
                      URL.revokeObjectURL(url);
                    }}
                  />
                </div>
              )}

              {isTextFile(previewFile.file) && (
                <div className="mt-4">
                  <div className="bg-panel/50 rounded p-4 font-mono text-xs text-ghost-300 max-h-96 overflow-y-auto">
                    <pre className="whitespace-pre-wrap break-words">{previewFile.file.size < 100000 ? 'Tekst preview laden...' : 'Bestand te groot voor preview'}</pre>
                  </div>
                </div>
              )}

              {!isImageFile(previewFile.file) && !isTextFile(previewFile.file) && (
                <div className="mt-4 p-4 bg-panel/50 rounded text-center text-ghost-500 text-sm">
                  Preview niet beschikbaar voor dit bestandstype
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

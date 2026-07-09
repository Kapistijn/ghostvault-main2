import { memo, useCallback } from 'react';

interface DragDropZoneProps {
  onFilesDrop: (files: File[]) => void;
  accept?: string[];
  maxSize?: number; // in bytes
  disabled?: boolean;
}

const DragDropZone = memo(function DragDropZone({
  onFilesDrop,
  accept = ['*/*'],
  maxSize,
  disabled = false,
}: DragDropZoneProps) {
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    
    // Filter by file type if accept is specified
    const filteredFiles = accept.includes('*/*')
      ? files
      : files.filter(file => accept.some(type => file.type.includes(type)));

    // Filter by file size if maxSize is specified
    const sizeFilteredFiles = maxSize
      ? filteredFiles.filter(file => file.size <= maxSize)
      : filteredFiles;

    if (sizeFilteredFiles.length > 0) {
      onFilesDrop(sizeFilteredFiles);
    }
  }, [onFilesDrop, accept, maxSize, disabled]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
        disabled
          ? 'border-ghost-800 text-ghost-600 cursor-not-allowed'
          : 'border-ghost-500 text-ghost-400 hover:border-neon-cyan hover:text-neon-cyan cursor-pointer'
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="text-4xl">📁</div>
        <div>
          <p className="font-mono text-sm">
            {disabled ? 'Drag & drop uitgeschakeld' : 'Sleep bestanden hierheen of klik om te selecteren'}
          </p>
          {maxSize && (
            <p className="font-mono text-xs text-ghost-600 mt-1">
              Maximale grootte: {(maxSize / 1024 / 1024).toFixed(2)} MB
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

export default DragDropZone;

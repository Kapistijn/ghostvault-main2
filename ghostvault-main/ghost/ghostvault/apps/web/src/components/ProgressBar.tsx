import { memo } from 'react';

interface ProgressBarProps {
  progress: number;
  text?: string;
  showPercentage?: boolean;
}

const ProgressBar = memo(function ProgressBar({ progress, text, showPercentage = true }: ProgressBarProps) {
  const clampedProgress = Math.min(100, Math.max(0, progress));

  return (
    <div className="w-full">
      {text && <p className="font-mono text-sm text-ghost-500 mb-2">{text}</p>}
      <div className="h-2 bg-ghost-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-neon-cyan transition-all duration-300 ease-out"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
      {showPercentage && (
        <p className="font-mono text-xs text-ghost-600 mt-1 text-right">
          {clampedProgress.toFixed(1)}%
        </p>
      )}
    </div>
  );
});

export default ProgressBar;

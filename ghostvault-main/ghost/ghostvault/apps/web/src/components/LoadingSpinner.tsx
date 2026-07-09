import { memo } from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
}

const LoadingSpinner = memo(function LoadingSpinner({ size = 'md', text }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`${sizeClasses[size]} border-2 border-neon-cyan border-t-transparent rounded-full animate-spin`} />
      {text && <p className="font-mono text-sm text-ghost-500">{text}</p>}
    </div>
  );
});

export default LoadingSpinner;

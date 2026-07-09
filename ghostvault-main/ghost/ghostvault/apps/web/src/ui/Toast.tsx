import React, { useEffect, useState } from 'react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
}

export default function Toast({
  message,
  type = 'info',
  duration = 3000,
  onClose,
}: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const safeDuration = Math.max(500, Math.min(duration, 30000)); // Min 500ms, max 30s

    const timer = window.setTimeout(() => {
      setIsVisible(false);
      window.setTimeout(onClose, 300);
    }, safeDuration);

    return () => window.clearTimeout(timer);
  }, [duration, onClose]);

  const colors: Record<'success' | 'error' | 'info', string> = {
    success: 'border-neon-green/50 bg-neon-green/10 text-neon-green',
    error: 'border-danger/50 bg-danger/10 text-danger',
    info: 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan',
  };

  return (
    <div
      className={`fixed bottom-4 right-4 rounded-lg border px-4 py-3 font-mono text-sm transition-all duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
      } ${colors[type]}`}
      role="alert"
    >
      {message}
    </div>
  );
}

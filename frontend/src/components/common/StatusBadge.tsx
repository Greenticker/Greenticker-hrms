import React from 'react';

interface StatusBadgeProps {
  status: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'ai' | 'neutral';
}

/** Semantic badge: colours are fixed by meaning across every tool (green = success, red = danger…). */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, variant = 'neutral' }) => {
  const styles = {
    success: 'text-green-800 bg-green-100 border-green-200',
    warning: 'text-amber-800 bg-amber-100 border-amber-200',
    error: 'text-red-800 bg-red-100 border-red-200',
    info: 'text-sky-800 bg-sky-100 border-sky-200',
    ai: 'text-violet-800 bg-violet-100 border-violet-200',
    neutral: 'text-slate-700 bg-slate-100 border-slate-200',
  };

  const dotColors = {
    success: 'bg-green-600',
    warning: 'bg-amber-600',
    error: 'bg-red-600',
    info: 'bg-sky-600',
    ai: 'bg-violet-600',
    neutral: 'bg-slate-500',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${styles[variant]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
};

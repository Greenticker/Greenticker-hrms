import React from 'react';

interface StatusBadgeProps {
  status: string;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, variant = 'neutral' }) => {
  const styles = {
    success: 'text-emerald-700 bg-emerald-50/80 border-emerald-200/60',
    warning: 'text-amber-700 bg-amber-50/80 border-amber-200/60',
    error: 'text-rose-700 bg-rose-50/80 border-rose-200/60',
    info: 'text-blue-700 bg-blue-50/80 border-blue-200/60',
    neutral: 'text-slate-700 bg-slate-100 border-slate-200/80',
  };

  const dotColors = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    error: 'bg-rose-500',
    info: 'bg-blue-500',
    neutral: 'bg-slate-400',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${styles[variant]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColors[variant]}`} aria-hidden="true" />
      <span>{status}</span>
    </span>
  );
};

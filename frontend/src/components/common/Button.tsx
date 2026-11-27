import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

/**
 * Design-system button: 8px radius, Poppins 600, 8px icon gap, 150ms transitions.
 * Heights: sm 32px · md 40px · lg 48px.
 */
export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-lg border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed whitespace-nowrap cursor-pointer';

  const sizeClasses = {
    sm: 'h-8 px-4 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-5 text-base',
  };

  const variantClasses = {
    primary:
      'bg-primary border-primary text-white hover:bg-primary-hover hover:border-primary-hover active:bg-primary-active disabled:bg-slate-400 disabled:border-slate-400',
    secondary:
      'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 disabled:text-slate-400 disabled:bg-slate-100',
    outline:
      'bg-white border-primary text-primary hover:bg-primary-subtle active:bg-primary-light disabled:text-slate-400 disabled:border-slate-300',
    danger:
      'bg-rose-600 border-rose-600 text-white hover:bg-rose-700 hover:border-rose-700 active:bg-rose-800 focus-visible:outline-rose-600 disabled:bg-slate-400 disabled:border-slate-400',
    ghost:
      'bg-primary-subtle border-transparent text-primary hover:bg-primary-light active:bg-primary-light disabled:text-slate-400',
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Processing...</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
};

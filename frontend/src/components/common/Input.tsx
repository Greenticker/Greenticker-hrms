import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

/**
 * Design-system input: 44px tall, 8px radius, label above, error directly below,
 * blue focus ring, required fields marked with an asterisk.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, required, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
    const msgId = inputId ? `${inputId}-msg` : undefined;

    return (
      <div className="w-full space-y-2">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
            {label}
            {required && <span className="text-rose-600 ml-1" aria-hidden="true">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || helperText ? msgId : undefined}
          className={`w-full h-11 rounded-lg border bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-500 ${
            error
              ? 'border-rose-600 focus:ring-rose-600/20 focus:border-rose-600'
              : 'border-slate-300 hover:border-slate-400 focus:ring-primary/25 focus:border-primary'
          } ${className}`}
          {...props}
        />
        {error && <p id={msgId} className="text-xs text-rose-600 font-medium">{error}</p>}
        {helperText && !error && <p id={msgId} className="text-xs text-slate-500">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

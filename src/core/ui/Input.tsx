import { forwardRef, type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
};

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, className = "", id, ...rest }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).slice(2, 8)}`;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          {...rest}
          className={`px-3 py-2 text-sm rounded-lg border bg-white dark:bg-gray-900 dark:text-gray-100 ${
            error ? "border-red-500" : "border-gray-300 dark:border-gray-700"
          } focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 ${className}`}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

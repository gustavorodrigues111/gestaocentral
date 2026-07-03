import { forwardRef, type SelectHTMLAttributes } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
};

// Select com o MESMO acabamento do <Input> (altura, borda, foco, sombra) —
// resolve o desalinhamento clássico de select cru vs input. Usa
// appearance-none + seta própria pra ficar consistente entre navegadores.
export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, error, className = "", id, children, ...rest }, ref) => {
    const selId = id || `select-${Math.random().toString(36).slice(2, 8)}`;
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selId} className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selId}
            {...rest}
            className={`w-full appearance-none px-3 py-2 pr-9 text-sm rounded-lg border bg-white dark:bg-gray-900 dark:text-gray-100 shadow-sm ${
              error ? "border-red-500" : "border-gray-300 dark:border-gray-700"
            } focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 ${className}`}
          >
            {children}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[10px]">▼</span>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }
);
Select.displayName = "Select";

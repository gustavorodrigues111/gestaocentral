type Props = {
  value: number;                 // minutos
  onChange: (n: number) => void;
  disabled?: boolean;
  step?: number;                 // default 5
  min?: number;                  // default 0
  max?: number;                  // default 240 (4h)
};

// Stepper de intervalo em minutos. Default step 5min. Mobile-friendly:
// botões grandes nas laterais + display central.
export function IntervaloStepper({
  value, onChange, disabled, step = 5, min = 0, max = 240,
}: Props) {
  function dec() {
    if (disabled) return;
    onChange(Math.max(min, value - step));
  }
  function inc() {
    if (disabled) return;
    onChange(Math.min(max, value + step));
  }
  return (
    <div className={`inline-flex items-stretch rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden ${disabled ? "opacity-50" : ""}`}>
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        aria-label="Diminuir intervalo"
        className="px-4 py-2 text-lg font-bold bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 dark:text-gray-200"
      >
        −
      </button>
      <div className="px-4 py-2 min-w-[80px] text-center text-sm font-semibold text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-900 border-x border-gray-200 dark:border-gray-700 select-none">
        {value} min
      </div>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        aria-label="Aumentar intervalo"
        className="px-4 py-2 text-lg font-bold bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 dark:text-gray-200"
      >
        +
      </button>
    </div>
  );
}

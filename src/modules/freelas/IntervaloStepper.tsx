type Props = {
  value: number;                 // valor numérico
  onChange: (n: number) => void;
  disabled?: boolean;
  step?: number;                 // default 5
  min?: number;                  // default 0
  max?: number;                  // default 240 (4h)
  /** Label embaixo do valor (default "minutos"). */
  label?: string;
  /** Se true, mostra sinal "+" pra valores positivos (delta de estoque). */
  showSign?: boolean;
};

// Stepper genérico (originalmente "intervalo em minutos" do Freelas).
// Botões circulares destacados em indigo. Valor central grande.
// Reutilizável pra qualquer ajuste numérico de 1 em 1 / N em N.
export function IntervaloStepper({
  value, onChange, disabled, step = 5, min = 0, max = 240,
  label = "minutos", showSign,
}: Props) {
  function dec() {
    if (disabled) return;
    onChange(Math.max(min, value - step));
  }
  function inc() {
    if (disabled) return;
    onChange(Math.min(max, value + step));
  }
  const baseBtn =
    "h-12 w-12 rounded-full flex items-center justify-center text-2xl font-bold transition-colors select-none " +
    "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 " +
    "hover:bg-indigo-200 dark:hover:bg-indigo-800/60 " +
    "active:bg-indigo-300 dark:active:bg-indigo-800 " +
    "disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <div className={`flex items-center justify-center gap-5 py-1 ${disabled ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        aria-label={`Diminuir ${label}`}
        className={baseBtn}
      >
        −
      </button>
      <div className="min-w-[88px] text-center select-none">
        <div className={`text-3xl font-bold leading-none tabular-nums ${
          showSign && value > 0 ? "text-emerald-600 dark:text-emerald-400"
          : showSign && value < 0 ? "text-rose-600 dark:text-rose-400"
          : "text-gray-900 dark:text-gray-100"
        }`}>
          {showSign && value > 0 ? "+" : ""}{value}
        </div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mt-1">
          {label}
        </div>
      </div>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        aria-label={`Aumentar ${label}`}
        className={baseBtn}
      >
        +
      </button>
    </div>
  );
}

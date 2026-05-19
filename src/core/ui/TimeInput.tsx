import { type ChangeEvent } from "react";

type Props = {
  value: string;            // "HH:MM" ou ""
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

// Input de horário mascarado HH:MM (24h). Não usa <input type="time"> nativo
// porque o Safari iOS respeita o locale do device e exibe AM/PM mesmo com
// lang="pt-BR" no HTML. Aqui é texto puro, comportamento idêntico cross-device.
export function TimeInput({ value, onChange, disabled, placeholder, className, ariaLabel }: Props) {
  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    let raw = e.target.value.replace(/[^0-9]/g, "");
    if (raw.length > 4) raw = raw.slice(0, 4);
    let out = raw;
    if (raw.length >= 3) out = `${raw.slice(0, 2)}:${raw.slice(2)}`;
    // Validações leves: HH em [00..23], MM em [00..59]
    if (out.length >= 2) {
      const hh = parseInt(out.slice(0, 2), 10);
      if (hh > 23) out = "23" + out.slice(2);
    }
    if (out.length === 5) {
      const mm = parseInt(out.slice(3, 5), 10);
      if (mm > 59) out = out.slice(0, 3) + "59";
    }
    onChange(out);
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder={placeholder || "HH:MM"}
      value={value}
      onChange={handleChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={
        className ||
        "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 disabled:opacity-50"
      }
    />
  );
}

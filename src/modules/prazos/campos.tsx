// Campos reutilizáveis do módulo Prazos: stepper −/+ arredondado e seletor de
// data BR com calendário popover (nada de <input type=date> US).
import { useEffect, useMemo, useRef, useState } from "react";

export function Stepper({ value, onChange, min = 0, max = 999, sufixo }: { value: number; onChange: (n: number) => void; min?: number; max?: number; sufixo?: string }) {
  return (
    <div className="inline-flex items-center rounded-full border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden select-none">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 text-base leading-none">−</button>
      <span className="min-w-[2.25rem] px-1 text-center text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">{value}{sufixo || ""}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 text-base leading-none">+</button>
    </div>
  );
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DOW = ["D", "S", "T", "Q", "Q", "S", "S"];

// value/onChange em "dd/mm/aaaa".
export function DatePickerBR({ value, onChange, placeholder = "dd/mm/aaaa" }: { value: string; onChange: (br: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useMemo(() => {
    const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = new Date(+m[3], +m[2] - 1, +m[1], 12);
    return isNaN(d.getTime()) ? null : d;
  }, [value]);
  const [view, setView] = useState<Date>(() => sel || new Date());
  useEffect(() => { if (sel) setView(sel); }, [sel]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const y = view.getFullYear(), m0 = view.getMonth();
  const firstDow = new Date(y, m0, 1).getDay();
  const dim = new Date(y, m0 + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)];
  const pick = (d: number) => { onChange(`${String(d).padStart(2, "0")}/${String(m0 + 1).padStart(2, "0")}/${y}`); setOpen(false); };
  const isSel = (d: number) => !!sel && sel.getDate() === d && sel.getMonth() === m0 && sel.getFullYear() === y;

  return (
    <div ref={wrap} className="relative">
      <div className="flex items-center h-9 px-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" onClick={() => setOpen(true)}>
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="numeric" className="flex-1 min-w-0 bg-transparent text-sm outline-none dark:text-gray-100" />
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="text-gray-400 hover:text-gray-600 ml-1">📅</button>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setView(new Date(y, m0 - 1, 1))} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">‹</button>
            <span className="text-sm font-medium capitalize text-gray-900 dark:text-gray-100">{MESES[m0]} {y}</span>
            <button type="button" onClick={() => setView(new Date(y, m0 + 1, 1))} className="w-7 h-7 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">›</button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">{DOW.map((d, i) => <div key={i} className="text-[10px] text-center text-gray-400">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => d == null ? <div key={i} /> : (
              <button key={i} type="button" onClick={() => pick(d)} className={`h-7 text-xs rounded-lg ${isSel(d) ? "bg-indigo-600 text-white font-medium" : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"}`}>{d}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

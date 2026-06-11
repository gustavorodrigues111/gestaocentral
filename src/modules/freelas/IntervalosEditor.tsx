import type { FreelaIntervalo } from "../../core/types";
import { IntervaloStepper } from "./IntervaloStepper";
import { somaIntervalos } from "./helpers";

type Props = {
  value: FreelaIntervalo[];
  onChange: (next: FreelaIntervalo[]) => void;
  disabled?: boolean;
  // Minutos do intervalo recém-adicionado (default 60 — refeição típica).
  novoMin?: number;
  // Quando true, novos intervalos entram marcados como `planejado` (usado no
  // agendamento). Não muda o cálculo — é só dica visual.
  planejadoDefault?: boolean;
};

// Editor de N intervalos por turno. Cada intervalo é um stepper de 5 em 5
// (reusa IntervaloStepper). Mantém a lista; o caller soma e grava em
// `intervalo` + `intervalos` no shift.
export function IntervalosEditor({
  value, onChange, disabled, novoMin = 60, planejadoDefault,
}: Props) {
  function alterar(i: number, min: number) {
    const next = value.map((it, idx) => (idx === i ? { ...it, min } : it));
    onChange(next);
  }
  function remover(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function adicionar() {
    if (disabled) return;
    onChange([...value, { min: novoMin, ...(planejadoDefault ? { planejado: true } : {}) }]);
  }

  const total = somaIntervalos(value);

  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <div className="text-[11px] text-gray-500 dark:text-gray-400 italic">
          Nenhum intervalo lançado.
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-1 min-w-0">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500 w-12 shrink-0">
                  {value.length > 1 ? `#${i + 1}` : "Pausa"}
                </span>
                {it.planejado && (
                  <span className="text-[9px] uppercase tracking-wider font-semibold text-blue-600 dark:text-blue-400 bg-blue-100/70 dark:bg-blue-900/30 px-1.5 py-0.5 rounded shrink-0">
                    planejado
                  </span>
                )}
              </div>
              <div className="flex-1 flex justify-center">
                <IntervaloStepper
                  value={it.min}
                  onChange={(m) => alterar(i, m)}
                  disabled={disabled}
                />
              </div>
              <button
                type="button"
                onClick={() => remover(i)}
                disabled={disabled}
                aria-label="Remover intervalo"
                className="text-[18px] text-gray-400 hover:text-red-600 dark:hover:text-red-400 leading-none p-1 disabled:opacity-30 shrink-0"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Separado dos steppers (divisória + espaço) pra não lançar um intervalo
          sem querer ao ficar tocando no "−" do seletor de tempo. */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button
          type="button"
          onClick={adicionar}
          disabled={disabled}
          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 disabled:opacity-50"
        >
          ➕ Adicionar intervalo
        </button>
        {value.length > 1 && (
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Total: <strong className="tabular-nums">{total}</strong> min
          </span>
        )}
      </div>
    </div>
  );
}

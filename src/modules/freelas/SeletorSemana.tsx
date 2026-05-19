import { useMemo, useState } from "react";
import { todayYmd } from "../../core/utils/date";

type Props = {
  value: string;                          // YYYY-MM-DD
  onChange: (v: string) => void;
  disabled?: boolean;
};

const DOW = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];

function parseYmdLocal(ymd: string): Date {
  const [a, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(a, m - 1, d);
}

function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Calcula segunda-feira da semana que contém date.
function inicioDaSemana(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay();              // 0=dom..6=sáb
  const diff = dow === 0 ? -6 : 1 - dow; // mover pra segunda
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtFaixa(start: Date, end: Date): string {
  const mesIni = start.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  const mesFim = end.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${mesIni}`;
  }
  return `${start.getDate()} ${mesIni} – ${end.getDate()} ${mesFim}`;
}

// Seletor de semana (Seg–Dom). 7 botões com dia grande + nome do dia.
// Setas ←/→ navegam entre semanas. Link "outra data" abre input date nativo
// pra casos fora do alcance comum (agendamento meses à frente).
export function SeletorSemana({ value, onChange, disabled }: Props) {
  const hoje = todayYmd();
  const [semanaRef, setSemanaRef] = useState<Date>(() => inicioDaSemana(parseYmdLocal(value || hoje)));
  const [outraDataAberta, setOutraDataAberta] = useState(false);

  const dias = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(semanaRef);
      d.setDate(semanaRef.getDate() + i);
      return d;
    });
  }, [semanaRef]);

  const fim = new Date(semanaRef);
  fim.setDate(semanaRef.getDate() + 6);

  function navega(delta: number) {
    const novo = new Date(semanaRef);
    novo.setDate(novo.getDate() + delta * 7);
    setSemanaRef(novo);
  }

  function pulaParaValor() {
    if (value) {
      setSemanaRef(inicioDaSemana(parseYmdLocal(value)));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navega(-1)}
          disabled={disabled}
          aria-label="Semana anterior"
          className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => { setSemanaRef(inicioDaSemana(parseYmdLocal(hoje))); }}
          className="text-[11px] uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          {fmtFaixa(semanaRef, fim)}
        </button>
        <button
          type="button"
          onClick={() => navega(1)}
          disabled={disabled}
          aria-label="Próxima semana"
          className="text-lg leading-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 disabled:opacity-30"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {dias.map((d) => {
          const ymd = fmtYmd(d);
          const dow = d.getDay();
          const isHoje = ymd === hoje;
          const selecionado = ymd === value;
          const weekend = dow === 0 || dow === 6;
          const base = "flex flex-col items-center justify-center py-1.5 rounded-lg border transition-colors";
          const cls = selecionado
            ? `${base} bg-indigo-600 text-white border-indigo-600`
            : `${base} bg-white dark:bg-gray-900 ${
                isHoje
                  ? "border-indigo-400 dark:border-indigo-500"
                  : "border-gray-200 dark:border-gray-700"
              } ${weekend ? "text-gray-500" : "text-gray-800 dark:text-gray-100"} hover:bg-gray-50 dark:hover:bg-gray-800`;
          return (
            <button
              key={ymd}
              type="button"
              onClick={() => onChange(ymd)}
              disabled={disabled}
              className={cls}
            >
              <span className={`text-lg font-bold leading-none tabular-nums`}>{d.getDate()}</span>
              <span className={`text-[10px] uppercase tracking-wider mt-1 ${selecionado ? "opacity-90" : "opacity-70"}`}>
                {DOW[dow]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <button
          type="button"
          onClick={() => setOutraDataAberta(true)}
          className="text-indigo-600 dark:text-indigo-400 hover:underline"
        >
          📅 Outra data…
        </button>
        {value !== hoje && (
          <button
            type="button"
            onClick={() => { onChange(hoje); setSemanaRef(inicioDaSemana(parseYmdLocal(hoje))); }}
            className="text-gray-500 dark:text-gray-400 hover:underline"
          >
            Hoje
          </button>
        )}
      </div>

      {outraDataAberta && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value}
            onChange={(e) => { onChange(e.target.value); pulaParaValor(); }}
            disabled={disabled}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => setOutraDataAberta(false)}
            className="text-[11px] text-gray-500 hover:underline"
          >
            fechar
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import {
  daysInMonth, fmtAnoMes, nomeMes, pad2, shiftMonth,
} from "../../core/utils/date";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import type { Cargo, Empregado, EscalaMes, ScheduleStatus } from "../../core/types";

const STATUS_INFO: Record<ScheduleStatus, { label: string; short: string; bg: string; text: string }> = {
  trabalho:  { label: "Trabalho",                short: "T",  bg: "bg-emerald-500",  text: "text-white" },
  folga:     { label: "Folga",                   short: "F",  bg: "bg-gray-300 dark:bg-gray-700",  text: "text-gray-700 dark:text-gray-200" },
  freela:    { label: "Freela",                  short: "FR", bg: "bg-purple-500",   text: "text-white" },
  comp:      { label: "Compensação",             short: "C",  bg: "bg-amber-400",    text: "text-amber-950" },
  comp_trab: { label: "Comp. trabalhado",        short: "CT", bg: "bg-amber-600",    text: "text-white" },
  ferias:    { label: "Férias",                  short: "FE", bg: "bg-sky-500",      text: "text-white" },
  falta_j:   { label: "Falta justificada",       short: "FJ", bg: "bg-rose-300",     text: "text-rose-900" },
  falta_i:   { label: "Falta injustificada",     short: "FI", bg: "bg-rose-600",     text: "text-white" },
};

type Props = {
  empregado: Empregado;
  cargo: Cargo | null;
  restaurantId: string;
};

export function MinhaEscalaTab({ empregado, cargo, restaurantId }: Props) {
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [escala, setEscala] = useState<EscalaMes | null>(null);

  const escalaId = `${restaurantId}_${fmtAnoMes(ano, mes)}`;
  useEffect(() => {
    const ref = doc(db, "escalas", escalaId);
    const unsub = onSnapshot(ref, (snap) => {
      setEscala(snap.exists() ? ({ id: snap.id, ...snap.data() } as EscalaMes) : null);
    });
    return () => unsub();
  }, [escalaId]);

  // Derivado dos horários cadastrados
  const derivado = useMemo(
    () => derivedScheduleForEmpregado(empregado, ano, mes),
    [empregado, ano, mes],
  );

  // Versão a usar: priorizamos REAL (o que aconteceu); fallback Prevista; fallback derivado
  function statusEm(date: string): { status: ScheduleStatus | null; fonte: "real" | "prevista" | "derivado" | null } {
    const real = escala?.real?.[empregado.id]?.[date];
    if (real) return { status: real, fonte: "real" };
    const prev = escala?.prevista?.[empregado.id]?.[date];
    if (prev) return { status: prev, fonte: "prevista" };
    const der = derivado[date]?.status;
    if (der) return { status: der, fonte: "derivado" };
    return { status: null, fonte: null };
  }

  const dias = daysInMonth(ano, mes);
  const todayYmd = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  })();

  // Stats: dias de trabalho / folga / férias / faltas no mês
  const stats = useMemo(() => {
    const m = { trabalho: 0, folga: 0, ferias: 0, falta: 0 };
    for (let d = 1; d <= dias; d++) {
      const date = `${ano}-${pad2(mes)}-${pad2(d)}`;
      const s = statusEm(date).status;
      if (!s) continue;
      if (s === "trabalho" || s === "comp_trab" || s === "freela") m.trabalho++;
      else if (s === "folga" || s === "comp") m.folga++;
      else if (s === "ferias") m.ferias++;
      else if (s === "falta_j" || s === "falta_i") m.falta++;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escala, derivado, ano, mes, dias]);

  function navegarMes(delta: number) {
    const next = shiftMonth(ano, mes, delta);
    setAno(next.ano);
    setMes(next.mes);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {cargo?.nome || empregado.nome}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navegarMes(-1)}>←</Button>
          <div className="px-4 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 font-medium text-sm min-w-[140px] text-center">
            {nomeMes(mes)} {ano}
          </div>
          <Button variant="secondary" size="sm" onClick={() => navegarMes(1)}>→</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <Mini label="Trabalho" value={stats.trabalho} variant="ok" />
        <Mini label="Folga" value={stats.folga} />
        <Mini label="Férias" value={stats.ferias} variant="info" />
        <Mini label="Faltas" value={stats.falta} variant={stats.falta > 0 ? "warn" : undefined} />
      </div>

      {/* Calendar grid */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
        <div className="grid grid-cols-7 gap-1 text-[10px] font-bold uppercase text-gray-500 mb-1 text-center">
          <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
        </div>
        <CalendarGrid
          ano={ano}
          mes={mes}
          dias={dias}
          statusEm={statusEm}
          todayYmd={todayYmd}
        />
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.keys(STATUS_INFO) as ScheduleStatus[]).map(s => (
          <div key={s} className="flex items-center gap-1">
            <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${STATUS_INFO[s].bg} ${STATUS_INFO[s].text} text-[9px] font-bold`}>
              {STATUS_INFO[s].short}
            </span>
            <span className="text-gray-600 dark:text-gray-400">{STATUS_INFO[s].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarGrid({
  ano, mes, dias, statusEm, todayYmd,
}: {
  ano: number; mes: number; dias: number;
  statusEm: (date: string) => { status: ScheduleStatus | null; fonte: "real" | "prevista" | "derivado" | null };
  todayYmd: string;
}) {
  // Domingo do dia 1 (offset)
  const primeiroDia = new Date(ano, mes - 1, 1);
  const offset = primeiroDia.getDay();

  const cells: React.ReactNode[] = [];
  // Padding do início
  for (let i = 0; i < offset; i++) {
    cells.push(<div key={`pad-${i}`} className="aspect-square" />);
  }
  for (let d = 1; d <= dias; d++) {
    const date = `${ano}-${pad2(mes)}-${pad2(d)}`;
    const { status, fonte } = statusEm(date);
    const isToday = date === todayYmd;
    const dayDate = new Date(ano, mes - 1, d);
    const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
    const info = status ? STATUS_INFO[status] : null;
    cells.push(
      <div
        key={d}
        className={`aspect-square rounded flex flex-col items-center justify-center text-[10px] gap-0.5 ${
          info ? `${info.bg} ${info.text}` : "bg-gray-50 dark:bg-gray-800/40"
        } ${fonte === "derivado" ? "opacity-60 border border-dashed border-gray-300" : ""} ${
          isToday ? "ring-2 ring-indigo-500 ring-inset" : ""
        }`}
        title={`${date} · ${info?.label || "Sem dado"} (${fonte || "—"})`}
      >
        <div className={`text-[9px] ${info ? "opacity-80" : "text-gray-500"}`}>
          {pad2(d)}{isWeekend && !info ? <span className="text-amber-600">·</span> : null}
        </div>
        {info && <div className="font-bold text-[11px]">{info.short}</div>}
      </div>
    );
  }
  return <div className="grid grid-cols-7 gap-1">{cells}</div>;
}

function Mini({ label, value, variant }: { label: string; value: number; variant?: "ok" | "warn" | "info" }) {
  const cls =
    variant === "ok" ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300"
    : variant === "warn" ? "border-rose-200 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300"
    : variant === "info" ? "border-sky-200 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300"
    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100";
  return (
    <div className={`rounded-lg border p-2 text-center ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

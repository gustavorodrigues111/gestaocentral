// Decide o badge de status de horário pra cada empregado na lista de Pessoas.
//
//   sem        → sem horário cadastrado (mostra nada)
//   ok         → vigente OK pelas regras CLT (badge verde 🕐)
//   alerta     → vigente em desacordo com CLT (badge vermelho 🕐⚠)
//
// Pra escalas alternadas, mantém a mesma cor (ok/alerta) mas troca o ícone
// pra 🔄 (sinalizando que é A/B).

import type { Empregado, Restaurant } from "../../core/types";
import { getActiveWorkSchedule, validateWorkScheduleDays } from "../../core/escala/horarios";
import { todayYmd } from "../../core/utils/date";

export type HorarioStatus =
  | { kind: "sem" }
  | { kind: "ok"; alternating: boolean }
  | { kind: "alerta"; alternating: boolean; mensagens: string[] };

export function statusHorarioEmpregado(
  emp: Empregado,
  restaurant: Restaurant | null,
): HorarioStatus {
  const active = getActiveWorkSchedule(emp.workSchedules, todayYmd());
  if (!active) return { kind: "sem" };

  const cargaMin = restaurant?.horarioConfig?.cargaSemanalMinMin ?? 2635; // 43:55
  const cargaMax = restaurant?.horarioConfig?.cargaSemanalMaxMin ?? 2640; // 44:00

  if (active.type === "alternating") {
    if (!active.weeks) {
      return { kind: "alerta", alternating: true, mensagens: ["Schedule sem semanas A/B"] };
    }
    const a = validateWorkScheduleDays(active.weeks.A.days, cargaMin, cargaMax);
    const b = validateWorkScheduleDays(active.weeks.B.days, cargaMin, cargaMax);
    const erros = [...a.errors, ...b.errors];
    if (erros.length > 0) {
      return {
        kind: "alerta",
        alternating: true,
        mensagens: erros.map((e) => e.mensagem),
      };
    }
    return { kind: "ok", alternating: true };
  }

  // type === "single"
  if (!active.days) {
    return { kind: "alerta", alternating: false, mensagens: ["Schedule sem dias"] };
  }
  const r = validateWorkScheduleDays(active.days, cargaMin, cargaMax);
  if (r.errors.length > 0) {
    return {
      kind: "alerta",
      alternating: false,
      mensagens: r.errors.map((e) => e.mensagem),
    };
  }
  return { kind: "ok", alternating: false };
}

// Helper de classes pro badge — encapsula o visual.
export function horarioBadgeProps(s: HorarioStatus): {
  texto: string;
  classes: string;
  tooltip: string;
} | null {
  if (s.kind === "sem") return null;
  const icone = s.alternating ? "🔄" : "🕐";
  if (s.kind === "ok") {
    return {
      texto: s.alternating ? `${icone} A/B` : `${icone} OK`,
      classes:
        "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300",
      tooltip: s.alternating
        ? "Escala alternada A/B — válida pelas regras CLT"
        : "Horário cadastrado e válido pelas regras CLT",
    };
  }
  // alerta
  const mensagensVisiveis = s.mensagens.slice(0, 3);
  const sufixo = s.mensagens.length > 3 ? `… (+${s.mensagens.length - 3})` : "";
  return {
    texto: `${icone} ⚠`,
    classes:
      "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300",
    tooltip:
      (s.alternating ? "Escala A/B em desacordo:\n" : "Horário em desacordo:\n") +
      mensagensVisiveis.join("\n") +
      sufixo,
  };
}

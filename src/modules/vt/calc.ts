import type { Empregado, EscalaMes, ScheduleStatus } from "../../core/types";

// Status que conta como dia de trabalho pra cálculo de VT
const STATUS_TRABALHADO: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  comp_trab: true,
  freela:    true,
  folga:     false,
  comp:      false,
  ferias:    false,
  falta_j:   false,
  falta_i:   false,
};

// Conta dias de trabalho na escala — versão "prevista" pra VT antecipado,
// "real" pra divergências/ajustes posteriores.
export function contarDiasTrabalhados(
  empregadoId: string,
  escala: EscalaMes | null,
  versao: "prevista" | "real" = "prevista",
): number {
  if (!escala) return 0;
  const dias = escala[versao]?.[empregadoId];
  if (!dias) return 0;
  let n = 0;
  for (const k of Object.keys(dias)) {
    if (STATUS_TRABALHADO[dias[k]]) n++;
  }
  return n;
}

export type VTLinhaCalc = {
  empregadoId: string;
  nome: string;
  diasTrabalhados: number;
  passagensPorDia: number;
  valorPassagem: number;
  total: number;
  paidAt?: string | null;
};

export function calcularVTLinha(
  e: Empregado,
  escala: EscalaMes | null,
  versao: "prevista" | "real" = "prevista",
): VTLinhaCalc | null {
  if (!e.vtAtivo) return null;
  const passagensPorDia = e.vtPassagensPorDia ?? 0;
  const valorPassagem   = e.vtValorPassagem   ?? 0;
  const diasTrabalhados = contarDiasTrabalhados(e.id, escala, versao);
  const total = Math.round(diasTrabalhados * passagensPorDia * valorPassagem * 100) / 100;
  return {
    empregadoId: e.id,
    nome: e.nome,
    diasTrabalhados,
    passagensPorDia,
    valorPassagem,
    total,
  };
}

// ─── DIVERGÊNCIAS ENTRE PREVISTA E REAL ──────────────────────────────────────
// Pra cada empregado VT-ativo, compara dias trabalhados na Prevista (que foi
// usada pra pagar VT) vs Real (o que de fato aconteceu).
// - Real > Prevista: empregado tem a RECEBER (trabalhou mais dias do que esperado)
// - Real < Prevista: empregado tem a DEVOLVER (faltou ou folgou compensatório)

export type VTDivergencia = {
  empregadoId: string;
  nome: string;
  diasPrevista: number;
  diasReal: number;
  delta: number;          // positivo = a receber; negativo = a devolver
  passagensPorDia: number;
  valorPassagem: number;
  diferencaValor: number; // delta * passagens * valor
};

export function calcularDivergenciasVT(
  empregados: Empregado[],
  escala: EscalaMes | null,
): VTDivergencia[] {
  if (!escala) return [];
  const divergencias: VTDivergencia[] = [];
  for (const e of empregados) {
    if (!e.vtAtivo) continue;
    const passagensPorDia = e.vtPassagensPorDia ?? 0;
    const valorPassagem   = e.vtValorPassagem   ?? 0;
    if (passagensPorDia <= 0 || valorPassagem <= 0) continue;
    const prev = contarDiasTrabalhados(e.id, escala, "prevista");
    const real = contarDiasTrabalhados(e.id, escala, "real");
    const delta = real - prev;
    if (delta === 0) continue;
    const diferencaValor = Math.round(delta * passagensPorDia * valorPassagem * 100) / 100;
    divergencias.push({
      empregadoId: e.id,
      nome: e.nome,
      diasPrevista: prev,
      diasReal: real,
      delta,
      passagensPorDia,
      valorPassagem,
      diferencaValor,
    });
  }
  return divergencias.sort((a, b) => Math.abs(b.diferencaValor) - Math.abs(a.diferencaValor));
}

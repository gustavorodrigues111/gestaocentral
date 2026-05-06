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

export function contarDiasTrabalhados(empregadoId: string, escala: EscalaMes | null): number {
  if (!escala) return 0;
  const dias = escala.empregados?.[empregadoId];
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
  defaults: { passagens: number; valor: number },
): VTLinhaCalc | null {
  if (!e.vtAtivo) return null;
  const passagensPorDia = e.vtPassagensPorDia ?? defaults.passagens;
  const valorPassagem   = e.vtValorPassagem   ?? defaults.valor;
  const diasTrabalhados = contarDiasTrabalhados(e.id, escala);
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

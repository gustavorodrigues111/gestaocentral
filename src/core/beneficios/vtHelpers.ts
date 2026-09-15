// Helpers compartilhados de VT / contagem de dias trabalhados.
//
// Extraídos de `modules/vt/calc.ts` (módulo antigo aposentado) — são a única
// parte viva daquele arquivo, usada pelo módulo Benefícios (beneficios2) e pela
// Escala (SumarioMesModal). O resto do vt/calc.ts era só do lote de VT legado.
import type { Empregado, EscalaMes, ScheduleStatus } from "../types";
import { statusEfetivoEmpMes } from "../escala/statusEfetivo";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Status que conta como dia de trabalho pra VT: só quem de fato trabalhou.
// Freela não recebe VT (por dia trabalhado, não CLT); comp/folga/férias/faltas não.
const STATUS_TRABALHADO: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  comp_trab: true,   // veio trabalhar pra compensar
  freela:    false,
  folga:     false,
  comp:      false,
  ferias:    false,
  falta_j:   false,
  falta_i:   false,
};

// Estados retornados em `fonte`:
//   - "snapshot": escala prevista fechada → número definitivo
//   - "preview":  escala aberta → estimativa em tempo real
//   - "vazio":    empregado sem horário cadastrado E sem override
export type DiasContados = {
  dias: number;
  fonte: "snapshot" | "preview" | "vazio";
};

// Conta dias de trabalho na escala — "prevista" pra VT antecipado, "real" pra
// divergências/ajustes. Fonte: status efetivo (override ∪ derivado do horário).
export function contarDiasTrabalhados(
  empregado: Empregado,
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  versao: "prevista" | "real" = "prevista",
): number {
  const dias = statusEfetivoEmpMes(empregado, escala, ano, mes, versao);
  let n = 0;
  for (const k of Object.keys(dias)) {
    if (STATUS_TRABALHADO[dias[k]]) n++;
  }
  return n;
}

// Conta dias de trabalho num RANGE específico (pra pagamento parcial).
export function contarDiasTrabalhadosNoRange(
  empregado: Empregado,
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  inicio: string,
  fim: string,
  versao: "prevista" | "real" = "prevista",
): DiasContados {
  const dias = statusEfetivoEmpMes(empregado, escala, ano, mes, versao);
  const totalEntries = Object.keys(dias).length;
  const previstaFechada = !!escala?.previstaFechadaEm;
  if (totalEntries === 0) return { dias: 0, fonte: "vazio" };
  const noRange = (date: string) => date >= inicio && date <= fim;
  let n = 0;
  for (const k of Object.keys(dias)) {
    if (noRange(k) && STATUS_TRABALHADO[dias[k]]) n++;
  }
  return { dias: n, fonte: versao === "prevista" && previstaFechada ? "snapshot" : "preview" };
}

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

// Divergência de VT (prevista × real) — usada no resumo do mês da Escala.
export function calcularDivergenciasVT(
  empregados: Empregado[],
  escala: EscalaMes | null,
  ano: number,
  mes: number,
): VTDivergencia[] {
  if (!escala) return [];
  const divergencias: VTDivergencia[] = [];
  for (const e of empregados) {
    if (!e.vtAtivo) continue;
    const passagensPorDia = e.vtPassagensPorDia ?? 0;
    const valorPassagem   = e.vtValorPassagem   ?? 0;
    if (passagensPorDia <= 0 || valorPassagem <= 0) continue;
    const prev = contarDiasTrabalhados(e, escala, ano, mes, "prevista");
    const real = contarDiasTrabalhados(e, escala, ano, mes, "real");
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

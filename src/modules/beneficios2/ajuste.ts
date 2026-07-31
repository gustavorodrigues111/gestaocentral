// ════════════════════════════════════════════════════════════════════════════
//  Motor de AJUSTE (prevista × praticada). Funções PURAS (testáveis).
//  Reconcilia um lote de PAGAMENTO já pago contra a escala PRATICADA, numa janela
//  [de, ate]. O ajuste (dias praticados − dias pagos) × valor abate/credita no
//  Pagamento do mês seguinte. Cursor = último dia apurado PARA TODOS.
// ════════════════════════════════════════════════════════════════════════════
import type { Empregado, EscalaMes, BeneficioPagLote, BeneficioAjusteLote, BeneficioAjusteLinha } from "../../core/types";
import { contarDiasTrabalhadosNoRange, round2 } from "../vt/calc";
import { statusEfetivoEmpMes } from "../../core/escala/statusEfetivo";
import { vtDiarioDe, ativoNoMes } from "./calc";
import { pad2 } from "../../core/utils/date";

const ehTrabalho = (s?: string) => s === "trabalho" || s === "comp_trab";
// Dias em que prevista×praticada divergem na janela (pra tooltip).
function diffDias(e: Empregado, escala: EscalaMes | null, ano: number, mes: number, de: string, ate: string): { desconto: string[]; credito: string[] } {
  const prev = statusEfetivoEmpMes(e, escala, ano, mes, "prevista");
  const prat = statusEfetivoEmpMes(e, escala, ano, mes, "real");
  const desconto: string[] = [], credito: string[] = [];
  const dias = new Set([...Object.keys(prev), ...Object.keys(prat)]);
  for (const d of [...dias].sort()) {
    if (d < de || d > ate) continue;
    const p = ehTrabalho(prev[d]), r = ehTrabalho(prat[d]);
    if (p && !r) desconto.push(d);      // pagou mas não trabalhou
    else if (!p && r) credito.push(d);  // trabalhou a mais que o previsto
  }
  return { desconto, credito };
}

// Último dia com lançamento EXPLÍCITO na praticada (escala.real[empId]).
export function ultimoDiaPraticada(escala: EscalaMes | null, empId: string): string | null {
  const m = (escala?.real as Record<string, Record<string, unknown>> | undefined)?.[empId];
  if (!m) return null;
  const dias = Object.keys(m).filter((d) => m[d] !== undefined).sort();
  return dias.length ? dias[dias.length - 1] : null;
}

export type ApuracaoInfo = {
  sugerido: string | null;                                              // até que dia TODOS estão apurados
  porEmpregado: { empregadoId: string; nome: string; ultimoDia: string | null }[];
  pendentes: { empregadoId: string; nome: string; ultimoDia: string | null }[];  // atrasam o fechamento
};

// Sugere a data "apurado até" (mínimo entre os empregados ativos) e lista pendentes.
export function apuracaoPraticada(empregados: Empregado[], escala: EscalaMes | null, ano: number, mes: number): ApuracaoInfo {
  const ativos = empregados.filter((e) => ativoNoMes(e, ano, mes) && (e.vtAtivo || e.vrAtivo));
  const porEmpregado = ativos.map((e) => ({ empregadoId: e.id, nome: e.nome, ultimoDia: ultimoDiaPraticada(escala, e.id) }));
  const dias = porEmpregado.map((p) => p.ultimoDia);
  const sugerido = dias.length > 0 && dias.every((d): d is string => !!d)
    ? dias.reduce((a, b) => (a! < b! ? a : b))!
    : null;
  const maxDia = dias.filter((d): d is string => !!d).sort().pop() || null;
  const pendentes = porEmpregado.filter((p) => !p.ultimoDia || (maxDia && p.ultimoDia < maxDia));
  return { sugerido, porEmpregado, pendentes };
}

// Cursor: próxima janela a reconciliar de um lote de pagamento, dado os ajustes já
// fechados dele. `de` = dia seguinte ao maior `janelaAte`; se nenhum, dia 01.
export function proximaJanela(pagamento: BeneficioPagLote, ajustes: BeneficioAjusteLote[]): { de: string } {
  const doLote = ajustes.filter((a) => a.pagamentoLoteId === pagamento.id && a.status !== "cancelado");
  if (doLote.length === 0) return { de: `${pagamento.ano}-${pad2(pagamento.mes)}-01` };
  const maxAte = doLote.map((a) => a.janelaAte).sort().pop()!;
  const d = new Date(maxAte + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return { de: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` };
}

// Monta as linhas do ajuste na janela [de, ate] usando o lote de pagamento como base.
export function montarLinhasAjuste(params: {
  pagamento: BeneficioPagLote; empregados: Empregado[]; escala: EscalaMes | null;
  ano: number; mes: number; de: string; ate: string; usaVR: boolean;
}): BeneficioAjusteLinha[] {
  const { pagamento, empregados, escala, ano, mes, de, ate, usaVR } = params;
  const empById = new Map(empregados.map((e) => [e.id, e]));
  const linhas: BeneficioAjusteLinha[] = [];
  for (const base of pagamento.linhas) {
    const e = empById.get(base.empregadoId);
    if (!e) continue;
    const diasPrev = contarDiasTrabalhadosNoRange(e, escala, ano, mes, de, ate, "prevista").dias;
    const diasPrat = contarDiasTrabalhadosNoRange(e, escala, ano, mes, de, ate, "real").dias;
    const ajusteDias = diasPrat - diasPrev;   // negativo = trabalhou menos que o pago = desconto
    if (ajusteDias === 0) continue;
    const vtVd = base.vtValorDiario || vtDiarioDe(e);
    const vrVd = usaVR ? (base.vrValorDiario || e.vrValorDiario || 0) : 0;
    const ajVt = base.vtAtivo ? round2(ajusteDias * vtVd) : 0;
    const ajVr = base.vrAtivo ? round2(ajusteDias * vrVd) : 0;
    const dd = diffDias(e, escala, ano, mes, de, ate);
    linhas.push({
      empregadoId: e.id, empregadoNome: e.nome,
      diasPrevista: diasPrev, diasPraticada: diasPrat, ajusteDias,
      vtValorDiario: vtVd, vrValorDiario: vrVd,
      ajusteVt: ajVt, ajusteVr: ajVr, ajusteTotal: round2(ajVt + ajVr),
      diasDesconto: dd.desconto, diasCredito: dd.credito,
    });
  }
  return linhas.sort((a, b) => a.empregadoNome.localeCompare(b.empregadoNome, "pt-BR"));
}

export function totalAjuste(linhas: BeneficioAjusteLinha[]): number {
  return round2(linhas.reduce((s, l) => s + l.ajusteTotal, 0));
}

// Mapa empregadoId → ajuste total (negativo = desconto) dos ajustes AINDA NÃO
// aplicados. É o que a coluna "Ajuste" do Pagamento do mês seguinte consome.
export function ajustePorEmpregadoPendente(ajustes: BeneficioAjusteLote[]): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const a of ajustes) {
    if (a.status !== "pendente") continue;   // fechados, ainda não aplicados
    for (const l of a.linhas) acc[l.empregadoId] = round2((acc[l.empregadoId] || 0) + l.ajusteTotal);
  }
  return acc;
}

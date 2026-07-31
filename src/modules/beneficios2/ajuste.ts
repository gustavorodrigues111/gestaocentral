// ════════════════════════════════════════════════════════════════════════════
//  Motor de AJUSTE (prevista × praticada). Funções PURAS (testáveis).
//  Reconcilia um lote de PAGAMENTO já pago contra a escala PRATICADA, numa janela
//  [de, ate]. O ajuste (dias praticados − dias pagos) × valor abate/credita no
//  Pagamento do mês seguinte. Cursor = último dia apurado PARA TODOS.
// ════════════════════════════════════════════════════════════════════════════
import type { Empregado, EscalaMes, BeneficioPagLote, BeneficioAjusteLote, BeneficioAjusteLinha } from "../../core/types";
import { contarDiasTrabalhados, contarDiasTrabalhadosNoRange, round2 } from "../vt/calc";
import { statusEfetivoEmpMes } from "../../core/escala/statusEfetivo";
import { vtDiarioDe, ativoNoMes } from "./calc";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { daysInMonth, pad2 } from "../../core/utils/date";

const ehTrabalho = (s?: string) => s === "trabalho" || s === "comp_trab";
const fimDoMes = (ano: number, mes: number) => `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;

// Empregado DESLIGADO durante o mês do lote: esteve ativo em algum dia, mas não
// no último. A demissão é definitiva — os dias pós-desligamento são conhecidos
// (não trabalhou), não dependem do DP fechar o ponto. Por isso o acerto dele
// reconcilia o PERÍODO PAGO INTEIRO, não a janela apurada dos ativos.
function demitidoNoMes(e: Empregado, ano: number, mes: number): boolean {
  return ativoNoMes(e, ano, mes) && !empregadoAtivoEm(e, fimDoMes(ano, mes));
}

// Dias efetivamente trabalhados na praticada, RESPEITANDO o desligamento: um dia
// após a demissão nunca conta (a praticada nasce cópia da prevista, então sem
// esse filtro um demitido apareceria "trabalhando" o mês todo).
function contarPraticadaAtiva(e: Empregado, escala: EscalaMes | null, ano: number, mes: number, de: string, ate: string): number {
  const dias = statusEfetivoEmpMes(e, escala, ano, mes, "real");
  let n = 0;
  for (const d of Object.keys(dias)) {
    if (d < de || d > ate) continue;
    if (!empregadoAtivoEm(e, d)) continue;   // pós-demissão = não trabalhou
    if (ehTrabalho(dias[d])) n++;
  }
  return n;
}

// Dias em que prevista×praticada divergem na janela (pra tooltip). Praticada
// respeita o desligamento (dia pós-demissão = não trabalhou).
function diffDias(e: Empregado, escala: EscalaMes | null, ano: number, mes: number, de: string, ate: string): { desconto: string[]; credito: string[] } {
  const prev = statusEfetivoEmpMes(e, escala, ano, mes, "prevista");
  const prat = statusEfetivoEmpMes(e, escala, ano, mes, "real");
  const desconto: string[] = [], credito: string[] = [];
  const dias = new Set([...Object.keys(prev), ...Object.keys(prat)]);
  for (const d of [...dias].sort()) {
    if (d < de || d > ate) continue;
    const p = ehTrabalho(prev[d]), r = empregadoAtivoEm(e, d) && ehTrabalho(prat[d]);
    if (p && !r) desconto.push(d);      // pagou mas não trabalhou
    else if (!p && r) credito.push(d);  // trabalhou a mais que o previsto
  }
  return { desconto, credito };
}

// Último dia REALMENTE apurado da praticada. A praticada nasce como cópia da
// prevista (todos os dias), então NÃO dá pra usar escala.real. O sinal certo é
// realAjustes[empId][date].origem === "solides_sync" — marca gravada quando o DP
// FECHA o dia no Fechamento de Ponto (Análise de Ponto). Sem essa marca = aberto.
export function ultimoDiaPraticada(escala: EscalaMes | null, empId: string): string | null {
  const m = (escala?.realAjustes as Record<string, Record<string, { origem?: string }>> | undefined)?.[empId];
  if (!m) return null;
  const dias = Object.keys(m).filter((d) => m[d]?.origem === "solides_sync").sort();
  return dias.length ? dias[dias.length - 1] : null;
}

export type ApuracaoInfo = {
  sugerido: string | null;                                              // menor dia confirmado entre todos
  porEmpregado: { empregadoId: string; nome: string; ultimoDia: string | null; demitido: boolean }[];
  pendentes: { empregadoId: string; nome: string; ultimoDia: string | null }[];  // não confirmados até o alvo
};

// Lista o dia confirmado de cada empregado e quem está pendente. `alvo` (ex.: ontem)
// = a meta: pendentes são os que não estão confirmados até lá. Sem `alvo`, usa o
// maior dia confirmado como referência. DEMITIDOS não entram no cálculo do cursor
// nem nas pendências — a demissão já é a confirmação, o acerto deles fecha o mês
// pago inteiro independentemente do DP.
export function apuracaoPraticada(empregados: Empregado[], escala: EscalaMes | null, ano: number, mes: number, alvo?: string): ApuracaoInfo {
  const ativos = empregados.filter((e) => ativoNoMes(e, ano, mes) && (e.vtAtivo || e.vrAtivo));
  const porEmpregado = ativos.map((e) => ({ empregadoId: e.id, nome: e.nome, ultimoDia: ultimoDiaPraticada(escala, e.id), demitido: demitidoNoMes(e, ano, mes) }));
  const emAberto = porEmpregado.filter((p) => !p.demitido);
  const dias = emAberto.map((p) => p.ultimoDia);
  const sugerido = dias.length > 0 && dias.every((d): d is string => !!d)
    ? dias.reduce((a, b) => (a! < b! ? a : b))!
    : null;
  const ref = alvo || (dias.filter((d): d is string => !!d).sort().pop() || null);
  const pendentes = emAberto.filter((p) => !p.ultimoDia || (ref && p.ultimoDia < ref));
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
// Empregado ATIVO: reconcilia só a janela apurada [de, ate] (prevista×praticada).
// Empregado DEMITIDO no mês: acerto final — reconcilia o mês PAGO inteiro
// (dias pagos frozen × dias realmente trabalhados até o desligamento), uma única
// vez (`ajustesAnteriores` evita repetir quem já teve acerto neste pagamento).
export function montarLinhasAjuste(params: {
  pagamento: BeneficioPagLote; empregados: Empregado[]; escala: EscalaMes | null;
  ano: number; mes: number; de: string; ate: string; usaVR: boolean;
  ajustesAnteriores?: BeneficioAjusteLote[];
}): BeneficioAjusteLinha[] {
  const { pagamento, empregados, escala, ano, mes, de, ate, usaVR, ajustesAnteriores = [] } = params;
  const empById = new Map(empregados.map((e) => [e.id, e]));
  const mesDe = `${ano}-${pad2(mes)}-01`, mesAte = fimDoMes(ano, mes);
  // Quem já tem acerto (não cancelado) neste pagamento — pra não reconciliar 2×.
  const jaAjustado = new Set<string>();
  for (const a of ajustesAnteriores) {
    if (a.pagamentoLoteId !== pagamento.id || a.status === "cancelado") continue;
    for (const l of a.linhas) jaAjustado.add(l.empregadoId);
  }
  const linhas: BeneficioAjusteLinha[] = [];
  for (const base of pagamento.linhas) {
    const e = empById.get(base.empregadoId);
    if (!e) continue;
    const demitido = demitidoNoMes(e, ano, mes);
    if (demitido && jaAjustado.has(e.id)) continue;   // acerto final já feito
    // Demitido: mês pago inteiro; base = dias PAGOS (frozen), imune a edição da prevista.
    const deEmp = demitido ? mesDe : de;
    const ateEmp = demitido ? mesAte : ate;
    const diasPrev = demitido ? base.diasTrabalhados : contarDiasTrabalhadosNoRange(e, escala, ano, mes, de, ate, "prevista").dias;
    const diasPrat = contarPraticadaAtiva(e, escala, ano, mes, deEmp, ateEmp);
    const ajusteDias = diasPrat - diasPrev;   // negativo = trabalhou menos que o pago = desconto
    const vtVd = base.vtValorDiario || vtDiarioDe(e);
    const vrVd = usaVR ? (base.vrValorDiario || e.vrValorDiario || 0) : 0;
    const ajVt = base.vtAtivo ? round2(ajusteDias * vtVd) : 0;
    const ajVr = base.vrAtivo ? round2(ajusteDias * vrVd) : 0;
    // Auxílio fixo mensal — proporcional. O pagamento paga o aux cheio; aqui a gente
    // acerta pelos dias. Falta (ativo): valor-dia = aux / dias PREVISTOS do mês inteiro,
    // desconta por dia de diferença. Demissão: aux / 30 × dias trabalhados − aux pago
    // (proporcional de rescisão sobre o que já foi pago cheio).
    const auxVt = base.vtAuxFixo ?? 0, auxVr = base.vrAuxFixo ?? 0;
    let ajAuxVt = 0, ajAuxVr = 0;
    if (demitido) {
      if (auxVt) ajAuxVt = round2((auxVt / 30) * diasPrat - auxVt);
      if (auxVr) ajAuxVr = round2((auxVr / 30) * diasPrat - auxVr);
    } else {
      const diasPrevMes = contarDiasTrabalhados(e, escala, ano, mes, "prevista");  // divisor do mês inteiro
      if (auxVt && diasPrevMes > 0) ajAuxVt = round2((auxVt / diasPrevMes) * ajusteDias);
      if (auxVr && diasPrevMes > 0) ajAuxVr = round2((auxVr / diasPrevMes) * ajusteDias);
    }
    const ajusteVt = round2(ajVt + ajAuxVt);
    const ajusteVr = round2(ajVr + ajAuxVr);
    // Sem movimento de dinheiro nem de dias → não gera linha.
    if (ajusteDias === 0 && ajusteVt === 0 && ajusteVr === 0) continue;
    const dd = diffDias(e, escala, ano, mes, deEmp, ateEmp);
    linhas.push({
      empregadoId: e.id, empregadoNome: e.nome,
      diasPrevista: diasPrev, diasPraticada: diasPrat, ajusteDias,
      vtValorDiario: vtVd, vrValorDiario: vrVd,
      ajusteVt, ajusteVr, ajusteTotal: round2(ajusteVt + ajusteVr),
      ...(ajAuxVt ? { ajusteAuxVt: ajAuxVt } : {}), ...(ajAuxVr ? { ajusteAuxVr: ajAuxVr } : {}),
      diasDesconto: dd.desconto, diasCredito: dd.credito,
      ...(demitido ? { demissao: true } : {}),
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

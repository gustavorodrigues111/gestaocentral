// ════════════════════════════════════════════════════════════════════════════
//  Descontos de gorjeta por ÁREA (mês) — reduzem proporcionalmente a fatia dos
//  empregados daquela área e aparecem como linha "Desconto" na Divisão do mês.
//  Modo automático: % do que foi gasto com FREELAS (diária) da área no período.
// ════════════════════════════════════════════════════════════════════════════
import type { Cargo, FreelaShift } from "../../core/types";

export type GorjetaDesconto = {
  id: string;
  restaurantId: string;
  competencia: string;          // YYYY-MM
  area: string;                 // área alvo (ex: "Salão")
  descricao: string;            // motivo (aparece na linha)
  tipo: "valor" | "percFreelas";
  valorFixo?: number;           // tipo=valor
  perc?: number;                // tipo=percFreelas (0-100)
  periodoDe?: string;           // YYYY-MM-DD (default: 1º dia do mês)
  periodoAte?: string;          // YYYY-MM-DD (default: último dia do mês)
  criadoEm?: string;
  criadoPor?: { id: string; nome: string };
};

const STATUS_TRABALHADO = new Set(["aberto", "fechamento", "pago"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

export function fimDoMes(competencia: string): string {
  const [y, m] = competencia.split("-").map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${competencia}-${String(d).padStart(2, "0")}`;
}

export function areaDoFreela(s: FreelaShift, cargoById: Record<string, Cargo>): string {
  return s.area || cargoById[s.gorjetaCargoId || ""]?.area || "Sem área";
}

export type DescontoDetalheFreela = { nome: string; dias: { date: string; diaria: number }[]; diaria: number };
export type DescontoCalc = {
  desconto: GorjetaDesconto;
  valor: number;            // valor pedido (base × perc), antes de capar por dia
  valorBase: number;        // base do cálculo (diária dos freelas, quando percFreelas)
  detalhe: DescontoDetalheFreela[];
  basePorDia: Record<string, number>;   // date -> soma das diárias de freela (percFreelas)
  periodoDe: string; periodoAte: string;
};

// Calcula o valor (e o detalhe de freelas) de um desconto.
export function calcularDesconto(
  d: GorjetaDesconto,
  freelaShifts: FreelaShift[],
  cargoById: Record<string, Cargo>,
): DescontoCalc {
  const periodoDe = d.periodoDe || `${d.competencia}-01`;
  const periodoAte = d.periodoAte || fimDoMes(d.competencia);
  if (d.tipo === "valor") {
    return { desconto: d, valor: round2(d.valorFixo || 0), valorBase: 0, detalhe: [], basePorDia: {}, periodoDe, periodoAte };
  }
  // percFreelas: base = soma das DIÁRIAS (totalCalc) dos freelas da área no período.
  const fs = freelaShifts.filter(s =>
    STATUS_TRABALHADO.has(s.status) && s.date >= periodoDe && s.date <= periodoAte
    && areaDoFreela(s, cargoById) === d.area);
  const porFreela: Record<string, DescontoDetalheFreela> = {};
  const basePorDia: Record<string, number> = {};
  let base = 0;
  for (const s of fs) {
    const diaria = s.totalCalc || 0;
    base += diaria;
    basePorDia[s.date] = (basePorDia[s.date] || 0) + diaria;
    const k = (s.pessoaId || s.empregadoId || `nome:${(s.nomeSnapshot || "").toLowerCase()}`);
    if (!porFreela[k]) porFreela[k] = { nome: s.nomeSnapshot || "—", dias: [], diaria: 0 };
    porFreela[k].dias.push({ date: s.date, diaria });
    porFreela[k].diaria += diaria;
  }
  const valor = round2(base * (d.perc || 0) / 100);
  const detalhe = Object.values(porFreela).map(f => ({ ...f, dias: f.dias.sort((a, b) => a.date.localeCompare(b.date)), diaria: round2(f.diaria) })).sort((a, b) => b.diaria - a.diaria);
  return { desconto: d, valor, valorBase: round2(base), detalhe, basePorDia, periodoDe, periodoAte };
}

// Mapa date -> { area -> R$ a descontar naquele dia } (só percFreelas).
// desconto do dia na área = (soma das diárias de freela da área no dia) × perc.
export function reducaoDiaArea(descontosCalc: DescontoCalc[]): Map<string, Record<string, number>> {
  const m = new Map<string, Record<string, number>>();
  for (const dc of descontosCalc) {
    if (dc.desconto.tipo !== "percFreelas") continue;
    const perc = (dc.desconto.perc || 0) / 100;
    for (const [date, base] of Object.entries(dc.basePorDia)) {
      const byArea = m.get(date) || {};
      byArea[dc.desconto.area] = (byArea[dc.desconto.area] || 0) + round2(base * perc);
      m.set(date, byArea);
    }
  }
  return m;
}

// Reduz os itens de UM dia (uma gorjeta): tira, por área, o valor do desconto
// daquele dia, proporcional entre os NÃO-freelas da área (capado ao líquido da
// área no dia). Retorna itens novos + quanto foi efetivamente aplicado por área.
export function reduzirItensDia<T extends { valor: number; area: string; freela?: boolean }>(
  itens: T[], date: string, mapa: Map<string, Record<string, number>>,
): { itens: T[]; aplicadoPorArea: Record<string, number> } {
  const byArea = mapa.get(date);
  if (!byArea) return { itens, aplicadoPorArea: {} };
  const liqArea: Record<string, number> = {};
  for (const it of itens) if (!it.freela) liqArea[it.area] = (liqArea[it.area] || 0) + it.valor;
  const aplicadoPorArea: Record<string, number> = {};
  const fatorArea: Record<string, number> = {};
  for (const area of Object.keys(byArea)) {
    const at = liqArea[area] || 0;
    const efetivo = Math.min(byArea[area], at);
    if (efetivo > 0) { aplicadoPorArea[area] = round2(efetivo); fatorArea[area] = at > 0 ? 1 - efetivo / at : 1; }
  }
  if (Object.keys(fatorArea).length === 0) return { itens, aplicadoPorArea: {} };
  const novos = itens.map(it => (!it.freela && fatorArea[it.area] != null) ? { ...it, valor: it.valor * fatorArea[it.area] } : it);
  return { itens: novos, aplicadoPorArea };
}

// Aplica os descontos às linhas (reduz proporcional os empregados da área).
// Retorna as linhas ajustadas + o total efetivamente descontado por área
// (capado ao líquido disponível da área).
export type LinhaMin = { empregadoId: string; area: string; bruto: number; retencao: number; liquido: number; ehGrupoFreela?: boolean };
export function aplicarDescontos<T extends LinhaMin>(linhas: T[], descontos: DescontoCalc[]): { linhasAjustadas: T[]; efetivoPorArea: Record<string, number> } {
  const pedidoPorArea: Record<string, number> = {};
  for (const dc of descontos) pedidoPorArea[dc.desconto.area] = (pedidoPorArea[dc.desconto.area] || 0) + dc.valor;
  const liquidoPorArea: Record<string, number> = {};
  for (const l of linhas) if (!l.ehGrupoFreela) liquidoPorArea[l.area] = (liquidoPorArea[l.area] || 0) + l.liquido;
  const efetivoPorArea: Record<string, number> = {};
  for (const area of Object.keys(pedidoPorArea)) efetivoPorArea[area] = round2(Math.min(pedidoPorArea[area], liquidoPorArea[area] || 0));
  const linhasAjustadas = linhas.map(l => {
    if (l.ehGrupoFreela) return l;
    const efetivo = efetivoPorArea[l.area]; const at = liquidoPorArea[l.area] || 0;
    if (!efetivo || at <= 0 || l.liquido <= 0) return l;
    const corte = efetivo * (l.liquido / at);
    const novoLiq = round2(l.liquido - corte);
    const fator = l.liquido > 0 ? novoLiq / l.liquido : 1;
    return { ...l, liquido: novoLiq, bruto: round2(l.bruto * fator), retencao: round2(l.retencao * fator) };
  });
  return { linhasAjustadas, efetivoPorArea };
}

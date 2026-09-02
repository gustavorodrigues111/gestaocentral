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
  valor: number;            // valor efetivamente descontado (já pode estar capado à área)
  valorBase: number;        // base do cálculo (diária dos freelas, quando percFreelas)
  detalhe: DescontoDetalheFreela[];
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
    return { desconto: d, valor: round2(d.valorFixo || 0), valorBase: 0, detalhe: [], periodoDe, periodoAte };
  }
  // percFreelas: base = soma das DIÁRIAS (totalCalc) dos freelas da área no período.
  const fs = freelaShifts.filter(s =>
    STATUS_TRABALHADO.has(s.status) && s.date >= periodoDe && s.date <= periodoAte
    && areaDoFreela(s, cargoById) === d.area);
  const porFreela: Record<string, DescontoDetalheFreela> = {};
  let base = 0;
  for (const s of fs) {
    const diaria = s.totalCalc || 0;
    base += diaria;
    const k = (s.pessoaId || s.empregadoId || `nome:${(s.nomeSnapshot || "").toLowerCase()}`);
    if (!porFreela[k]) porFreela[k] = { nome: s.nomeSnapshot || "—", dias: [], diaria: 0 };
    porFreela[k].dias.push({ date: s.date, diaria });
    porFreela[k].diaria += diaria;
  }
  const valor = round2(base * (d.perc || 0) / 100);
  const detalhe = Object.values(porFreela).map(f => ({ ...f, dias: f.dias.sort((a, b) => a.date.localeCompare(b.date)), diaria: round2(f.diaria) })).sort((a, b) => b.diaria - a.diaria);
  return { desconto: d, valor, valorBase: round2(base), detalhe, periodoDe, periodoAte };
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

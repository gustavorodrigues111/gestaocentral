// Engine de custo das receitas. Composição plana: cada ingrediente é um insumo,
// uma subficha (outra receita reutilizável) ou um subproduto (coproduto de outro
// preparo). Recursivo com anti-ciclo. Q.b. não entra; fator de correção
// multiplica a quantidade. Preparo com subprodutos rateia o custo: o principal
// fica com 100 − Σ(% dos subprodutos).
import type { FtFicha, FtIngrediente, FtInsumo } from "../../core/types";
import { paraBase } from "./unidades";

type Ctx = {
  insumos: Map<string, FtInsumo>;
  fichas: Map<string, FtFicha>;
  semCusto: Set<string>;   // nomes de insumos sem custo (pra badge)
};

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
// fc = % de aproveitamento da variação (100 = inteiro). Quanto menor o
// aproveitamento, MAIS produto bruto é preciso → multiplicador 100/fc.
const fcMul = (ing: FtIngrediente) => (ing.fc && ing.fc > 0 ? 100 / ing.fc : 1);

// % do custo total que fica com a saída PRINCIPAL (100 − Σ dos subprodutos).
function pctPrincipal(f: FtFicha): number {
  const somaSub = (f.subprodutos || []).reduce((s, sp) => s + (sp.percentualCusto || 0), 0);
  return Math.max(0, 100 - somaSub) / 100;
}

// Escala o custo pela fração usada do rendimento.
function escala(qtd: number, unidade: string, rend: { qtd: number; unidade: string }, custoTotal: number): number {
  const usado = paraBase(qtd, unidade);
  const total = paraBase(rend.qtd, rend.unidade);
  if (usado != null && total && total > 0) return (usado / total) * custoTotal;
  if (rend.qtd > 0) return (qtd / rend.qtd) * custoTotal; // fallback: mesma unidade
  return 0;
}

function custoIngrediente(ing: FtIngrediente, ctx: Ctx, visited: Set<string>): number {
  if (ing.qb) return 0;
  const qty = (ing.qtd || 0) * fcMul(ing);

  if (ing.tipo === "insumo") {
    const ins = ctx.insumos.get(ing.refId);
    if (!ins) { ctx.semCusto.add(ing.nomeSnapshot || "?"); return 0; }
    if (ins.reutilizavel) return 0;
    // Insumo vinculado a um subproduto: custo deriva do rateio do preparo-pai.
    if (ins.subprodutoDe) {
      const pai = ctx.fichas.get(ins.subprodutoDe.fichaId);
      const sp = pai?.subprodutos?.find(x => x.id === ins.subprodutoDe!.subId);
      if (!pai || !sp || visited.has(pai.id)) { ctx.semCusto.add(ins.nome); return 0; }
      const custoAlocado = custoBrutoFicha(pai, ctx, visited) * ((sp.percentualCusto || 0) / 100);
      const rendBase = paraBase(sp.rendimentoQtd, sp.unidade);
      const emBaseIng = paraBase(qty, ing.unidade);
      if (emBaseIng == null || !rendBase || rendBase <= 0) return 0;
      return emBaseIng * (custoAlocado / rendBase);
    }
    if (!ins.custo || ins.custo <= 0) ctx.semCusto.add(ins.nome);
    const emBaseIng = paraBase(qty, ing.unidade);
    const baseDaUnidadeBase = paraBase(1, ins.unidadeBase);
    if (emBaseIng == null || !baseDaUnidadeBase) return 0; // unidade incompatível
    return (emBaseIng / baseDaUnidadeBase) * (ins.custo || 0);
  }

  if (ing.tipo === "subproduto") {
    const pai = ctx.fichas.get(ing.refId);
    const sp = pai?.subprodutos?.find(x => x.id === ing.subId);
    if (!pai || !sp || visited.has(pai.id)) return 0;
    const custoAlocado = custoBrutoFicha(pai, ctx, visited) * ((sp.percentualCusto || 0) / 100);
    return escala(qty, ing.unidade, { qtd: sp.rendimentoQtd, unidade: sp.unidade }, custoAlocado);
  }

  // tipo "ficha" → subficha (consome a saída PRINCIPAL dela)
  const sub = ctx.fichas.get(ing.refId);
  if (!sub || visited.has(sub.id)) return 0;
  return escala(qty, ing.unidade, sub.rendimento, custoBrutoFicha(sub, ctx, visited) * pctPrincipal(sub));
}

// Custo BRUTO do preparo = Σ ingredientes (antes do rateio pra subprodutos).
function custoBrutoFicha(ficha: FtFicha, ctx: Ctx, visited: Set<string>): number {
  if (visited.has(ficha.id)) return 0;
  visited.add(ficha.id);
  const total = (ficha.ingredientes || []).reduce((s, ing) => s + custoIngrediente(ing, ctx, visited), 0);
  visited.delete(ficha.id);
  return total;
}

export type CustoSubproduto = { id: string; nome: string; percentual: number; custo: number; porRendimento: number };
export type CustoResultado = {
  total: number;           // custo alocado à saída PRINCIPAL (bruto × %principal)
  porRendimento: number;   // total / rendimento.qtd
  bruto: number;           // Σ ingredientes (custo total do preparo)
  insumosSemCusto: string[];
  subprodutos: CustoSubproduto[];
};

export function calcularCusto(ficha: FtFicha, insumos: FtInsumo[], fichas: FtFicha[]): CustoResultado {
  const ctx: Ctx = {
    insumos: new Map(insumos.map(i => [i.id, i])),
    fichas: new Map(fichas.map(f => [f.id, f])),
    semCusto: new Set<string>(),
  };
  const bruto = round2(custoBrutoFicha(ficha, ctx, new Set()));
  const total = round2(bruto * pctPrincipal(ficha));
  const rend = ficha.rendimento?.qtd || 0;
  const subprodutos: CustoSubproduto[] = (ficha.subprodutos || []).map(sp => {
    const custo = round2(bruto * ((sp.percentualCusto || 0) / 100));
    return { id: sp.id, nome: sp.nome, percentual: sp.percentualCusto || 0, custo, porRendimento: sp.rendimentoQtd > 0 ? round2(custo / sp.rendimentoQtd) : 0 };
  });
  return { total, porRendimento: rend > 0 ? round2(total / rend) : 0, bruto, insumosSemCusto: [...ctx.semCusto], subprodutos };
}

// Custo de CADA ingrediente do preparo (nível de topo) — pra a ficha de custo.
export type CustoLinha = { nome: string; tipo: FtIngrediente["tipo"]; qtd: number; unidade: string; qb: boolean; custo: number; semCusto: boolean };
export function custoPorIngrediente(ficha: FtFicha, insumos: FtInsumo[], fichas: FtFicha[]): CustoLinha[] {
  const ctx: Ctx = { insumos: new Map(insumos.map(i => [i.id, i])), fichas: new Map(fichas.map(f => [f.id, f])), semCusto: new Set<string>() };
  return (ficha.ingredientes || []).map(ing => {
    let nome = ing.nomeSnapshot || "?";
    if (ing.tipo === "insumo") { const i = ctx.insumos.get(ing.refId); if (i) nome = i.nome; }
    else if (ing.tipo === "ficha") { const f = ctx.fichas.get(ing.refId); if (f) nome = f.nome; }
    else if (ing.tipo === "subproduto") { const p = ctx.fichas.get(ing.refId); const sp = p?.subprodutos?.find(s => s.id === ing.subId); if (sp) nome = sp.nome; }
    if (ing.variacaoNome) nome += ` (${ing.variacaoNome})`;
    const antes = ctx.semCusto.size;
    const custo = round2(custoIngrediente(ing, ctx, new Set()));
    return { nome, tipo: ing.tipo, qtd: ing.qtd || 0, unidade: ing.unidade, qb: !!ing.qb, custo, semCusto: ctx.semCusto.size > antes || (!ing.qb && custo <= 0 && ing.tipo === "insumo") };
  });
}

// Preço MÉDIO dos últimos 3 meses (média simples dos registros de custo no
// período). Sem mudança no período → cai no último preço conhecido.
export function precoMedio3m(insumo: FtInsumo, hojeIso: string): number {
  const hist = (insumo.historicoCusto || []).filter(h => (h.custo || 0) > 0);
  if (hist.length === 0) return insumo.custo || 0;
  const d = new Date(hojeIso); d.setMonth(d.getMonth() - 3);
  const limite = d.toISOString().slice(0, 10);
  const recentes = hist.filter(h => (h.data || "").slice(0, 10) >= limite);
  const base = recentes.length ? recentes : [hist[hist.length - 1]];
  return round2(base.reduce((s, h) => s + h.custo, 0) / base.length);
}

// Devolve os insumos com o custo trocado pelo preço médio 3m (pra recalcular
// fichas nesse modo sem mexer no motor).
export function insumosComMedia(insumos: FtInsumo[], hojeIso: string): FtInsumo[] {
  return insumos.map(i => i.ehSubproduto ? i : { ...i, custo: precoMedio3m(i, hojeIso) });
}

// CMV% e markup (Cardápio — Fase 4).
export function cmvPct(custo: number, precoVenda: number): number | null {
  if (!precoVenda) return null;
  return Math.round((custo / precoVenda) * 1000) / 10;
}
export function markup(custo: number, precoVenda: number): number | null {
  if (!custo) return null;
  return Math.round((precoVenda / custo) * 10) / 10;
}

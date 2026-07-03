// Engine de custo das fichas técnicas. Recursiva: um ingrediente pode ser um
// insumo, outra subficha (subref) ou um subproduto (outra ficha). Q.b. não
// entra no custo; fator de correção multiplica a quantidade.
import type { FtFicha, FtIngrediente, FtInsumo, FtSubficha } from "../../core/types";
import { paraBase } from "./unidades";

type Ctx = {
  insumos: Map<string, FtInsumo>;
  fichas: Map<string, FtFicha>;
  semCusto: Set<string>;   // nomes de insumos sem custo (pra badge)
};

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const fcMul = (ing: FtIngrediente) => (ing.fc && ing.fc >= 1 ? ing.fc : 1);

// Escala o custo de uma subficha/subproduto pela fração usada do rendimento.
function escala(qtd: number, unidade: string, rend: { qtd: number; unidade: string }, custoTotal: number): number {
  const usado = paraBase(qtd, unidade);
  const total = paraBase(rend.qtd, rend.unidade);
  if (usado != null && total && total > 0) return (usado / total) * custoTotal;
  if (rend.qtd > 0) return (qtd / rend.qtd) * custoTotal; // fallback: mesma unidade
  return 0;
}

function custoIngrediente(ing: FtIngrediente, ficha: FtFicha, ctx: Ctx, visited: Set<string>): number {
  if (ing.qb) return 0;
  const qty = (ing.qtd || 0) * fcMul(ing);

  if (ing.tipo === "insumo") {
    const ins = ctx.insumos.get(ing.refId);
    if (!ins) { ctx.semCusto.add(ing.nomeSnapshot || "?"); return 0; }
    if (!ins.custo || ins.custo <= 0) ctx.semCusto.add(ins.nome);
    if (ins.reutilizavel) return 0; // reutilizável não pesa custo cheio na produção
    const emBaseIng = paraBase(qty, ing.unidade);
    const baseDaUnidadeBase = paraBase(1, ins.unidadeBase);
    if (emBaseIng == null || !baseDaUnidadeBase) return 0; // unidade incompatível
    const qtdNaUnidadeBase = emBaseIng / baseDaUnidadeBase;
    return qtdNaUnidadeBase * (ins.custo || 0);
  }

  if (ing.tipo === "subficha") {
    const sf = ficha.subfichas.find(s => s.id === ing.refId);
    if (!sf) return 0;
    return escala(qty, ing.unidade, sf.rendimento, custoSubficha(sf, ficha, ctx, visited));
  }

  if (ing.tipo === "subproduto") {
    const sub = ctx.fichas.get(ing.refId);
    if (!sub || visited.has(sub.id)) return 0;
    const subCost = custoFicha(sub, ctx, new Set(visited).add(ficha.id));
    return escala(qty, ing.unidade, sub.rendimentoFinal, subCost);
  }
  return 0;
}

function custoSubficha(sf: FtSubficha, ficha: FtFicha, ctx: Ctx, visited: Set<string>): number {
  return (sf.ingredientes || []).reduce((s, ing) => s + custoIngrediente(ing, ficha, ctx, visited), 0);
}

// Custo total da ficha = soma das subfichas "raiz" (não consumidas por outra
// subficha via subref). Se nenhuma referencia outra, soma todas.
function custoFicha(ficha: FtFicha, ctx: Ctx, visited: Set<string> = new Set()): number {
  if (visited.has(ficha.id)) return 0;
  const subs = ficha.subfichas || [];
  const referenciadas = new Set<string>();
  for (const sf of subs) for (const ing of sf.ingredientes || []) if (ing.tipo === "subficha") referenciadas.add(ing.refId);
  const roots = subs.filter(sf => !referenciadas.has(sf.id));
  const alvo = roots.length ? roots : subs;
  return alvo.reduce((s, sf) => s + custoSubficha(sf, ficha, ctx, visited), 0);
}

export type CustoResultado = {
  total: number;
  porRendimento: number;
  subfichas: { id: string; nome: string; custo: number }[];
  insumosSemCusto: string[];
};

export function calcularCusto(ficha: FtFicha, insumos: FtInsumo[], fichas: FtFicha[]): CustoResultado {
  const ctx: Ctx = {
    insumos: new Map(insumos.map(i => [i.id, i])),
    fichas: new Map(fichas.map(f => [f.id, f])),
    semCusto: new Set<string>(),
  };
  const subCosts = (ficha.subfichas || []).map(sf => ({
    id: sf.id, nome: sf.nome, custo: round2(custoSubficha(sf, ficha, ctx, new Set())),
  }));
  const total = round2(custoFicha(ficha, ctx));
  const rend = ficha.rendimentoFinal?.qtd || 0;
  return {
    total,
    porRendimento: rend > 0 ? round2(total / rend) : 0,
    subfichas: subCosts,
    insumosSemCusto: [...ctx.semCusto],
  };
}

// CMV% e markup (usados no Cardápio — Fase 4 — mas o helper já fica aqui).
export function cmvPct(custo: number, precoVenda: number): number | null {
  if (!precoVenda) return null;
  return Math.round((custo / precoVenda) * 1000) / 10;
}
export function markup(custo: number, precoVenda: number): number | null {
  if (!custo) return null;
  return Math.round((precoVenda / custo) * 10) / 10;
}

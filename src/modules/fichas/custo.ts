// Engine de custo das receitas. Composição plana: cada ingrediente é um insumo
// ou uma subficha (outra receita reutilizável). Recursivo com anti-ciclo.
// Q.b. não entra no custo; fator de correção multiplica a quantidade.
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

// Escala o custo de uma subficha pela fração usada do rendimento dela.
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
    if (!ins.custo || ins.custo <= 0) ctx.semCusto.add(ins.nome);
    if (ins.reutilizavel) return 0;
    const emBaseIng = paraBase(qty, ing.unidade);
    const baseDaUnidadeBase = paraBase(1, ins.unidadeBase);
    if (emBaseIng == null || !baseDaUnidadeBase) return 0; // unidade incompatível
    return (emBaseIng / baseDaUnidadeBase) * (ins.custo || 0);
  }

  // tipo "ficha" → subficha (receita reutilizável)
  const sub = ctx.fichas.get(ing.refId);
  if (!sub || visited.has(sub.id)) return 0;
  return escala(qty, ing.unidade, sub.rendimento, custoFicha(sub, ctx, visited));
}

function custoFicha(ficha: FtFicha, ctx: Ctx, visited: Set<string>): number {
  if (visited.has(ficha.id)) return 0;
  visited.add(ficha.id);
  const total = (ficha.ingredientes || []).reduce((s, ing) => s + custoIngrediente(ing, ctx, visited), 0);
  visited.delete(ficha.id);
  return total;
}

export type CustoResultado = {
  total: number;
  porRendimento: number;
  insumosSemCusto: string[];
};

export function calcularCusto(ficha: FtFicha, insumos: FtInsumo[], fichas: FtFicha[]): CustoResultado {
  const ctx: Ctx = {
    insumos: new Map(insumos.map(i => [i.id, i])),
    fichas: new Map(fichas.map(f => [f.id, f])),
    semCusto: new Set<string>(),
  };
  const total = round2(custoFicha(ficha, ctx, new Set()));
  const rend = ficha.rendimento?.qtd || 0;
  return { total, porRendimento: rend > 0 ? round2(total / rend) : 0, insumosSemCusto: [...ctx.semCusto] };
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

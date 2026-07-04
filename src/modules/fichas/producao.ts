// Motor de PRODUÇÃO: escala uma ficha pro rendimento-alvo e expande as bases
// aninhadas recursivamente. SEM custo — só quantidades e preparo (modo trabalho).
import type { FtFicha, FtInsumo } from "../../core/types";
import { paraBase } from "./unidades";

export type ProdIngrediente = { nome: string; qtd: number; unidade: string; qb: boolean };
export type ProdNode = {
  id: string;
  nome: string;
  alvoQtd: number;
  alvoUnidade: string;
  modoPreparo?: string | null;
  ingredientes: ProdIngrediente[];   // insumos deste nível, já escalados
  bases: ProdNode[];                 // subfichas a produzir, escaladas (recursivo)
  subprodutos: ProdIngrediente[];    // subprodutos consumidos (só exibe)
};

// Fator de escala: alvo ÷ rendimento (na base da dimensão; fallback mesma
// unidade). Se o rendimento não foi definido (0), a receita é tratada como
// "para 1 unidade" → escala direto pelo alvo (ex.: prato final por porção).
function fatorDe(rend: { qtd: number; unidade: string }, alvoQtd: number, alvoUnidade: string): number {
  const rb = paraBase(rend.qtd, rend.unidade);
  const ab = paraBase(alvoQtd, alvoUnidade);
  if (rb != null && ab != null && rb > 0) return ab / rb;
  if (rend.qtd > 0) return alvoQtd / rend.qtd;
  return alvoQtd > 0 ? alvoQtd : 1;
}

export function montarProducao(
  ficha: FtFicha, alvoQtd: number, alvoUnidade: string,
  fichas: FtFicha[], insumos: FtInsumo[], visitados: Set<string> = new Set(),
): ProdNode {
  const fator = fatorDe(ficha.rendimento, alvoQtd, alvoUnidade);
  const seen = new Set(visitados); seen.add(ficha.id);
  const ingredientes: ProdIngrediente[] = [];
  const bases: ProdNode[] = [];
  const subprodutos: ProdIngrediente[] = [];
  for (const ing of ficha.ingredientes || []) {
    const q = (ing.qtd || 0) * fator;
    if (ing.tipo === "insumo") {
      const ins = insumos.find(i => i.id === ing.refId);
      const nome = `${ins?.nome || ing.nomeSnapshot || "?"}${ing.variacaoNome ? ` (${ing.variacaoNome})` : ""}`;
      ingredientes.push({ nome, qtd: q, unidade: ing.unidade, qb: !!ing.qb });
    } else if (ing.tipo === "ficha") {
      const base = fichas.find(x => x.id === ing.refId && x.ativo !== false);
      if (base && !seen.has(base.id)) {
        bases.push(montarProducao(base, q, ing.unidade, fichas, insumos, seen));
      } else {
        ingredientes.push({ nome: `${base?.nome || ing.nomeSnapshot || "?"} (base)`, qtd: q, unidade: ing.unidade, qb: !!ing.qb });
      }
    } else if (ing.tipo === "subproduto") {
      const pai = fichas.find(x => x.id === ing.refId);
      const sp = pai?.subprodutos?.find(s => s.id === ing.subId);
      subprodutos.push({ nome: `${sp?.nome || ing.nomeSnapshot || "?"}${pai ? ` (de ${pai.nome})` : ""}`, qtd: q, unidade: ing.unidade, qb: !!ing.qb });
    }
  }
  return { id: ficha.id, nome: ficha.nome, alvoQtd, alvoUnidade, modoPreparo: ficha.modoPreparo, ingredientes, bases, subprodutos };
}

// ─── BOM: lista consolidada de insumos de um LOTE de fichas ────────────────
export type BomLinha = { nome: string; qtd: number; unidade: string; qb: boolean };
function coletar(node: ProdNode, ins: ProdIngrediente[], sub: ProdIngrediente[]) {
  for (const i of node.ingredientes) ins.push(i);
  for (const s of node.subprodutos) sub.push(s);
  for (const b of node.bases) coletar(b, ins, sub);
}
function consolidar(itens: ProdIngrediente[]): BomLinha[] {
  const m = new Map<string, BomLinha>();
  for (const i of itens) {
    const chave = `${i.nome.trim().toUpperCase()}|${i.unidade}|${i.qb ? "qb" : "q"}`;
    const at = m.get(chave);
    if (at) { at.qtd += i.qb ? 0 : i.qtd; }
    else m.set(chave, { nome: i.nome, unidade: i.unidade, qb: i.qb, qtd: i.qb ? 0 : i.qtd });
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export type PlanoExplosao = { nodes: ProdNode[]; insumos: BomLinha[]; subprodutos: BomLinha[] };
export function explodirLote(itens: { ficha: FtFicha; qtd: number }[], fichas: FtFicha[], insumos: FtInsumo[]): PlanoExplosao {
  const nodes = itens.filter(it => it.ficha).map(it => montarProducao(it.ficha, it.qtd, it.ficha.rendimento.unidade, fichas, insumos));
  const ins: ProdIngrediente[] = [], sub: ProdIngrediente[] = [];
  for (const n of nodes) coletar(n, ins, sub);
  return { nodes, insumos: consolidar(ins), subprodutos: consolidar(sub) };
}

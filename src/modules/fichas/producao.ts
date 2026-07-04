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

// Fator de escala: alvo ÷ rendimento (na base da dimensão; fallback mesma unidade).
function fatorDe(rend: { qtd: number; unidade: string }, alvoQtd: number, alvoUnidade: string): number {
  const rb = paraBase(rend.qtd, rend.unidade);
  const ab = paraBase(alvoQtd, alvoUnidade);
  if (rb != null && ab != null && rb > 0) return ab / rb;
  return rend.qtd > 0 ? alvoQtd / rend.qtd : 1;
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

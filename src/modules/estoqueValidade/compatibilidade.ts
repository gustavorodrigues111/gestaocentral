// Vínculo produto ↔ local de estoque.
// Cada local tem UM método de conservação (Geladeira 1 = Refrigerado, Freezer =
// Congelado…). Um produto só pode ser vinculado a um local se tiver prazo
// cadastrado para o método daquele local; a validade da etiqueta sai daí.

export type LocalComMetodo = { id: string; nome: string; ativo: boolean; metodoConservacao?: string | null };
export type ProdutoComMatriz = { id: string; ativo: boolean; conservacao: Record<string, number>; locais?: string[] };

/** Método sugerido pelo tipo do local (o usuário pode trocar). */
export const METODO_POR_TIPO: Record<string, string> = {
  geladeira: "refrigerado", camara: "refrigerado", freezer: "congelado",
  seco: "seco", prateleira: "seco", bancada: "ambiente",
};

export function compativel(produto: Pick<ProdutoComMatriz, "conservacao">, local: Pick<LocalComMetodo, "metodoConservacao">): boolean {
  const m = local.metodoConservacao;
  return !!m && produto.conservacao?.[m] != null;
}

/** Dias de validade do produto naquele local (null = incompatível). */
export function diasNoLocal(produto: Pick<ProdutoComMatriz, "conservacao">, local: Pick<LocalComMetodo, "metodoConservacao">): number | null {
  return compativel(produto, local) ? produto.conservacao[local.metodoConservacao!] : null;
}

/** Produtos ativos vinculados ao local E compatíveis com o método dele. */
export function produtosDoLocal<P extends ProdutoComMatriz>(produtos: P[], local: LocalComMetodo): P[] {
  return produtos.filter((p) => p.ativo && (p.locais || []).includes(local.id) && compativel(p, local));
}

/** Remove vínculos que deixaram de ser compatíveis (ex.: tirou o prazo de congelado da matriz). */
export function limparVinculos(locaisDoProduto: string[], conservacao: Record<string, number>, locais: LocalComMetodo[]): string[] {
  return locaisDoProduto.filter((id) => {
    const l = locais.find((x) => x.id === id);
    return !!l && compativel({ conservacao }, l);
  });
}

// ── Ambientes ────────────────────────────────────────────────────────────────
// Ambiente = sala física (Cozinha de baixo, Laje). Equipamento = freezer,
// geladeira, estante… dentro de um ambiente (paiId). Só equipamentos têm
// conservação e recebem produtos.
export type LocalHierarquia = { id: string; nome: string; tipo: string; paiId?: string | null; ativo: boolean; ordem?: number; metodoConservacao?: string | null };

export const ehAmbiente = (l: Pick<LocalHierarquia, "tipo">) => l.tipo === "ambiente";

/** "Laje · Freezer" (ou só "Freezer" quando não está num ambiente). */
export function nomeCompleto(l: LocalHierarquia | undefined | null, locais: LocalHierarquia[]): string {
  if (!l) return "";
  const pai = l.paiId ? locais.find((x) => x.id === l.paiId && ehAmbiente(x)) : null;
  return pai ? `${pai.nome} · ${l.nome}` : l.nome;
}

const ordenar = <T extends LocalHierarquia>(a: T, b: T) => (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome);

/** Ambientes ativos com os seus equipamentos; equipamentos soltos ficam em "Sem ambiente" (id ""). */
export function agruparPorAmbiente<T extends LocalHierarquia>(locais: T[], soAtivos = true): { ambiente: T | null; equipamentos: T[] }[] {
  const lista = soAtivos ? locais.filter((l) => l.ativo) : locais;
  const ambientes = lista.filter(ehAmbiente).sort(ordenar);
  const ids = new Set(ambientes.map((a) => a.id));
  const grupos = ambientes.map((a) => ({ ambiente: a as T | null, equipamentos: lista.filter((l) => !ehAmbiente(l) && l.paiId === a.id).sort(ordenar) }));
  const soltos = lista.filter((l) => !ehAmbiente(l) && !(l.paiId && ids.has(l.paiId))).sort(ordenar);
  if (soltos.length) grupos.push({ ambiente: null, equipamentos: soltos });
  return grupos;
}

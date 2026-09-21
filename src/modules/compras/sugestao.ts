// ════════════════════════════════════════════════════════════════════════════
//  Motor de sugestão de pedido de compra.
//  Cruza a última contagem × estoque mínimo de cada insumo e sugere quanto pedir,
//  respeitando:
//   - fator de compra (pacote): a sugestão é sempre múltiplo do pacote;
//   - pedido mínimo por item (minPedido): quando precisa pedir, nunca vem abaixo;
//   - agrupamento por fornecedor preferencial;
//   - valor mínimo do pedido do fornecedor (aviso quando o total não atinge).
//  É a MESMA regra que a IA usa de base (a IA só refina/explica em cima disso).
// ════════════════════════════════════════════════════════════════════════════
import type { Contagem, Fornecedor, Insumo } from "../../core/types";

export type LinhaSugestao = {
  insumo: Insumo;
  contagem: number;          // qtd atual (última contagem; 0 se nunca contado)
  temContagem: boolean;      // false = insumo nunca foi contado
  minStock: number;          // estoque mínimo cadastrado
  fator: number;             // múltiplo do pacote (>=1)
  minPedido: number;         // pedido mínimo por item (0 = sem)
  precoUnit?: number;
  precisaPedido: boolean;    // contagem < minStock
  qtdSugerida: number;       // qtd a pedir já arredondada (0 se não precisa)
};

export type GrupoFornecedor = {
  fornecedorId: string | null;      // null = sem fornecedor preferencial
  fornecedor: Fornecedor | null;
  precisam: LinhaSugestao[];        // itens abaixo do mínimo (topo)
  ok: LinhaSugestao[];              // itens OK (linha opaca, adicionáveis)
  pedidoMinimoValor?: number;       // valor mínimo do pedido (do fornecedor)
};

// Arredonda a necessidade pra um pedido válido: múltiplo do pacote e >= pedido
// mínimo por item (que também respeita o pacote).
export function arredondarPedido(necessidade: number, fator: number, minPedido: number): number {
  if (necessidade <= 0) return 0;
  const f = fator > 0 ? fator : 1;
  let q = Math.ceil(necessidade / f) * f;             // múltiplo do pacote
  if (minPedido > 0 && q < minPedido) q = Math.ceil(minPedido / f) * f;  // respeita mínimo por item
  return q;
}

export function montarLinha(insumo: Insumo, ultimaContagem: Record<string, Contagem>): LinhaSugestao {
  const c = ultimaContagem[insumo.id];
  const contagem = c?.qty ?? 0;
  const temContagem = !!c;
  const minStock = insumo.minStock || 0;
  const fator = insumo.fatorCompra && insumo.fatorCompra > 0 ? insumo.fatorCompra : 1;
  const minPedido = insumo.minPedido && insumo.minPedido > 0 ? insumo.minPedido : 0;
  const precisaPedido = minStock > 0 && contagem < minStock;
  const necessidade = Math.max(0, minStock - contagem);
  return {
    insumo, contagem, temContagem, minStock, fator, minPedido,
    precoUnit: insumo.precoEstimado,
    precisaPedido,
    qtdSugerida: precisaPedido ? arredondarPedido(necessidade, fator, minPedido) : 0,
  };
}

// Agrupa por fornecedor preferencial. Inclui TODOS os insumos ativos (com ou sem
// falta) — os OK entram em `ok` pra aparecerem opacos/adicionáveis. Insumos sem
// fornecedor preferencial caem no grupo `fornecedorId: null`.
export function montarSugestao(
  insumos: Insumo[],
  ultimaContagem: Record<string, Contagem>,
  fornecedores: Fornecedor[],
): GrupoFornecedor[] {
  const fornById = new Map(fornecedores.map(f => [f.id, f]));
  const grupos = new Map<string, GrupoFornecedor>();
  const chaveDe = (fid: string | null) => fid ?? "__sem__";

  for (const insumo of insumos) {
    if (!insumo.ativo) continue;
    const fid = insumo.fornecedorPreferredId || null;
    const chave = chaveDe(fid);
    let g = grupos.get(chave);
    if (!g) {
      const forn = fid ? fornById.get(fid) ?? null : null;
      g = { fornecedorId: fid, fornecedor: forn, precisam: [], ok: [], pedidoMinimoValor: forn?.pedidoMinimoValor };
      grupos.set(chave, g);
    }
    const linha = montarLinha(insumo, ultimaContagem);
    (linha.precisaPedido ? g.precisam : g.ok).push(linha);
  }

  const ordNome = (a: LinhaSugestao, b: LinhaSugestao) => a.insumo.nome.localeCompare(b.insumo.nome, "pt-BR");
  const lista = [...grupos.values()].map(g => ({ ...g, precisam: g.precisam.sort(ordNome), ok: g.ok.sort(ordNome) }));
  // Grupos com faltas primeiro; "sem fornecedor" por último; depois por nome.
  return lista.sort((a, b) => {
    if (a.fornecedorId === null && b.fornecedorId !== null) return 1;
    if (b.fornecedorId === null && a.fornecedorId !== null) return -1;
    if ((b.precisam.length > 0 ? 1 : 0) !== (a.precisam.length > 0 ? 1 : 0)) return (b.precisam.length > 0 ? 1 : 0) - (a.precisam.length > 0 ? 1 : 0);
    return (a.fornecedor?.nome || "").localeCompare(b.fornecedor?.nome || "", "pt-BR");
  });
}

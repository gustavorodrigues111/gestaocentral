// Casa produtos das notas (Recebimentos) com os insumos e sugere preços na
// unidade base certa. Conversão: direta (kg/g/L/ml/un/dz) automática; embalagem
// (cx/fardo/pct) via fator do vínculo. Vínculo é por (descricaoNorm, fornecedor)
// — nova marca/fornecedor re-confirma o fator. Nunca troca preço sozinho.
import type { FtFicha, FtInsumo, FtVinculoRecebimento, RecebimentoNota } from "../../core/types";
import { converter } from "./unidades";
import { normalizarNome } from "./dedup";
import { calcularCusto } from "./custo";

// Normaliza a unidade da NF pras unidades conhecidas (senão devolve minúscula).
const MAP_UNIDADE: Record<string, string> = {
  kg: "kg", quilo: "kg", quilograma: "kg", k: "kg",
  g: "g", grama: "g", gr: "g", mg: "mg",
  l: "L", lt: "L", litro: "L", lts: "L",
  ml: "ml", mililitro: "ml",
  un: "un", und: "un", unid: "un", unidade: "un", pc: "un", pç: "un", pca: "un",
  dz: "dz", duzia: "dz",
};
export function normUnidadeNota(u?: string): string {
  const s = (u || "").trim().toLowerCase().replace(/\.$/, "");
  return MAP_UNIDADE[s] || s; // cx, fardo, pct, saco... ficam como estão
}

const fornKey = (f?: string | null) => normalizarNome(f || "") || "—";

export type PrecoNota = { descricao: string; descricaoNorm: string; unidade: string; valorUnitario: number; data: string; fornecedor: string; notaId: string; notaNumero: string };

// Achata todos os itens das notas em preços individuais (com descrição e valor).
export function coletarPrecos(recebimentos: RecebimentoNota[]): PrecoNota[] {
  const out: PrecoNota[] = [];
  for (const nota of recebimentos) {
    if (nota.excluidoEm) continue;
    const data = nota.dataEmissao || nota.recebidoEm || "";
    for (const it of nota.itens || []) {
      const desc = (it.descricao || "").trim();
      const v = it.valorUnitario || 0;
      if (!desc || v <= 0) continue;
      out.push({
        descricao: desc, descricaoNorm: normalizarNome(desc), unidade: normUnidadeNota(it.unidade),
        valorUnitario: v, data, fornecedor: nota.emissor || "", notaId: nota.id, notaNumero: nota.numeroNota || "",
      });
    }
  }
  return out;
}

export type ProdutoAgrupado = { chave: string; descricaoNorm: string; descricaoExemplo: string; unidade: string; fornecedor: string; precos: PrecoNota[]; ultimo: PrecoNota };

// Agrupa por (descrição normalizada + fornecedor). Preços ordenados do mais novo.
export function agruparProdutos(precos: PrecoNota[]): ProdutoAgrupado[] {
  const m = new Map<string, PrecoNota[]>();
  for (const p of precos) {
    const chave = `${p.descricaoNorm}::${fornKey(p.fornecedor)}`;
    if (!m.has(chave)) m.set(chave, []);
    m.get(chave)!.push(p);
  }
  const out: ProdutoAgrupado[] = [];
  for (const [chave, lista] of m) {
    lista.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
    const ultimo = lista[0];
    out.push({ chave, descricaoNorm: ultimo.descricaoNorm, descricaoExemplo: ultimo.descricao, unidade: ultimo.unidade, fornecedor: ultimo.fornecedor, precos: lista, ultimo });
  }
  return out.sort((a, b) => a.descricaoExemplo.localeCompare(b.descricaoExemplo));
}

// Fator automático (unidades-base por 1 unidade da NF) quando a dimensão bate;
// null = precisa informar o fator na mão (cx, fardo, dimensão diferente).
export function fatorAutomatico(unidadeNota: string, insumo: FtInsumo): number | null {
  return converter(1, unidadeNota, insumo.unidadeBase);
}

export const custoNaBase = (valorUnitario: number, fatorParaBase: number): number =>
  fatorParaBase > 0 ? Math.round((valorUnitario / fatorParaBase) * 100) / 100 : 0;

export type StatusReconc = "vinculado" | "sugerido" | "sem_insumo";
export type LinhaReconc = {
  produto: ProdutoAgrupado;
  status: StatusReconc;
  insumo: FtInsumo | null;
  vinculo: FtVinculoRecebimento | null;
  fatorParaBase: number | null;   // null = precisa informar
  fatorAuto: boolean;             // true = veio da conversão direta
  custoBase: number | null;       // R$/unidadeBase sugerido
  precoNovo: boolean;             // preço mais novo/diferente do atual do insumo
  fornecedorNovo: boolean;        // produto já vinculado, mas fornecedor novo → re-confirma
  motivo: string;                 // porquê da sugestão / observação
};

export type Reconciliacao = { vinculados: LinhaReconc[]; sugeridos: LinhaReconc[]; semInsumo: LinhaReconc[] };

// Casa cada produto agrupado com insumo/vínculo e classifica em buckets.
export function reconciliar(
  produtos: ProdutoAgrupado[], insumos: FtInsumo[], vinculos: FtVinculoRecebimento[],
): Reconciliacao {
  const insumoById = new Map(insumos.map(i => [i.id, i]));
  const insumosAtivos = insumos.filter(i => i.ativo !== false && !i.ehSubproduto);
  // vínculos por descricaoNorm (todas as marcas) e por chave exata (desc+forn).
  const vincPorChave = new Map<string, FtVinculoRecebimento>();
  const vincPorDesc = new Map<string, FtVinculoRecebimento[]>();
  for (const v of vinculos) {
    vincPorChave.set(`${v.descricaoNorm}::${fornKey(v.fornecedor)}`, v);
    if (!vincPorDesc.has(v.descricaoNorm)) vincPorDesc.set(v.descricaoNorm, []);
    vincPorDesc.get(v.descricaoNorm)!.push(v);
  }
  const res: Reconciliacao = { vinculados: [], sugeridos: [], semInsumo: [] };

  for (const prod of produtos) {
    const vExato = vincPorChave.get(prod.chave);
    if (vExato?.ignorar) continue; // marcado como "não é insumo"

    if (vExato && vExato.insumoId) {
      const insumo = insumoById.get(vExato.insumoId) || null;
      if (!insumo) continue;
      const fator = vExato.fatorParaBase;
      const custoBase = custoNaBase(prod.ultimo.valorUnitario, fator);
      const precoNovo = ehPrecoNovo(insumo, prod.ultimo.data, custoBase);
      res.vinculados.push({ produto: prod, status: "vinculado", insumo, vinculo: vExato, fatorParaBase: fator, fatorAuto: false, custoBase, precoNovo, fornecedorNovo: false, motivo: "" });
      continue;
    }

    // Produto já conhecido em OUTRO fornecedor → sugere o mesmo insumo, re-confirma fator.
    const outros = (vincPorDesc.get(prod.descricaoNorm) || []).filter(v => v.insumoId);
    if (outros.length > 0) {
      const insumo = insumoById.get(outros[0].insumoId!) || null;
      const fatorAuto = insumo ? fatorAutomatico(prod.unidade, insumo) : null;
      res.sugeridos.push({ produto: prod, status: "sugerido", insumo, vinculo: null, fatorParaBase: fatorAuto, fatorAuto: fatorAuto != null, custoBase: insumo && fatorAuto ? custoNaBase(prod.ultimo.valorUnitario, fatorAuto) : null, precoNovo: false, fornecedorNovo: true, motivo: `Novo fornecedor (${prod.fornecedor || "?"}) — confirme o fator` });
      continue;
    }

    // Match difuso pelo nome.
    const cand = melhorInsumo(prod.descricaoExemplo, insumosAtivos);
    if (cand) {
      const fatorAuto = fatorAutomatico(prod.unidade, cand.insumo);
      res.sugeridos.push({ produto: prod, status: "sugerido", insumo: cand.insumo, vinculo: null, fatorParaBase: fatorAuto, fatorAuto: fatorAuto != null, custoBase: fatorAuto ? custoNaBase(prod.ultimo.valorUnitario, fatorAuto) : null, precoNovo: false, fornecedorNovo: false, motivo: cand.motivo });
    } else {
      res.semInsumo.push({ produto: prod, status: "sem_insumo", insumo: null, vinculo: null, fatorParaBase: null, fatorAuto: false, custoBase: null, precoNovo: false, fornecedorNovo: false, motivo: "Nenhum insumo parecido" });
    }
  }
  return res;
}

function ehPrecoNovo(insumo: FtInsumo, data: string, custoBase: number): boolean {
  const maisNovo = !insumo.custoAtualizadoEm || (data || "") > insumo.custoAtualizadoEm;
  const diferente = Math.abs((insumo.custo || 0) - custoBase) > 0.005;
  return maisNovo && diferente;
}

// Match difuso: nome igual normalizado ou contido. Reaproveita a ideia do dedup
// mas trabalha em cima da descrição livre da NF (que costuma ter marca/tamanho).
function melhorInsumo(descricao: string, insumos: FtInsumo[]): { insumo: FtInsumo; motivo: string } | null {
  const n = normalizarNome(descricao);
  if (!n) return null;
  // igual
  let hit = insumos.find(i => i.nomeNormalizado === n || (i.aliases || []).some(a => normalizarNome(a) === n));
  if (hit) return { insumo: hit, motivo: "nome igual" };
  // insumo contido na descrição (ex.: "ÓLEO DE SOJA 900ML LIZA" contém "ÓLEO DE SOJA")
  const contidos = insumos.filter(i => i.nomeNormalizado && n.includes(i.nomeNormalizado)).sort((a, b) => b.nomeNormalizado.length - a.nomeNormalizado.length);
  if (contidos[0]) return { insumo: contidos[0], motivo: "insumo contido na descrição" };
  // descrição contida no insumo
  hit = insumos.find(i => i.nomeNormalizado.includes(n) && n.length >= 4);
  if (hit) return { insumo: hit, motivo: "parecido" };
  return null;
}

// Impacto no CMV: fichas (diretas ou via subficha) que usam o insumo, com o
// custo antes/depois de aplicar o novo preço.
export type ImpactoFicha = { ficha: FtFicha; antes: number; depois: number };
export function impactoNoCmv(insumoId: string, novoCusto: number, insumos: FtInsumo[], fichas: FtFicha[]): ImpactoFicha[] {
  const usadoresDiretos = new Set<string>();
  for (const f of fichas) for (const ing of f.ingredientes || []) if (ing.tipo === "insumo" && ing.refId === insumoId) usadoresDiretos.add(f.id);
  // propaga por subfichas (quem usa uma ficha afetada também é afetado)
  const afetadas = new Set(usadoresDiretos);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const f of fichas) {
      if (afetadas.has(f.id)) continue;
      if ((f.ingredientes || []).some(ing => ing.tipo === "ficha" && afetadas.has(ing.refId))) { afetadas.add(f.id); mudou = true; }
    }
  }
  if (afetadas.size === 0) return [];
  const insumosDepois = insumos.map(i => i.id === insumoId ? { ...i, custo: novoCusto } : i);
  const out: ImpactoFicha[] = [];
  for (const f of fichas) {
    if (!afetadas.has(f.id)) continue;
    const antes = calcularCusto(f, insumos, fichas).porRendimento;
    const depois = calcularCusto(f, insumosDepois, fichas).porRendimento;
    if (Math.abs(antes - depois) > 0.005) out.push({ ficha: f, antes, depois });
  }
  return out.sort((a, b) => Math.abs(b.depois - b.antes) - Math.abs(a.depois - a.antes));
}

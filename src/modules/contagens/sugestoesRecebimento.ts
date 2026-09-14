// Sugestões de insumos a partir do histórico de Recebimento (notas fiscais).
// Cada nota tem `emissor` (fornecedor) + `itens[]` com {descricao, unidade,
// valorUnitario}. Agrupamos os itens por nome normalizado, contamos em quantas
// notas cada produto aparece (recorrência), rankeamos os fornecedores por
// frequência (o mais frequente = primário) e pré-preenchemos o que der.
import type { RecebimentoNota, Insumo, Fornecedor, UnidadeMedida } from "../../core/types";

// Normaliza texto pra agrupar/casar: maiúsculas, sem acento, espaços colapsados.
export function normalizar(s?: string | null): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}

// Mapeia a unidade (texto livre da nota) pra unidade padrão do insumo.
const UNIT_MAP: Record<string, UnidadeMedida> = {
  UN: "un", UND: "un", UNID: "un", UNIDADE: "un", PC: "un", PECA: "un",
  PCT: "pct", PACOTE: "pct", PACK: "pct",
  KG: "kg", KGS: "kg", QUILO: "kg", QUILOS: "kg",
  G: "g", GR: "g", GRAMA: "g", GRAMAS: "g",
  L: "L", LT: "L", LTR: "L", LITRO: "L", LITROS: "L",
  ML: "ml",
  CX: "cx", CAIXA: "cx",
  FD: "fardo", FARDO: "fardo",
  GF: "garrafa", GARRAFA: "garrafa",
  LATA: "lata", LATAS: "lata",
};
export function mapearUnidade(raw?: string | null): { unidade: UnidadeMedida; unidadeOutroLabel?: string } {
  const n = normalizar(raw);
  if (!n) return { unidade: "un" };
  const u = UNIT_MAP[n];
  if (u) return { unidade: u };
  return { unidade: "outro", unidadeOutroLabel: (raw || "").trim().slice(0, 20) };
}

export type FornecedorSugerido = { nome: string; count: number; fornecedorId?: string };

export type SugestaoInsumo = {
  chave: string;                 // nome normalizado (chave do grupo)
  nome: string;                  // nome de exibição (grafia mais comum)
  unidade: UnidadeMedida;
  unidadeOutroLabel?: string;
  precoEstimado?: number;        // valor unitário da nota mais recente
  ocorrencias: number;          // nº de notas distintas em que aparece
  ultimaData: string;            // recebidoEm da nota mais recente
  fornecedores: FornecedorSugerido[]; // ranqueados por frequência (desc)
  jaCadastrado: boolean;         // já existe insumo com esse nome normalizado
};

// modaMap: dado um mapa nome→contagem, devolve a chave mais frequente.
function maisFrequente<T extends string>(m: Map<T, number>): T | undefined {
  let melhor: T | undefined; let max = -1;
  for (const [k, v] of m) if (v > max) { max = v; melhor = k; }
  return melhor;
}

export function agruparSugestoes(
  notas: RecebimentoNota[],
  insumos: Insumo[],
  fornecedores: Fornecedor[],
): SugestaoInsumo[] {
  const cadastrados = new Set(insumos.map((i) => normalizar(i.nome)));
  const fornPorNome = new Map(fornecedores.map((f) => [normalizar(f.nome), f.id]));

  type Acc = {
    chave: string;
    nomes: Map<string, number>;      // grafia → contagem
    unidades: Map<string, number>;   // unidade crua → contagem
    notasVistas: Set<string>;        // ids de nota (recorrência = tamanho)
    fornecedores: Map<string, number>; // emissor normalizado → nº de notas
    fornecedorLabel: Map<string, string>; // emissor normalizado → grafia
    ultimaData: string;
    ultimoPreco?: number;
  };
  const grupos = new Map<string, Acc>();

  for (const nota of notas) {
    if (!nota.itens?.length) continue;
    const emissorNorm = normalizar(nota.emissor);
    for (const it of nota.itens) {
      const chave = normalizar(it.descricao);
      if (!chave) continue;
      let g = grupos.get(chave);
      if (!g) { g = { chave, nomes: new Map(), unidades: new Map(), notasVistas: new Set(), fornecedores: new Map(), fornecedorLabel: new Map(), ultimaData: "" }; grupos.set(chave, g); }
      const nomeRaw = (it.descricao || "").trim();
      g.nomes.set(nomeRaw, (g.nomes.get(nomeRaw) || 0) + 1);
      if (it.unidade) g.unidades.set(it.unidade, (g.unidades.get(it.unidade) || 0) + 1);
      g.notasVistas.add(nota.id);
      if (emissorNorm) {
        g.fornecedores.set(emissorNorm, (g.fornecedores.get(emissorNorm) || 0) + 1);
        if (!g.fornecedorLabel.has(emissorNorm)) g.fornecedorLabel.set(emissorNorm, (nota.emissor || "").trim());
      }
      // Preço/última data pela nota mais recente que tem esse item.
      if ((nota.recebidoEm || "") >= g.ultimaData) {
        g.ultimaData = nota.recebidoEm || g.ultimaData;
        if (typeof it.valorUnitario === "number" && it.valorUnitario > 0) g.ultimoPreco = it.valorUnitario;
      }
    }
  }

  const out: SugestaoInsumo[] = [];
  for (const g of grupos.values()) {
    const nome = maisFrequente(g.nomes) || g.chave;
    const un = mapearUnidade(maisFrequente(g.unidades));
    const fornecedores: FornecedorSugerido[] = [...g.fornecedores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([norm, count]) => ({ nome: g.fornecedorLabel.get(norm) || norm, count, fornecedorId: fornPorNome.get(norm) }));
    out.push({
      chave: g.chave,
      nome,
      unidade: un.unidade,
      unidadeOutroLabel: un.unidadeOutroLabel,
      precoEstimado: g.ultimoPreco,
      ocorrencias: g.notasVistas.size,
      ultimaData: g.ultimaData,
      fornecedores,
      jaCadastrado: cadastrados.has(g.chave),
    });
  }
  // Não cadastrados primeiro; depois por recorrência desc; depois nome.
  return out.sort((a, b) =>
    Number(a.jaCadastrado) - Number(b.jaCadastrado) ||
    b.ocorrencias - a.ocorrencias ||
    a.nome.localeCompare(b.nome),
  );
}

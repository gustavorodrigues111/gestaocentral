// ════════════════════════════════════════════════════════════════════════════
//  Importação CSV de Ferramentas e Credenciais.
//
//  Princípio: o CSV NÃO traz senha. Só metadado + link Bitwarden. A senha
//  permanece no cofre.
//
//  Formato (header obrigatório, ordem livre):
//    nome,emoji,necessidade,tags,categoria,metodoAcesso,bitwardenItemUrl,
//    bitwardenCollection,localFisico,instrucoesAcesso,responsavel
//
//  - tags: separadas por "|" (pipe) ou ";". Ex: "motoboy|entrega|chamar"
//  - categoria: delivery | fornecedores | operacao | financeiro | rh | infra | identidade | restrito
//  - metodoAcesso: login_proprio | senha_compartilhada | senha_oculta | fisico | restrito | delegado_sso | dormente
// ════════════════════════════════════════════════════════════════════════════

import type {
  FerramentaCategoria,
  FerramentaMetodoAcesso,
  Tool,
} from "../../core/types";

const CATEGORIAS_VALIDAS = new Set<FerramentaCategoria>([
  "delivery", "fornecedores", "operacao", "financeiro", "rh", "infra", "identidade", "restrito",
]);
const METODOS_VALIDOS = new Set<FerramentaMetodoAcesso>([
  "login_proprio", "senha_compartilhada", "senha_oculta", "fisico", "restrito", "delegado_sso", "dormente",
]);

export type LinhaImportada = {
  linha: number;                        // 1-based, includes header
  ok: boolean;
  erros: string[];
  dados?: Omit<Tool, "id" | "restaurantId" | "criadoEm" | "criadoPor" | "atualizadoEm" | "atualizadoPor" | "usuariosAutorizados" | "status">;
};

// Parser CSV simples — suporta aspas duplas e vírgulas dentro de aspas.
// Não suporta multiline em campos (mas o caso de uso é texto curto por
// célula, não precisa).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseToolsCsv(texto: string): LinhaImportada[] {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (linhas.length === 0) return [];
  const header = parseCsvLine(linhas[0]).map(h => h.trim().toLowerCase());
  const idx = (nome: string): number => header.indexOf(nome.toLowerCase());

  const colNome = idx("nome");
  const colEmoji = idx("emoji");
  const colNecessidade = idx("necessidade");
  const colTags = idx("tags");
  const colCategoria = idx("categoria");
  const colMetodo = idx("metodoacesso");
  const colBitwardenUrl = idx("bitwardenitemurl");
  const colBitwardenCol = idx("bitwardencollection");
  const colLocal = idx("localfisico");
  const colInstrucoes = idx("instrucoesacesso");
  const colResponsavel = idx("responsavel");

  const resultados: LinhaImportada[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const numLinha = i + 1; // 1-based + header
    const cells = parseCsvLine(linhas[i]);
    const pick = (col: number) => col >= 0 && col < cells.length ? cells[col].trim() : "";

    const nome = pick(colNome);
    const necessidade = pick(colNecessidade);
    const categoria = pick(colCategoria).toLowerCase();
    const metodoAcesso = pick(colMetodo).toLowerCase();
    const erros: string[] = [];

    if (!nome) erros.push("nome vazio");
    if (!necessidade) erros.push("necessidade vazia");
    if (!CATEGORIAS_VALIDAS.has(categoria as FerramentaCategoria)) {
      erros.push(`categoria inválida: "${categoria}"`);
    }
    if (!METODOS_VALIDOS.has(metodoAcesso as FerramentaMetodoAcesso)) {
      erros.push(`metodoAcesso inválido: "${metodoAcesso}"`);
    }

    if (erros.length > 0) {
      resultados.push({ linha: numLinha, ok: false, erros });
      continue;
    }

    const tagsRaw = pick(colTags);
    const tags = tagsRaw
      .split(/[|;]/)
      .map(s => s.trim())
      .filter(Boolean);

    resultados.push({
      linha: numLinha,
      ok: true,
      erros: [],
      dados: {
        nome,
        icone: pick(colEmoji) || "🔧",
        necessidade,
        tags,
        categoria: categoria as FerramentaCategoria,
        metodoAcesso: metodoAcesso as FerramentaMetodoAcesso,
        bitwardenItemUrl: pick(colBitwardenUrl) || null,
        bitwardenCollection: pick(colBitwardenCol) || null,
        localFisico: pick(colLocal) || null,
        instrucoesAcesso: pick(colInstrucoes) || null,
        responsavel: pick(colResponsavel) || null,
      },
    });
  }
  return resultados;
}

export function gerarTemplateCsv(): string {
  const linhas = [
    "nome,emoji,necessidade,tags,categoria,metodoAcesso,bitwardenItemUrl,bitwardenCollection,localFisico,instrucoesAcesso,responsavel",
    "iFood,📱,Receber e gerenciar pedidos de delivery,ifood|pedido|delivery,delivery,login_proprio,,,,\"Solicitar acesso no Portal do Parceiro ao responsável.\",",
    "Lalamove,🛵,Chamar motoboy para entrega avulsa,motoboy|entrega|chamar,delivery,senha_compartilhada,https://vault.bitwarden.com/#/vault?itemId=XXX,Operação,,,",
    "Caixa de Madeira,📦,Guardar valores e itens da casa,valores|dinheiro|cadeado,operacao,fisico,,,Cadeado · gaveta do caixa · combinação no Bitwarden,,",
    "SP Regula,🏛️,Licenças e alvarás da prefeitura,licenca|prefeitura|alvara,restrito,restrito,,,,Falar com o gerente.,",
  ];
  return linhas.join("\n");
}

// Áreas da Wiki de Processos. Cada área = 1 guia HTML (guia de funcionamento) +
// 1 agente de IA que responde dúvidas da equipe SÓ a partir do guia daquela área.
// O guia é conteúdo do banco (coleção `wikiGuias`, doc id = key da área); Pessoas
// tem uma semente bundlada em `guias/pessoas.html` que serve de default até ser
// sobrescrita pelo upload no app.
//
// Catálogo FIXO e universal ao grupo (escritório Quibebe atende as operações). Pra
// adicionar uma área nova, inclua aqui — é o único ponto de verdade.

import pessoasGuiaSeed from "../../modules/wikiProcessos/guias/pessoas.html?raw";

export type WikiAreaKey = "pessoas" | "financeiro" | "compras" | "eventos";

export type WikiAreaMeta = {
  key: WikiAreaKey;
  nome: string;
  emoji: string;
  cor: string;        // cor de acento do card
  desc: string;       // subtítulo curto do card
};

export const WIKI_AREAS: WikiAreaMeta[] = [
  { key: "pessoas",    nome: "Pessoas",    emoji: "👥", cor: "#4F46E5", desc: "DP, RH e ciclo de vida do empregado" },
  { key: "financeiro", nome: "Financeiro", emoji: "💰", cor: "#10B981", desc: "Contas, fechamento e pagamentos" },
  { key: "compras",    nome: "Compras",    emoji: "📦", cor: "#F97316", desc: "Abastecimento, fornecedores e estoque" },
  { key: "eventos",    nome: "Eventos",    emoji: "🎉", cor: "#EC4899", desc: "Captação, propostas e execução de eventos" },
];

export const areaMeta = (k?: string): WikiAreaMeta | undefined => WIKI_AREAS.find(a => a.key === k);

// Sementes bundladas (default até o banco ter um override). Só Pessoas por ora.
export const GUIA_SEED: Partial<Record<WikiAreaKey, string>> = {
  pessoas: pessoasGuiaSeed,
};

// Documento em Firestore: wikiGuias/{key}
export type WikiGuia = {
  key: WikiAreaKey;
  html?: string;
  resumo?: string;
  atualizadoEm?: string;
  atualizadoPor?: string;
  atualizadoPorNome?: string;
};

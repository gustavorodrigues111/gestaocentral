// Sub-destinos (abas/funcionalidades) por módulo, pra uma rotina apontar direto
// pra uma tela específica. `query` é a querystring que a página-alvo entende
// (ex: analise-ponto lê ?tab=..., escala lê ?aba=...). Só listamos módulos
// cujas páginas realmente honram o parâmetro — os demais caem na tela raiz.
import type { ModuleId } from "../../core/types";

export type SubDestino = { id: string; label: string; query: string };

export const MODULO_SUBDESTINOS: Partial<Record<ModuleId, SubDestino[]>> = {
  "analise-ponto": [
    { id: "fechamento", label: "Fechamento de ponto", query: "tab=fechamento" },
    { id: "inconsist",  label: "Inconsistências",      query: "tab=inconsist" },
    { id: "escalas",    label: "Escalas (comparação)", query: "tab=escalas" },
  ],
  escala: [
    { id: "ajustes", label: "Ajustes solicitados", query: "aba=ajustes" },
  ],
};

export function subDestinosDe(moduloAlvo?: ModuleId): SubDestino[] {
  if (!moduloAlvo) return [];
  return MODULO_SUBDESTINOS[moduloAlvo] || [];
}

export function subDestinoLabel(moduloAlvo?: ModuleId, subAlvo?: string): string | null {
  if (!moduloAlvo || !subAlvo) return null;
  return subDestinosDe(moduloAlvo).find(s => s.id === subAlvo)?.label || null;
}

// Deep-link final da rotina (rota do módulo + querystring do sub-destino).
export function deepLinkRotina(rid: string, moduloAlvo?: ModuleId, subAlvo?: string): string | undefined {
  if (!moduloAlvo) return undefined;
  const base = `/r/${rid}/${moduloAlvo}`;
  const sub = subDestinosDe(moduloAlvo).find(s => s.id === subAlvo);
  return sub ? `${base}?${sub.query}` : base;
}

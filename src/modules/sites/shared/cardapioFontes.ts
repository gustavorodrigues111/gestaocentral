// Opções de fonte pro designer do cardápio: as curadas do site (FONTES_SITE) +
// quaisquer famílias do Google Fonts que o usuário adicionar.
import { FONTES_SITE } from "../templates/fontesDisponiveis";

export type FonteOpcao = { id: string; nome: string; cssFamily: string; googleFamily: string; pesos: string };

const curadas = (): FonteOpcao[] =>
  FONTES_SITE.map((f) => ({ id: f.id, nome: f.nome, cssFamily: f.cssFamily, googleFamily: f.googleFamily, pesos: f.pesos }));

// Família avulsa do Google (ex: "Bebas Neue") → opção.
export function fonteCustom(family: string): FonteOpcao {
  const nome = family.trim();
  return { id: nome, nome, cssFamily: `'${nome}', sans-serif`, googleFamily: nome.replace(/\s+/g, "+"), pesos: "wght@400;600;700" };
}

export function opcoesFonte(custom: string[] = []): FonteOpcao[] {
  const cur = curadas();
  const ids = new Set(cur.map((c) => c.id));
  return [...cur, ...custom.filter((f) => f && !ids.has(f)).map(fonteCustom)];
}

export function resolverFonte(id: string | undefined, custom: string[] = []): FonteOpcao {
  if (!id) return opcoesFonte(custom)[0]!;
  return opcoesFonte(custom).find((o) => o.id === id) || fonteCustom(id);
}

// URL css2 do Google Fonts pra carregar todas as opções passadas.
export function urlCss2(opcoes: FonteOpcao[]): string | null {
  const fams = [...new Set(opcoes.map((o) => `${o.googleFamily}:${o.pesos}`))];
  if (!fams.length) return null;
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join("&")}&display=swap`;
}

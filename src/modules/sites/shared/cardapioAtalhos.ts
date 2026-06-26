// Atalhos de URL do cardápio no site público (ex: lobozo.com.br/cardapio → PDF
// português, lobozo.com.br/menu → PDF inglês). Editável por restaurante na aba
// Cardápios; resolvido em runtime pelo CardapioRedirect.
import type { SiteConfig } from "../../../core/types";

export type CardapioAtalho = { path: string; idioma: "pt" | "en" };

// Convenção padrão (quando o restaurante não personaliza).
export const ATALHO_PADRAO_PT = "cardapio";
export const ATALHO_PADRAO_EN = "menu";
export const ATALHOS_CARDAPIO_PADRAO: CardapioAtalho[] = [
  { path: ATALHO_PADRAO_PT, idioma: "pt" },
  { path: ATALHO_PADRAO_EN, idioma: "en" },
];

export const normalizaAtalho = (s: string): string =>
  (s || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "");

export function atalhosEfetivos(cfg: Pick<SiteConfig, "cardapioAtalhos">): CardapioAtalho[] {
  return cfg.cardapioAtalhos && cfg.cardapioAtalhos.length ? cfg.cardapioAtalhos : ATALHOS_CARDAPIO_PADRAO;
}

// Dado um sub-path (ex: "menu"), retorna o idioma do cardápio ou null.
export function idiomaDoAtalho(cfg: Pick<SiteConfig, "cardapioAtalhos">, sub: string): "pt" | "en" | null {
  const n = normalizaAtalho(sub);
  if (!n) return null;
  const m = atalhosEfetivos(cfg).find((a) => normalizaAtalho(a.path) === n);
  return m ? m.idioma : null;
}

export function urlCardapioPorIdioma(
  cfg: Pick<SiteConfig, "cardapioPdfPtUrl" | "cardapioPdfEnUrl">,
  idioma: "pt" | "en",
): string | undefined {
  return idioma === "en" ? cfg.cardapioPdfEnUrl : cfg.cardapioPdfPtUrl;
}

// Monta a lista pra salvar a partir das 2 palavras editáveis (com fallback padrão).
export function montarAtalhos(slugPt: string, slugEn: string): CardapioAtalho[] {
  return [
    { path: normalizaAtalho(slugPt) || ATALHO_PADRAO_PT, idioma: "pt" },
    { path: normalizaAtalho(slugEn) || ATALHO_PADRAO_EN, idioma: "en" },
  ];
}

export function slugAtalho(cfg: Pick<SiteConfig, "cardapioAtalhos">, idioma: "pt" | "en"): string {
  const m = atalhosEfetivos(cfg).find((a) => a.idioma === idioma);
  return m ? m.path : (idioma === "pt" ? ATALHO_PADRAO_PT : ATALHO_PADRAO_EN);
}

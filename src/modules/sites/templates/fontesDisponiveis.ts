// Catálogo de fontes Google disponíveis pros sites.
// Curado pra restaurantes — uma seleção que cobre desde elegante/serifa
// até moderna/sans + algumas opções com personalidade (display/script).
//
// Cada fonte:
//   id            — chave única, usada no siteConfig.tema.fonte*
//   nome          — label legível
//   googleFamily  — nome exato do Google Fonts (sem aspas, sem ;display=swap)
//   pesos         — pesos a carregar (separados por ;)
//   cssFamily     — string pronta pra colar em CSS font-family
//   categoria     — pra organizar UI
//   exemplo       — texto de preview (default "Bom apetite")

export type FonteSite = {
  id: string;
  nome: string;
  googleFamily: string;
  pesos: string;
  cssFamily: string;
  categoria: "serif_elegante" | "sans_moderna" | "display" | "script";
};

export const FONTES_SITE: FonteSite[] = [
  // ─── SERIFS ELEGANTES (boas pra título/subtítulo) ───────────────────
  {
    id: "dm-serif-display",
    nome: "DM Serif Display",
    googleFamily: "DM+Serif+Display",
    pesos: "ital@0;1",
    cssFamily: "'DM Serif Display', Georgia, serif",
    categoria: "serif_elegante",
  },
  {
    id: "playfair-display",
    nome: "Playfair Display",
    googleFamily: "Playfair+Display",
    pesos: "wght@400;500;700;800",
    cssFamily: "'Playfair Display', Georgia, serif",
    categoria: "serif_elegante",
  },
  {
    id: "cormorant-garamond",
    nome: "Cormorant Garamond",
    googleFamily: "Cormorant+Garamond",
    pesos: "wght@400;500;600;700",
    cssFamily: "'Cormorant Garamond', Garamond, serif",
    categoria: "serif_elegante",
  },
  {
    id: "lora",
    nome: "Lora",
    googleFamily: "Lora",
    pesos: "wght@400;500;600;700",
    cssFamily: "'Lora', Georgia, serif",
    categoria: "serif_elegante",
  },
  {
    id: "libre-baskerville",
    nome: "Libre Baskerville",
    googleFamily: "Libre+Baskerville",
    pesos: "wght@400;700",
    cssFamily: "'Libre Baskerville', Georgia, serif",
    categoria: "serif_elegante",
  },
  {
    id: "eb-garamond",
    nome: "EB Garamond",
    googleFamily: "EB+Garamond",
    pesos: "wght@400;500;600",
    cssFamily: "'EB Garamond', Garamond, serif",
    categoria: "serif_elegante",
  },

  // ─── SANS MODERNAS (boas pra corpo / subtítulo limpo) ───────────────
  {
    id: "inter",
    nome: "Inter",
    googleFamily: "Inter",
    pesos: "wght@400;500;600;700",
    cssFamily: "'Inter', system-ui, sans-serif",
    categoria: "sans_moderna",
  },
  {
    id: "dm-sans",
    nome: "DM Sans",
    googleFamily: "DM+Sans",
    pesos: "wght@400;500;700",
    cssFamily: "'DM Sans', system-ui, sans-serif",
    categoria: "sans_moderna",
  },
  {
    id: "manrope",
    nome: "Manrope",
    googleFamily: "Manrope",
    pesos: "wght@400;500;600;700",
    cssFamily: "'Manrope', system-ui, sans-serif",
    categoria: "sans_moderna",
  },
  {
    id: "work-sans",
    nome: "Work Sans",
    googleFamily: "Work+Sans",
    pesos: "wght@400;500;600;700",
    cssFamily: "'Work Sans', system-ui, sans-serif",
    categoria: "sans_moderna",
  },
  {
    id: "karla",
    nome: "Karla",
    googleFamily: "Karla",
    pesos: "wght@400;500;700",
    cssFamily: "'Karla', system-ui, sans-serif",
    categoria: "sans_moderna",
  },
  {
    id: "poppins",
    nome: "Poppins",
    googleFamily: "Poppins",
    pesos: "wght@400;500;600;700",
    cssFamily: "'Poppins', system-ui, sans-serif",
    categoria: "sans_moderna",
  },

  // ─── DISPLAY (personalidade forte — usar só em título) ──────────────
  {
    id: "abril-fatface",
    nome: "Abril Fatface",
    googleFamily: "Abril+Fatface",
    pesos: "",
    cssFamily: "'Abril Fatface', serif",
    categoria: "display",
  },
  {
    id: "fraunces",
    nome: "Fraunces",
    googleFamily: "Fraunces",
    pesos: "ital,opsz,wght@0,9..144,400;0,9..144,700;1,9..144,400",
    cssFamily: "'Fraunces', Georgia, serif",
    categoria: "display",
  },
  {
    id: "old-standard-tt",
    nome: "Old Standard TT",
    googleFamily: "Old+Standard+TT",
    pesos: "ital,wght@0,400;0,700;1,400",
    cssFamily: "'Old Standard TT', Georgia, serif",
    categoria: "display",
  },

  // ─── SCRIPT (manuscrita — uso pontual, ex: assinatura) ──────────────
  {
    id: "caveat",
    nome: "Caveat",
    googleFamily: "Caveat",
    pesos: "wght@400;600;700",
    cssFamily: "'Caveat', cursive",
    categoria: "script",
  },
  {
    id: "sacramento",
    nome: "Sacramento",
    googleFamily: "Sacramento",
    pesos: "",
    cssFamily: "'Sacramento', cursive",
    categoria: "script",
  },
];

export const CATEGORIA_LABEL: Record<FonteSite["categoria"], string> = {
  serif_elegante: "Serif elegante",
  sans_moderna: "Sans-serif moderna",
  display: "Display (personalidade)",
  script: "Manuscrita / Script",
};

// Resolve uma cssFamily salva → encontra fonte do catálogo.
// Aceita tanto o id (preferido) quanto a cssFamily completa (retrocompat).
export function findFonte(idOuCssFamily: string | undefined): FonteSite | null {
  if (!idOuCssFamily) return null;
  return FONTES_SITE.find(f => f.id === idOuCssFamily)
      || FONTES_SITE.find(f => f.cssFamily === idOuCssFamily)
      || null;
}

// Constrói URL do Google Fonts pra carregar várias fontes de uma vez.
// Recebe ids únicos. display=swap evita FOIT (texto invisível durante carga).
export function googleFontsUrl(ids: string[]): string | null {
  const ids_unicos = Array.from(new Set(ids.filter(Boolean)));
  const familias = ids_unicos
    .map(id => FONTES_SITE.find(f => f.id === id))
    .filter((f): f is FonteSite => f !== null)
    .map(f => f.pesos ? `family=${f.googleFamily}:${f.pesos}` : `family=${f.googleFamily}`);
  if (familias.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${familias.join("&")}&display=swap`;
}

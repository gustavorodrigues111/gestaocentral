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

// Lista embutida de famílias populares do Google Fonts (boas pra cardápio) —
// usada pela busca do modal de "adicionar fonte". Embutida pra não depender de
// API externa (que estava falhando). Dá pra digitar qualquer outra família também.
export const FONTES_GOOGLE_POPULARES: string[] = [
  // Serif / display elegantes
  "Playfair Display", "Cormorant Garamond", "Cormorant", "EB Garamond", "Libre Baskerville",
  "Lora", "Merriweather", "PT Serif", "Crimson Text", "Crimson Pro", "Spectral", "Bitter",
  "Source Serif 4", "Noto Serif", "Frank Ruhl Libre", "Cardo", "Vollkorn", "Domine",
  "DM Serif Display", "DM Serif Text", "Marcellus", "Marcellus SC", "Cinzel", "Cinzel Decorative",
  "Forum", "Italiana", "Gilda Display", "Prata", "Bodoni Moda", "Tenor Sans", "Sorts Mill Goudy",
  "Old Standard TT", "Petrona", "Fraunces", "Newsreader", "Rozha One", "Abril Fatface",
  "Yeseva One", "Cardo", "Unna", "Antic Didone", "Bellefair", "Halant",
  // Manuscritas / script
  "Great Vibes", "Dancing Script", "Sacramento", "Parisienne", "Allura", "Pinyon Script",
  "Tangerine", "Pacifico", "Satisfy", "Cookie", "Yellowtail", "Kaushan Script", "Marck Script",
  "Petit Formal Script", "Alex Brush", "Niconne", "Mr Dafoe", "Herr Von Muellerhoff",
  // Sans modernas
  "Inter", "Poppins", "Montserrat", "Raleway", "Lato", "Open Sans", "Roboto", "Work Sans",
  "Nunito", "Nunito Sans", "Mulish", "Manrope", "DM Sans", "Rubik", "Quicksand", "Comfortaa",
  "Josefin Sans", "Jost", "Outfit", "Sora", "Space Grotesk", "Karla", "Cabin", "Hind",
  "Barlow", "Barlow Condensed", "Oswald", "Bebas Neue", "Anton", "Archivo", "Archivo Narrow",
  "Archivo Black", "Saira", "Saira Condensed", "Fjalla One", "Khand", "Teko", "Staatliches",
  "Pathway Gothic One", "Yanone Kaffeesatz", "PT Sans", "PT Sans Narrow", "Titillium Web",
  "Catamaran", "Heebo", "Assistant", "Figtree", "Plus Jakarta Sans", "Albert Sans", "Onest",
  "Schibsted Grotesk", "Bricolage Grotesque", "Instrument Sans", "Hanken Grotesk",
  // Handmade / decorativas leves
  "Caveat", "Shadows Into Light", "Amatic SC", "Permanent Marker", "Patrick Hand",
  "Gloria Hallelujah", "Indie Flower", "Courgette", "Lobster", "Lobster Two", "Bungee",
  "Righteous", "Monoton", "Fredericka the Great", "Special Elite", "Limelight",
];

// URL css2 do Google Fonts pra carregar todas as opções passadas.
export function urlCss2(opcoes: FonteOpcao[]): string | null {
  const fams = [...new Set(opcoes.map((o) => `${o.googleFamily}:${o.pesos}`))];
  if (!fams.length) return null;
  return `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${f}`).join("&")}&display=swap`;
}

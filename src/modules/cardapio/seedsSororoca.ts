// Pré-preenchimento dos cardápios do Sororoca (parse dos PDFs Canva). Usado pra
// auto-carregar Bebidas/Vinhos na 1ª abertura do cardápio vazio. REVISAR — o
// parse de PDF (colunas) embaralha; vinhos especialmente (preços/taça-garrafa).
import type { SecaoCardapio, PratoCardapio } from "../../core/types";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const norm = (s: string) => (s || "").trim().toLowerCase().normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
// [titulo, subtitulo, preco]
type Linha = [string, string, string];
const sec = (nome: string, pratos: Linha[], obs?: string): SecaoCardapio => ({
  id: uid(), nome, ...(obs ? { obs } : {}),
  pratos: pratos.map(([titulo, sub, preco]): PratoCardapio => ({ id: uid(), titulo, ...(sub ? { subtitulo: sub } : {}), ...(preco ? { preco } : {}) })),
});

function seedBebidas(): SecaoCardapio[] {
  return [
    sec("Coquetéis", [
      ["daiquirez", "jerez · rum · siciliano", "49"],
      ["torquato", "tequila · limão · cajuína", "44"],
      ["olho de cão", "suco de tomate temperado · gin single fin · limão siciliano", "44"],
      ["minduim", "cachaça lobozó envelhecida · amendoim · limão siciliano", "39"],
      ["tucura", "cachaça remanso · limão cravo · cordial de limões", "39"],
      ["marujo", "rum envelhecido · vermute tinto · campari · coco", "49"],
      ["mar-tini", "gin single fin ocean · azeitona · noilly prat", "49"],
      ["pina descolada", "cachaça lobozó envelhecida · abacaxi · limão · coco", "42"],
      ["caipirinha de limão", "cachaça lobozó · 1, 2 ou 3 limões", "36"],
      ["caipirinha do dia", "cachaça lobozó · fruta do dia", "36"],
    ]),
    sec("Cervejas", [
      ["praya lager", "", "15"],
      ["praya clássica", "", "16"],
      ["lagunitas IPA", "", "22"],
      ["heineken long neck", "", "15"],
      ["heineken 0,0% álcool", "", "15"],
    ]),
    sec("Sem álcool", [
      ["soda de bacuri", "", "19"],
      ["soda de cambuci", "", "19"],
      ["suco do dia", "", "14"],
      ["mate gelado (puro, com limão ou seriguela)", "", "14"],
      ["água de coco", "", "19"],
      ["cajuína orgânica matury", "", "18"],
      ["baer mate", "", "14"],
      ["água tônica", "", ""],
      ["água com ou sem gás mamba", "", ""],
      ["café espresso tocaya", "", "9"],
    ]),
  ];
}

// Vinhos: preço único = garrafa; "40 · taça 120ml" quando há venda por taça.
function seedVinhos(): SecaoCardapio[] {
  return [
    sec("Sake", [
      ["Niida Shizenshu Kan — Atsurae Kimoto Junmai", "fukushima, japão · sake orgânico, textura untuosa e ótimo frescor. uma bomba de umami", "360"],
      ["Hakushika Josen Kuromatsu", "hyogo, japão · equilíbrio dos 5 sabores, leve e refrescante, corpo balanceado", "120"],
      ["Hakushika Namachozo 300ml", "hyogo, japão · aroma suave e toque frutado; só uma pasteurização — mais vivo e fresco", "120"],
    ]),
    sec("Tinto", [
      ["Josep Foraster, Les Gallinetes", "tinto · trepat, garnacha, syrah · conca de barberá, espanha · frutado e fresco, notas de frutas vermelhas", "215 · taça 40 (120ml)"],
    ]),
    sec("Fortificado", [
      ["La Guita Manzanilla", "branco fortificado · palomino · sanlúcar de barrameda, espanha · ótimo aperitivo, peça uma taça enquanto escolhe", "290 · taça 38 (70ml)"],
    ]),
    sec("Espumante", [
      ["Matías Riccitelli, Kung Fu Pét-Nat Rosé", "espumante rosé · malbec e pinot noir · mendoza, argentina · frutado e envolvente, frutas vermelhas maduras, textura macia", "360"],
      ["Gérard Bertrand Papilou, Pét-Nat Rosé", "espumante rosé · cinsault e pinot noir · languedoc, frança · vibrante e elegante, frutas vermelhas frescas, leve toque floral", "390"],
    ]),
    sec("Branco", [
      ["Busy Bee", "branco · roussanne, chenin blanc · swartland, áfrica do sul · fresco e frutado, mel, frutas maduras, toque de capim-limão", "215"],
      ["Josep Foraster, Els Nanos Blanc del Coster", "branco · macabeu · conca de barberá, espanha · vibrante e cítrico: limão, toranja, maçã verde, pêra, pimenta branca", ""],
      ["Rui Roboredo Madeira, Castelo D'Alba", "branco · rabigato, gouveio, viosinho · douro, portugal · fresco e frutado, cítrico de abacaxi e limão-siciliano, final mineral", "185"],
      ["Arniston Bay", "branco · sauvignon blanc · stellenbosch, áfrica do sul · vinhas beneficiadas pelo oceano atlântico", "200 · taça 38 (120ml)"],
      ["Henri Kieffer & Fils", "branco · riesling · alsácia, frança · fresco e linear, buquê de requinte, notas frutadas, minerais e florais, limão e toranja", "230"],
      ["Calcarius, Chablis", "branco · chardonnay · borgonha, frança · chablis fresco e mineral, cítricas e maçã verde, final salino", "390"],
      ["Andi Weigand, White", "branco · silvaner, müller-thurgau, baco, scheurebe · francônia, alemanha · aromático: toranja, maçã, ervas frescas, acidez elétrica", "330"],
      ["Heiderer Mayer", "branco · grüner veltliner · baumgarten am wagram, áustria · acidez crispante, corpo médio, textura cremosa, final longo e salino", "230 · taça 40 (120ml)"],
      ["Boas Quintas, Morgado de Bucelas", "branco · arinto · bucelas, portugal · muito fresco, fácil de beber, pede peixes e frutos do mar", "185 · taça 36 (120ml)"],
    ]),
    sec("Laranja", [
      ["(laranja — conferir produtor)", "laranja · pedro gimenez · mendoza, argentina · notas cítricas e de casca", ""],
    ]),
  ];
}

// Lookup por nome do cardápio (Sororoca).
export function seedSororocaPorNome(nome: string): SecaoCardapio[] | null {
  const n = norm(nome);
  if (n.includes("bebida")) return seedBebidas();
  if (n.includes("vinho")) return seedVinhos();
  return null;
}

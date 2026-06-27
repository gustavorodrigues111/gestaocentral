// TEMPORÁRIO — input inicial dos cardápios do Puba. Usado por um botão de import
// no módulo Cardápio (só aparece pro Puba). Pode remover depois do primeiro uso.
import type { CardapioMenu } from "../../core/types";

type Sec = [string, [string, string, string][]];

const COMIDAS: Sec[] = [
  ["Tapas", [
    ["Pão de Maniva e Manteiga de Cupuaçu", "produzido pela @nautapadariaartesanal para nós", "26"],
    ["Beijus Cica Assados", "com manteiga de cupuaçu", "26"],
    ["Babaganoush de Berinjela com Pasta de Amendoim", "hortelã, dill e beijus com zaatar · troque beijus por pão de maniva +$ 11", "42"],
    ["Ceviche Thai-Paraense de Atum", "atum cru, molho à base de tucupi, namplá, chuchu, castanha do pará, gengibre e limão", "72"],
    ["Tostada de Lula com Chouriço Marajoara", "no pão de maniva da Nauta Padaria", "60"],
    ["Copa Lombo Defumada com Tucupi Preto", "+ picles de maxixe e mostarda fermentada com tucupi", "44"],
    ["Guioza de Porco no Vapor", "servido no tucupi temperado, chilly oil e gergelim", "64"],
    ["Tacos de Mandioca com Brisket", "dupla de tacos recheada de peito de boi assado lentamente + coalhada, picles de cebola e coentro", "46"],
    ["Bao de Barriga de Porco", "com teriyaki de tucupi preto, picles de pepino e maionese de gochujang", "56"],
  ]],
  ["Pratos", [
    ["Polvo com Bolo de Macaxeira", "polvo grelhado, bolo de macaxeira salgado com queijo curado, aioli e páprica defumada", "129"],
    ["Bobó Curry de Caranguejo", "com leite de coco, amendoim, coentro e gohan", "99"],
    ["Arroz de Cupim de Forno", "com linguiça Marajoara, tucupi e agrião", "99"],
  ]],
  ["Sobremesas", [
    ["Bolo de Macaxeira & Bacuri", "com chocolate branco, bacuri fresco e tapioca caramelizada", "38"],
    ["Mousse de Chocolate com Cachaça Lobozó", "gel de taperebá, paçoca de amendoim com farinha", "38"],
  ]],
];

const BEBIDAS: Sec[] = [
  ["Drinks Clássicos", [
    ["Caipirinha de Limão Mexerica", "", "42"],
    ["Negroni", "gin | vermute | campari | laranja", "42"],
    ["Rabo de Galo", "cachaça | vermute tinto | limão", "40"],
    ["Vermutônica", "vermute | água tônica | laranja", "38"],
    ["Aperol Spritz", "aperol | espumante | laranja", "40"],
    ["Dry Martini", "gin | vermouth | azeitona siciliana", "42"],
    ["Bee's Knees", "gin | xarope de mel | limão", "42"],
  ]],
  ["Drinks Autorais", [
    ["Jambunaíma", "cachaça de jambu | fernet | limão", "42"],
    ["Cupuaçu Spritz", "shrub de cupuaçu | aperol | vermute | espumante", "46"],
    ["Tiquira Smash", "tiquira | vermute dry | hortelã", "46"],
    ["Jacá Highball", "gin | taperebá | água tônica | gengibre · opção sem álcool $ 39", "46"],
    ["Daiquiri de Limão Mexerica", "rum | xarope de limão mexerica", "46"],
  ]],
  ["Cervejas", [
    ["Heineken 330ml", "", "15"],
    ["Heineken Zero 350ml", "", "14"],
  ]],
  ["Não Alcoólicos", [
    ["Água com ou sem Gás", "", "9"],
    ["Água Tônica", "", "9"],
    ["Suco de Cupuaçu ou Taperebá", "", "12"],
  ]],
  ["Após a Refeição", [
    ["Café Espresso", "", "10"],
    ["Licor Bergamoncello", "", "32"],
  ]],
];

const VINHOS: Sec[] = [
  ["Vinhos Brancos", [
    ["Heiderer-Mayer", "uva: grüner veltliner / Wagram, Áustria. Seco, direto e refrescante — maçã verde, pera e ervas frescas.", "210"],
    ["Klet Brda, Avia", "uva: pinot grigio / Goriška Brda, Eslovênia. Leve, com notas cítricas, de abacaxi e pêssego.", "185"],
    ["Puba Riesling", "uva: riesling itálico / Serra Gaúcha, Brasil. Edição especial com a Don Guerino — cítrico, floral, leve e mineral.", "149"],
    ["Torrederos, 2022", "uva: verdejo / Rueda, Espanha. Refrescante, floral e frutado, com erva-doce e anis.", "190"],
    ["Beyra Branco", "uva: síria, fonte cal, roupeiro / Beira Interior, Portugal. Frutas brancas, cítrico e leve toque mineral.", "215"],
    ["Leth, Duett", "uva: riesling, grüner veltliner / Wagram, Áustria. Floral, pera e maçã verde — fresco e vibrante.", "280"],
    ["Krya Branco", "uva: pecorino / Abruzzo, Itália. Frutas brancas maduras, pera e toque cítrico, com boa acidez.", "220"],
    ["Alento Branco", "uva: arinto, antão vaz, roupeiro / Alentejo, Portugal. Cítrico, mineral e equilibrado.", "200"],
  ]],
  ["Vinho Rosé", [
    ["Vamos de Parranda Rosé", "uva: criolla / Mendoza, Argentina. Frutas vermelhas frescas e toque floral — leve e seco.", "230"],
  ]],
  ["Vinhos Tintos", [
    ["Il Mantile Rosso Toscana", "uva: sangiovese, canaiolo, ciliegiolo / Toscana, Itália. Frutas vermelhas maduras, ervas e leve toque especiado.", "248"],
    ["Y Tu de Quién Eres", "uva: bobal e autóctones / Castilla-La Mancha, Espanha. Frutas vermelhas, notas florais e toque terroso.", "242"],
    ["Beyra Tinto", "uva: tinta roriz, jaen, touriga nacional / Beira Interior, Portugal. Frutado e mineral, com frutos silvestres.", "200"],
    ["Els Nanos Tinto", "uva: tempranillo, trepat, cabernet / Conca de Barberá, Espanha. Jovem, fresco e frutado.", "235"],
    ["Alento Tinto", "uva: aragonez, trincadeira, touriga nacional / Alentejo, Portugal. Frutos vermelhos, equilibrado e fresco.", "200"],
  ]],
  ["Espumantes", [
    ["Puba Brut Rosé", "uva: malbec / Serra Gaúcha, Brasil. Edição especial com a Don Guerino — frutas vermelhas, cremoso e seco, borbulhas finas.", "149"],
    ["Nero Brutt", "corte de uvas brancas / Brasil. Frutas frescas e flores — leve, cremoso e refrescante.", "180"],
  ]],
];

function montar(menuId: string, nome: string, secoesRaw: Sec[]): CardapioMenu {
  return {
    id: menuId,
    nome,
    temCapa: true,
    tituloCapa: nome.toUpperCase(),
    secoes: secoesRaw.map(([secNome, pratos], si) => ({
      id: `${menuId}_s${si}`,
      nome: secNome,
      pratos: pratos.map(([titulo, subtitulo, preco], pi) => ({
        id: `${menuId}_s${si}_p${pi}`,
        titulo,
        ...(subtitulo ? { subtitulo } : {}),
        ...(preco ? { preco } : {}),
      })),
    })),
  };
}

export function buildCardapiosPuba(): CardapioMenu[] {
  return [
    montar("puba_comidas", "Comidas", COMIDAS),
    montar("puba_bebidas", "Bebidas", BEBIDAS),
    montar("puba_vinhos", "Vinhos", VINHOS),
  ];
}

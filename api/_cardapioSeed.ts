// Cardápio atual do Puba Cidade Velha — seed default do estado da skill de cardápio.
// Usado quando cardapioEstado/puba ainda não existe no Firestore. Preço = string
// ("R$ 99") OU objeto {qual, val} p/ preço com qualificador (ex.: "(dupla)"/"R$ 32").
// Objeto em vez de array-de-array porque o Firestore não aceita array aninhado.
export type CardapioPreco = string | { qual: string; val: string };
export type CardapioItem = { nome: string; descricao: string; precos: CardapioPreco[]; descW?: number };
export type CardapioSecao = { secao: string; itens: CardapioItem[] };
export type CardapioEstado = { comidas: CardapioSecao[]; bebidas: CardapioSecao[]; vendinha: CardapioSecao[]; especiais?: CardapioSecao[]; vinhos?: CardapioSecao[] };

export const CARDAPIO_SEED: CardapioEstado = {
  "comidas": [
    {
      "secao": "FRIOS",
      "itens": [
        {
          "nome": "CEVICHE THAI-PARAENSE DE ATUM",
          "descricao": "atum cru, molho a base de tucupi, namplá, chuchu, castanha do pará, gengibre e limão",
          "precos": [
            "R$ 72"
          ]
        },
        {
          "nome": "OSTRAS DA AMAZÔNIA ATLÂNTICA",
          "descricao": "com tucupi, namplá, gengibre, cebola roxa e coentro",
          "precos": [
            {
              "qual": "(dupla)",
              "val": "R$ 32"
            },
            {
              "qual": "(½ dz)",
              "val": "R$ 86"
            }
          ],
          "descW": 148
        }
      ]
    },
    {
      "secao": "QUENTES",
      "itens": [
        {
          "nome": "BEIJUS CICA ASSADOS",
          "descricao": "com manteiga de cupuaçu",
          "precos": [
            "R$ 26"
          ]
        },
        {
          "nome": "PÃO DE MANIVA E MANTEIGA DE CUPUAÇU",
          "descricao": "produzido pela @nautapadariaartesanal para nós",
          "precos": [
            "R$ 26"
          ]
        },
        {
          "nome": "TOSTADA DE LULA COM CHOURIÇO MARAJOARA",
          "descricao": "no pão de maniva da Nauta Padaria",
          "precos": [
            "R$ 60"
          ]
        },
        {
          "nome": "SARNAMBI AO CURRY VERDE",
          "descricao": "e pão de maniva",
          "precos": [
            "R$ 62"
          ]
        },
        {
          "nome": "“PIPOCA” DE PORCO",
          "descricao": "com mostarda fermentada com tucupi",
          "precos": [
            "R$ 19"
          ]
        }
      ]
    },
    {
      "secao": "SANDUBAS",
      "itens": [
        {
          "nome": "SANDUBA DE PEIXE FRITO",
          "descricao": "brioche de macaxeira, picles de maxixe, sweetchilly, maionese e coentro",
          "precos": [
            "R$ 48"
          ]
        },
        {
          "nome": "BAO DE BARRIGA DE PORCO",
          "descricao": "com teriaky de tucupi preto, picles de pepino e maionese de gochujang",
          "precos": [
            "R$ 56"
          ]
        },
        {
          "nome": "LEITÃO NO BRIOCHE DE MACAXEIRA",
          "descricao": "brioche de macaxeira do Felipe Castanho",
          "precos": [
            "R$ 58"
          ]
        }
      ]
    },
    {
      "secao": "PRATOS",
      "itens": [
        {
          "nome": "ARROZ DE CUPIM DE FORNO",
          "descricao": "com linguiça Marajoara, tucupi e agrião",
          "precos": [
            "R$ 99"
          ]
        },
        {
          "nome": "BOBÓCURRY DE CARANGUEJO",
          "descricao": "com leite de coco, amendoim, coentro e gohan",
          "precos": [
            "R$ 99"
          ]
        }
      ]
    },
    {
      "secao": "SOBREMESAS",
      "itens": [
        {
          "nome": "PAVÊ DE CUPUAÇU COM MATCHÁ",
          "descricao": "com tapioca e flor de sal",
          "precos": [
            "R$ 38"
          ]
        },
        {
          "nome": "BOLO DE MACAXEIRA & BACURI",
          "descricao": "com chocolate branco, bacuri fresco e tapioca caramelizada",
          "precos": [
            "R$ 38"
          ]
        }
      ]
    }
  ],
  "bebidas": [
    {
      "secao": "DRINKS AUTORAIS",
      "itens": [
        {
          "nome": "JAMBUNAÍMA",
          "descricao": "cachaça de jambu | fernet | limão",
          "precos": [
            "R$ 42"
          ]
        },
        {
          "nome": "CUPUAÇU SPRITZ",
          "descricao": "schrub de cupuaçu | aperol | vermute | espumante",
          "precos": [
            "R$ 46"
          ]
        },
        {
          "nome": "TIQUIRA SMASH",
          "descricao": "tiquira | vermute dry | hortelã",
          "precos": [
            "R$ 46"
          ]
        },
        {
          "nome": "JACÁ HIGHBALL",
          "descricao": "gin | taperebá | água tônica | gengibre *opção sem álcool R$ 39*",
          "precos": [
            "R$ 46"
          ]
        },
        {
          "nome": "DAIQUIRI DE LIMÃO MEXERICA",
          "descricao": "rum | xarope de limão mexerica",
          "precos": [
            "R$ 46"
          ]
        }
      ]
    },
    {
      "secao": "DRINKS CLÁSSICOS",
      "itens": [
        {
          "nome": "CAIPIRINHA DE LIMÃO MEXERICA",
          "descricao": "",
          "precos": [
            "R$ 42"
          ]
        },
        {
          "nome": "NEGRONI",
          "descricao": "gin | vermute | campari | laranja",
          "precos": [
            "R$ 42"
          ]
        },
        {
          "nome": "RABO DE GALO",
          "descricao": "cachaça | vermute tinto | limão",
          "precos": [
            "R$ 40"
          ]
        },
        {
          "nome": "VERMUTÔNICA",
          "descricao": "vermute | água tônica | laranja",
          "precos": [
            "R$ 38"
          ]
        },
        {
          "nome": "APEROL SPRITZ",
          "descricao": "aperol | espumante | laranja",
          "precos": [
            "R$ 40"
          ]
        },
        {
          "nome": "DRY MARTINI",
          "descricao": "gin | vermouth | azeitona siciliana",
          "precos": [
            "R$ 42"
          ]
        },
        {
          "nome": "BEE'S KNEES",
          "descricao": "gin | xarope de mel | limão",
          "precos": [
            "R$ 42"
          ]
        }
      ]
    },
    {
      "secao": "CERVEJAS",
      "itens": [
        {
          "nome": "HEINEKEN 330ML",
          "descricao": "",
          "precos": [
            "R$ 15"
          ]
        },
        {
          "nome": "HEINEKEN ZERO 350ML",
          "descricao": "",
          "precos": [
            "R$ 14"
          ]
        }
      ]
    },
    {
      "secao": "NÃO ALCOÓLICOS",
      "itens": [
        {
          "nome": "ÁGUA COM OU SEM GÁS",
          "descricao": "",
          "precos": [
            "R$ 9"
          ]
        },
        {
          "nome": "ÁGUA TÔNICA",
          "descricao": "",
          "precos": [
            "R$ 9"
          ]
        },
        {
          "nome": "SUCO DE CUPUAÇU OU TAPEREBÁ",
          "descricao": "",
          "precos": [
            "R$ 12"
          ]
        }
      ]
    },
    {
      "secao": "APÓS A REFEIÇÃO",
      "itens": [
        {
          "nome": "CAFÉ ESPRESSO",
          "descricao": "",
          "precos": [
            "R$ 10"
          ]
        },
        {
          "nome": "LICOR BERGAMONCELLO",
          "descricao": "",
          "precos": [
            "R$ 32"
          ]
        }
      ]
    }
  ],
  "vendinha": [
    {
      "secao": "VENDINHA DA NAUTA",
      "itens": [
        {
          "nome": "BOLO DE MILHO COM COCO",
          "descricao": "",
          "precos": [
            "R$ 29"
          ]
        },
        {
          "nome": "BOLO DE MILHO COM GOIABADA",
          "descricao": "",
          "precos": [
            "R$ 29"
          ]
        },
        {
          "nome": "PÃO ITALIANO",
          "descricao": "",
          "precos": [
            "R$ 32"
          ]
        },
        {
          "nome": "PÃO RÚSTICO DE MANIVA",
          "descricao": "",
          "precos": [
            "R$ 36"
          ]
        },
        {
          "nome": "BRIOCHE COM MACAXEIRA",
          "descricao": "",
          "precos": [
            "R$ 32"
          ]
        }
      ]
    }
  ],
  "vinhos": [
    {
      "secao": "ESPUMANTES",
      "itens": [
        { "nome": "NERO BRUTT", "descricao": "uva: corte de uvas brancas | brasil\n\nAromas de frutas frescas e notas florais delicadas. Em boca é leve, refrescante e cremoso, com borbulhas finas e final agradável.", "precos": ["R$ 180"] },
        { "nome": "KUNG FU PÉT-NAT", "descricao": "uva: malbec e pinot noir | mendoza, argentina\n\nEspumante natural (pét-nat), leve e descontraído. Aromas de frutas vermelhas frescas e leve toque floral, com borbulhas delicadas e final seco.", "precos": ["R$ 280"] }
      ]
    },
    {
      "secao": "VINHOS BRANCOS",
      "itens": [
        { "nome": "BEYRA BRANCO", "descricao": "uva: síria, fonte cal, roupeiro | beira interior, portugal\n\nAromas de frutas brancas, notas cítricas e leve toque mineral. Em boca é fresco e equilibrado.", "precos": ["R$ 215"] },
        { "nome": "KRYA BRANCO", "descricao": "uva: pecorino | abruzzo, itália\n\nFrutas brancas maduras, pêra e leve toque cítrico, com caráter mineral. Em boca é fresco, com boa acidez.", "precos": ["R$ 220"] },
        { "nome": "ALENTO BRANCO", "descricao": "uva: arinto, antão vaz, roupeiro | alentejo, portugal\n\nCor citrina e aromas cítricos com notas minerais. Em boca é equilibrado, com boa acidez e final fresco.", "precos": ["R$ 200"] },
        { "nome": "HEIDERER-MAYER", "descricao": "uva: grüner veltliner | wagram, áustria\n\nCor amarelo-palha, aromas de maçã verde, pera e leve toque de ervas frescas. Em boca é seco, direto e refrescante, com final limpo.", "precos": ["R$ 230"] },
        { "nome": "AJNA CHARDONNAY", "descricao": "uva: chardonnay | san patricio del chañar, argentina\n\nChardonnay sem passagem por madeira, da Patagônia. Cor amarelo-palha brilhante, com aromas de pêra e maçã verde. Em boca é fresco, leve e saboroso, com boa acidez e final cítrico.", "precos": ["R$ 230"] },
        { "nome": "KLET BRDA, AVIA", "descricao": "uva: pinot grigio | goriška brda, eslovênia\n\nLeve, com notas cítricas, de abacaxi e pêssego.", "precos": ["R$ 185"] },
        { "nome": "OBALO BRANCO", "descricao": "uva: viura | rioja, espanha\n\nCor amarelo-palha esverdeado, aroma intenso, elegante e frutado. Em boca é saboroso e encorpado, com acidez equilibrada e leve toque de madeira. Final fresco e elegante.", "precos": ["R$ 220"] },
        { "nome": "PUBA RIESLING", "descricao": "uva: riesling | serra gaúcha, brasil\n\nEdição especial elaborada em parceria com a Don Guerino. Aromas cítricos e florais, com notas de frutas brancas. Em boca é fresco, com boa acidez e final vibrante.", "precos": ["R$ 175"] }
      ]
    },
    {
      "secao": "VINHO ROSÉ",
      "itens": [
        { "nome": "VAMOS DE PARRANDA ROSÉ", "descricao": "uva: criolla | mendoza, argentina\n\nCor rosada delicada, com aromas de frutas vermelhas frescas e leve toque floral. Leve, refrescante e descontraído, com final seco e muito agradável.", "precos": ["R$ 230"] }
      ]
    },
    {
      "secao": "VINHOS TINTOS",
      "itens": [
        { "nome": "BEYRA TINTO", "descricao": "uva: tinta roriz, jaen, touriga nacional | beira interior, portugal\n\nFrutado e mineral, com frutos silvestres e especiarias. Fresco, com boa fruta e final persistente.", "precos": ["R$ 200"] },
        { "nome": "ELS NANOS TINTO", "descricao": "uva: tempranillo, trepat, cabernet | conca de barberá, espanha\n\nTinto jovem, fresco e frutado, fácil de beber, com frutos do bosque e leve toque floral.", "precos": ["R$ 235"] },
        { "nome": "ALENTO TINTO", "descricao": "uva: aragonez, trincadeira, touriga nacional | alentejo, portugal\n\nCor granada e aroma intenso de frutos vermelhos. Equilibrado, com boa frescura.", "precos": ["R$ 200"] },
        { "nome": "KRYA TINTO", "descricao": "uva: montepulciano | abruzzo, itália\n\nTinto macio e frutado, com notas de frutas vermelhas maduras e leve toque de especiarias. Equilibrado e fácil de beber.", "precos": ["R$ 230"] }
      ]
    }
  ]
};

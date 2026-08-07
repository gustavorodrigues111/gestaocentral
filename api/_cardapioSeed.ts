// Cardápio atual do Puba Cidade Velha — seed default do estado da skill de cardápio.
// Usado quando cardapioEstado/puba ainda não existe no Firestore. Preço = string
// ("R$ 99") OU objeto {qual, val} p/ preço com qualificador (ex.: "(dupla)"/"R$ 32").
// Objeto em vez de array-de-array porque o Firestore não aceita array aninhado.
export type CardapioPreco = string | { qual: string; val: string };
export type CardapioItem = { nome: string; descricao: string; precos: CardapioPreco[]; descW?: number };
export type CardapioSecao = { secao: string; itens: CardapioItem[] };
export type CardapioEstado = { comidas: CardapioSecao[]; bebidas: CardapioSecao[]; vendinha: CardapioSecao[]; especiais?: CardapioSecao[] };

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
  ]
};

// Lista de países pro seletor de DDI no formulário público.
// Validação: comprimento min/max de dígitos do número LOCAL (sem o DDI).
// Pra Brasil tem regra específica: 10 dígitos (fixo, DDD + 8 dígitos) ou
// 11 dígitos (celular, DDD + 9 + 8 dígitos), DDD entre 11-99.

export type Pais = {
  iso: string;          // ISO 3166-1 alpha-2 (BR, US, AR...)
  nome: string;
  ddi: string;          // "55", "1", "351"...
  flag: string;         // emoji bandeira
  minLen: number;       // mínimo de dígitos no número local (sem DDI)
  maxLen: number;       // máximo
};

export const PAISES: Pais[] = [
  // Brasil em primeiro (default)
  { iso: "BR", nome: "Brasil",          ddi: "55",  flag: "🇧🇷", minLen: 10, maxLen: 11 },
  // Países que mais aparecem em viagem/negócio com BR
  { iso: "US", nome: "EUA",             ddi: "1",   flag: "🇺🇸", minLen: 10, maxLen: 10 },
  { iso: "PT", nome: "Portugal",        ddi: "351", flag: "🇵🇹", minLen: 9,  maxLen: 9  },
  { iso: "AR", nome: "Argentina",       ddi: "54",  flag: "🇦🇷", minLen: 10, maxLen: 11 },
  { iso: "UY", nome: "Uruguai",         ddi: "598", flag: "🇺🇾", minLen: 8,  maxLen: 9  },
  { iso: "PY", nome: "Paraguai",        ddi: "595", flag: "🇵🇾", minLen: 9,  maxLen: 9  },
  { iso: "CL", nome: "Chile",           ddi: "56",  flag: "🇨🇱", minLen: 9,  maxLen: 9  },
  { iso: "CO", nome: "Colômbia",        ddi: "57",  flag: "🇨🇴", minLen: 10, maxLen: 10 },
  { iso: "PE", nome: "Peru",            ddi: "51",  flag: "🇵🇪", minLen: 9,  maxLen: 9  },
  { iso: "MX", nome: "México",          ddi: "52",  flag: "🇲🇽", minLen: 10, maxLen: 10 },
  { iso: "ES", nome: "Espanha",         ddi: "34",  flag: "🇪🇸", minLen: 9,  maxLen: 9  },
  { iso: "FR", nome: "França",          ddi: "33",  flag: "🇫🇷", minLen: 9,  maxLen: 9  },
  { iso: "IT", nome: "Itália",          ddi: "39",  flag: "🇮🇹", minLen: 9,  maxLen: 11 },
  { iso: "DE", nome: "Alemanha",        ddi: "49",  flag: "🇩🇪", minLen: 10, maxLen: 12 },
  { iso: "GB", nome: "Reino Unido",     ddi: "44",  flag: "🇬🇧", minLen: 10, maxLen: 10 },
  { iso: "CA", nome: "Canadá",          ddi: "1",   flag: "🇨🇦", minLen: 10, maxLen: 10 },
  { iso: "JP", nome: "Japão",           ddi: "81",  flag: "🇯🇵", minLen: 10, maxLen: 10 },
  { iso: "CN", nome: "China",           ddi: "86",  flag: "🇨🇳", minLen: 11, maxLen: 11 },
  { iso: "AU", nome: "Austrália",       ddi: "61",  flag: "🇦🇺", minLen: 9,  maxLen: 9  },
  { iso: "NL", nome: "Holanda",         ddi: "31",  flag: "🇳🇱", minLen: 9,  maxLen: 9  },
  { iso: "CH", nome: "Suíça",           ddi: "41",  flag: "🇨🇭", minLen: 9,  maxLen: 9  },
  { iso: "BE", nome: "Bélgica",         ddi: "32",  flag: "🇧🇪", minLen: 9,  maxLen: 9  },
  { iso: "AE", nome: "Em. Árabes",      ddi: "971", flag: "🇦🇪", minLen: 9,  maxLen: 9  },
  { iso: "IL", nome: "Israel",          ddi: "972", flag: "🇮🇱", minLen: 9,  maxLen: 9  },
  { iso: "BO", nome: "Bolívia",         ddi: "591", flag: "🇧🇴", minLen: 8,  maxLen: 8  },
  { iso: "EC", nome: "Equador",         ddi: "593", flag: "🇪🇨", minLen: 9,  maxLen: 9  },
  { iso: "VE", nome: "Venezuela",       ddi: "58",  flag: "🇻🇪", minLen: 10, maxLen: 10 },
  { iso: "ZA", nome: "África do Sul",   ddi: "27",  flag: "🇿🇦", minLen: 9,  maxLen: 9  },
  { iso: "IN", nome: "Índia",           ddi: "91",  flag: "🇮🇳", minLen: 10, maxLen: 10 },
  // Fallback: cliente digita DDI manualmente e número sem validação de
  // comprimento. minLen=4 é só pra evitar campo vazio (qualquer telefone
  // real tem mais de 4 dígitos). DDI fica em branco — é preenchido pelo
  // usuário na UI quando escolhe esta opção.
  { iso: "OUTROS", nome: "Outro país (digitar DDI)", ddi: "", flag: "🌐", minLen: 4, maxLen: 20 },
];

export const PAIS_BR = PAISES[0];

export function getPaisByIso(iso: string): Pais {
  return PAISES.find(p => p.iso === iso) || PAIS_BR;
}

// DDDs válidos no Brasil — pra validação extra
const BR_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,           // SP
  21, 22, 24,                                    // RJ
  27, 28,                                        // ES
  31, 32, 33, 34, 35, 37, 38,                    // MG
  41, 42, 43, 44, 45, 46,                        // PR
  47, 48, 49,                                    // SC
  51, 53, 54, 55,                                // RS
  61,                                            // DF
  62, 64,                                        // GO
  63,                                            // TO
  65, 66,                                        // MT
  67,                                            // MS
  68,                                            // AC
  69,                                            // RO
  71, 73, 74, 75, 77,                            // BA
  79,                                            // SE
  81, 87,                                        // PE
  82,                                            // AL
  83,                                            // PB
  84,                                            // RN
  85, 88,                                        // CE
  86, 89,                                        // PI
  91, 93, 94,                                    // PA
  92, 97,                                        // AM
  95,                                            // RR
  96,                                            // AP
  98, 99,                                        // MA
]);

// Valida número LOCAL (sem DDI) pra um país específico.
// Recebe input cru (com ou sem máscara) — limpa antes de validar.
// OUTROS: validação mais frouxa (só checa que tem dígitos suficientes).
export function validarNumeroLocal(input: string, pais: Pais): boolean {
  const digitos = input.replace(/\D/g, "");
  if (digitos.length < pais.minLen || digitos.length > pais.maxLen) return false;
  // Regra específica do Brasil: DDD válido + se 11 dígitos o 3º deve ser 9 (celular)
  if (pais.iso === "BR") {
    const ddd = parseInt(digitos.slice(0, 2), 10);
    if (!BR_DDDS.has(ddd)) return false;
    if (digitos.length === 11 && digitos[2] !== "9") return false;
  }
  return true;
}

// Valida DDI digitado manualmente (OUTROS). DDIs reais têm 1-4 dígitos.
export function validarDDIManual(ddi: string): boolean {
  const d = ddi.replace(/\D/g, "");
  return d.length >= 1 && d.length <= 4;
}

// Formata número LOCAL pra exibição com máscara amigável do país.
// Default: separa por blocos comuns. OUTROS: não formata (deixa cru).
export function formatarNumeroLocal(input: string, pais: Pais): string {
  const d = input.replace(/\D/g, "");
  if (pais.iso === "OUTROS") return d; // sem formatação — usuário digita livre
  if (pais.iso === "BR") {
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return d;
  }
  if (pais.iso === "US" || pais.iso === "CA") {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
  }
  // Default: agrupa em 3-3 (legível)
  return d.replace(/(.{3})/g, "$1 ").trim();
}

// Monta o número completo no formato E.164 (sem espaços, com "+")
export function montarE164(ddi: string, numeroLocal: string): string {
  const d = numeroLocal.replace(/\D/g, "");
  return `+${ddi}${d}`;
}

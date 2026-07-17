// Tipos do agente de conferência de folhas de pagamento.
// Ver briefing: ~/Downloads/briefing-agente-conferencia-folhas.md
//
// Princípio: aritmética é código, LLM é linguagem. O parser (Claude) devolve
// FolhaEspelho; o motor de regras (código puro, testável) devolve Finding[].

export type FolhaTipo = "folha" | "adiantamento";
export type Severidade = "P0" | "P1" | "P2" | "OK";
export type BlocoId = "A" | "B" | "C" | "D" | "E";

// Uma linha de verba (provento ou desconto) do espelho.
export type VerbaLinha = {
  codigo: string;        // código da verba (ex.: "154", "953", "5")
  descricao: string;
  referencia?: string;   // ex.: "40%", "2/36", "220h"
  valor: number;
};

export type SituacaoTipo = "normal" | "ferias" | "demitido" | "afastado";

export type FolhaColaborador = {
  matricula?: string;
  nome: string;
  cpf: string;                 // só dígitos (11) — chave de tudo
  ctps?: string;
  cbo?: string;
  funcao?: string;
  admissao?: string;           // YYYY-MM-DD
  salarioBase?: number;
  horasMensais?: number;
  temSalarioFamilia?: boolean;
  temIR?: boolean;
  situacao?: { tipo: SituacaoTipo; inicio?: string; fim?: string };
  proventos: VerbaLinha[];
  descontos: VerbaLinha[];
  liquido: number;
  // Totais IMPRESSOS no espelho ("Total de proventos ->", "Total de descontos ->").
  // Usados pelo Bloco A pra pegar o parser perdendo uma verba (Σ verbas vs total impresso).
  totalProventos?: number;
  totalDescontos?: number;
  bases?: { inss?: number; fgts?: number; irrf?: number; salarioFamilia?: number };
  multiplosVinculos?: boolean;
};

export type FolhaEspelho = {
  empresa?: string;
  competencia?: string;        // "YYYY-MM"
  tipo: FolhaTipo;
  colaboradores: FolhaColaborador[];
  resumoGeral?: { liquido?: number; totalProventos?: number; totalDescontos?: number };
  gps?: number;
};

// Um achado da conferência. severidade "OK" = explicado, não reportar.
export type Finding = {
  bloco: BlocoId;
  severidade: Severidade;
  tipo: string;                // slug: "gorjeta_divergente", "adiantamento_sem_953", ...
  cpf?: string;
  colaborador?: string;
  esperado?: number;
  encontrado?: number;
  delta?: number;
  fonteEsperado?: string;
  fonteEncontrado?: string;
  explicacao: string;
  acao?: string;
  whitelisted?: boolean;       // silenciado por regra da whitelist
};

// Exceção conhecida (seção 7 do briefing). Editável na UI.
export type FolhaWhitelistItem = {
  id: string;
  restaurantId: string;
  cpf: string;                 // só dígitos
  tipo: string;                // ex.: "sem_adiantamento", "prolabore_duplo", "acidente", "cadastral"
  motivo: string;
  inicio?: string;             // YYYY-MM-DD
  fim?: string;                // YYYY-MM-DD (opcional = permanente)
  criadoEm?: string;
  criadoPor?: string;
};

// Snapshot persistido de uma conferência de competência (baseline do mês seguinte).
export type FolhaConferencia = {
  id: string;                  // `${restaurantId}_${competencia}`
  restaurantId: string;
  competencia: string;         // "YYYY-MM"
  folha?: FolhaEspelho;
  adiantamento?: FolhaEspelho;
  findings: Finding[];
  status: "aberta" | "com_pendencias" | "fechada";
  resumo?: { liquidoClt?: number; headcount?: number; gps?: number };
  criadoEm: string;
  criadoPor?: string;
  fechadaEm?: string;
  fechadaPor?: string;
};

// Só dígitos — normalização de CPF usada em TODA comparação (nunca por nome).
export function cpfDigits(cpf?: string | null): string {
  return (cpf || "").replace(/\D/g, "");
}

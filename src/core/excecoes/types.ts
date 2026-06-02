// ════════════════════════════════════════════════════════════════════════════
//  Tipos do módulo Relatório de Exceções (integração Sólides/Tangerino)
// ════════════════════════════════════════════════════════════════════════════

import type { ScheduleStatus } from "../types";

// ─── Marcação de ponto crua, como vem da API da Sólides ─────────────────────
// Cada punch é um BLOCO contínuo de trabalho (entrada + saída), não um evento
// único. Um dia com pausa de almoço gera 2 punches; o intervalo intrajornada
// é o gap entre o dateOut de um bloco e o dateIn do próximo do mesmo dia.
export type SolidesPunch = {
  id: number;
  date: string; // YYYY-MM-DD
  employeeId: number;
  employeeName?: string;
  employee?: { cpf?: string; id?: number; name?: string };
  dateIn: number; // epoch ms — entrada do bloco
  dateOut: number; // epoch ms — saída do bloco
  workScheduleId?: number;
  adjustmentReason?: string | null;
  adjustmentReasonRecord?: unknown;
  excluded?: boolean;
  edited?: boolean;
  status?: string;
  justification?: string | null;
};

// ─── Métricas consolidadas de UM colaborador num DIA ────────────────────────
export type DayMetrics = {
  employeeId: number; // id da Sólides
  cpf: string; // só dígitos — chave de junção com o Empregado do Planejamento
  employeeName: string;
  date: string; // YYYY-MM-DD
  blocks: SolidesPunch[]; // blocos do dia, ordenados por dateIn

  totalMinutes: number; // soma da duração dos blocos válidos
  intervalMinutes: number; // soma dos gaps entre blocos
  maxGapMinutes: number; // maior gap entre blocos (pra regra de intervalo legal)
  firstIn: number | null; // epoch ms — entrada do 1º bloco
  lastOut: number | null; // epoch ms — saída do último bloco

  hasAdjustment: boolean; // algum bloco tem adjustmentReason
  hasEdit: boolean; // algum bloco foi editado
  hasExclusion: boolean; // algum bloco está marcado como excluído
  hasOpenPunch: boolean; // algum bloco sem saída (dateOut ausente ou <= dateIn)
  shortBlocks: number; // qtd de blocos com duração < 10min
};

// ─── Exceção detectada (resultado de uma regra) ─────────────────────────────
export type ExceptionSeverity = "info" | "aviso" | "grave";

export type ExceptionRuleId =
  | "jornadaAcimaDe10h"
  | "intervaloMenorQueLegal"
  | "interjornadaCurta"
  | "setePlusDiasSemFolga"
  | "pontoAberto"
  | "faltaSemAjuste"
  | "marcacaoForaDaEscala"
  | "blocoSuspeito"
  | "atrasoEntrada"
  | "entradaProvavelFaltante";

// Categoria do apontamento na UI:
//   alinhamento  — comportamento a ser alinhado verbalmente com o empregado
//                  pra não se repetir (ex: atraso, jornada > 10h, falta de
//                  intervalo de propósito, etc). O líder dá ciência.
//   ajuste       — erro de lançamento que precisa o empregado refazer
//                  a marcação no Sólides (ex: esqueceu de bater saída,
//                  batidas incompletas, 0 batidas, bloco esquisito).
//
// Apontamentos de "ajuste" têm botão "Foi isso mesmo" pra reclassificar
// como alinhamento (ex: trabalhou sem intervalo de propósito = vira
// alinhamento + ciência).
export type ApontamentoCategoria = "alinhamento" | "ajuste";

export const REGRA_CATEGORIA_DEFAULT: Record<ExceptionRuleId, ApontamentoCategoria> = {
  jornadaAcimaDe10h:       "alinhamento",
  intervaloMenorQueLegal:  "alinhamento",
  interjornadaCurta:       "alinhamento",
  setePlusDiasSemFolga:    "alinhamento",
  atrasoEntrada:           "alinhamento",
  marcacaoForaDaEscala:    "alinhamento",
  pontoAberto:             "ajuste",
  faltaSemAjuste:          "ajuste",
  entradaProvavelFaltante: "ajuste",
  blocoSuspeito:           "ajuste",
};

// Status do DIA (empregado × data) — independente dos apontamentos
// individuais. Persiste em /excecoesDiaStatus/{restaurantId}_{empregadoId}_{YYYY-MM-DD}.
export type PontoDiaStatus =
  | "pendente"            // detectado, ainda não tratado (default — não cria doc)
  | "ajuste_solicitado"   // líder enviou pedido de ajuste pro empregado (auto ao enviar WhatsApp de ajuste)
  | "tratado"             // alinhado verbalmente, não precisa do Sólides corrigir
  | "corrigido_solides"   // empregado corrigiu no Sólides — detectado por diff
  | "reaberto";           // voltou pra tratar de novo

export const PONTO_DIA_STATUS_LABEL: Record<PontoDiaStatus, string> = {
  pendente:            "Pendente",
  ajuste_solicitado:   "Ajuste solicitado",
  tratado:             "Tratado",
  corrigido_solides:   "Corrigido no Sólides",
  reaberto:            "Reaberto",
};

export type ExceptionRecord = {
  ruleId: ExceptionRuleId;
  severity: ExceptionSeverity;
  date: string; // YYYY-MM-DD
  employeeId: number; // id da Sólides (0 quando o dia veio só da escala)
  cpf: string;
  employeeName: string;
  description: string; // texto pronto pra exibir
  detail?: string; // contexto extra opcional
};

// Status por APONTAMENTO individual (empregado × data × ruleId).
// Persiste em /excecoesApontamentoStatus/{rid}_{empId}_{date}_{ruleId}.
// Default = "aberto" (não cria doc — derivado na ausência).
export type PontoApontamentoStatus =
  | "aberto"               // sem ação tomada
  | "ciencia"              // líder deu ciência (alinhamento presencial — usado em apontamentos de categoria "alinhamento")
  | "nao_e_inconformidade" // marcado como falso positivo (usado em "ajuste")
  | "corrigido_solides";   // sumiu no próximo report (preenchido automaticamente)

export const PONTO_APONTAMENTO_STATUS_LABEL: Record<PontoApontamentoStatus, string> = {
  aberto:                 "Aberto",
  ciencia:                "Ciência dada",
  nao_e_inconformidade:   "Não é inconformidade",
  corrigido_solides:      "Corrigido no Sólides",
};

// ─── Contexto que cada regra recebe ─────────────────────────────────────────
export type DayContext = {
  metrics: DayMetrics;
  escalaStatus: ScheduleStatus | null; // status planejado no Planejamento (null = desconhecido)
  prevDayLastOut: number | null; // epoch ms — saída do dia anterior (pra interjornada)
  consecutiveWorkDays: number; // nº de dias consecutivos com punch, incluindo este
  // Horário previsto NA SÓLIDES (cadastro do quadro do empregado). Não confundir
  // com escala prevista do Planejamento.app. Usado pra regra de atraso.
  horarioPrevisto?: { in: string; out: string };
};

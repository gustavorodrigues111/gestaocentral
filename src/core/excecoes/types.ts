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
  | "atrasoEntrada";

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

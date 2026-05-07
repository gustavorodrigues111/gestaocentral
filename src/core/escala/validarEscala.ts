// Validações CLT aplicadas na hora de marcar override na escala manual.
// Foco no que pode ser detectado SEM olhar horários (só status do dia):
// - DSR (Art. 67): pelo menos 1 folga a cada 7 dias consecutivos
// - 6 dias trabalhados seguidos é o máximo

import type { DerivedDay } from "./horarios";
import type { EscalaMes, ScheduleStatus } from "../types";
import { pad2 } from "../utils/date";

export type ValidacaoEscalaIssue = {
  tipo: "dsr";
  mensagem: string;
  artigo: string;
  data: string;     // YYYY-MM-DD que viola
};

// Status que conta como "trabalhou" pra DSR
function diaTrabalhado(s: ScheduleStatus | undefined): boolean {
  if (!s) return false;
  return ["trabalho", "comp_trab", "freela"].includes(s);
}

// Resolve status final em uma data (override > derivado)
function statusEm(
  date: string,
  overridesEmp: Record<string, ScheduleStatus>,
  derivadosEmp: Record<string, DerivedDay>,
): ScheduleStatus | undefined {
  if (overridesEmp[date]) return overridesEmp[date];
  return derivadosEmp[date]?.status;
}

// Adiciona N dias a uma data YYYY-MM-DD
function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Valida ANTES de aplicar um override numa célula.
// Se retorna array vazio, está OK. Senão, lista de violações.
export function validarOverride(opts: {
  empregadoId: string;
  data: string;                     // YYYY-MM-DD que vai mudar
  novoStatus: ScheduleStatus | null; // null = reverter ao cadastrado
  escala: EscalaMes | null;
  derivados: Record<string, { [date: string]: DerivedDay }>;
  versao: "prevista" | "real";
}): ValidacaoEscalaIssue[] {
  const { empregadoId, data, novoStatus, escala, derivados, versao } = opts;
  const issues: ValidacaoEscalaIssue[] = [];

  // Simula o estado APÓS aplicar a mudança
  const overridesAtuais = (escala?.[versao]?.[empregadoId] || {}) as Record<string, ScheduleStatus>;
  const overridesSimulados = { ...overridesAtuais };
  if (novoStatus === null) delete overridesSimulados[data];
  else overridesSimulados[data] = novoStatus;

  const derivadosEmp = derivados[empregadoId] || {};

  // DSR: pra cada janela de 7 dias deslizante centrada em volta da data,
  // conta dias trabalhados. Se TODOS os 7 são trabalhados, viola.
  // Verificamos do 6º dia antes ao 0º — assim qualquer janela de 7 que inclua a data alvo é coberta.
  for (let offset = -6; offset <= 0; offset++) {
    const inicio = addDays(data, offset);
    let trabalhados = 0;
    for (let i = 0; i < 7; i++) {
      const d = addDays(inicio, i);
      const status = statusEm(d, overridesSimulados, derivadosEmp);
      if (diaTrabalhado(status)) trabalhados++;
    }
    if (trabalhados === 7) {
      issues.push({
        tipo: "dsr",
        artigo: "Art. 67 CLT",
        data,
        mensagem: `Empregado ficaria 7 dias trabalhados consecutivos (de ${inicio} a ${addDays(inicio, 6)}). Falta o descanso semanal remunerado.`,
      });
      // Encontrou já — não precisa reportar todas as janelas
      break;
    }
  }

  return issues;
}

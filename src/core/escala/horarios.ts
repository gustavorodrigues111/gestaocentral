// ════════════════════════════════════════════════════════════════════════════
// Lógica de horários de trabalho (workSchedules)
// Portado do AppTip mantendo as regras CLT idênticas.
// ════════════════════════════════════════════════════════════════════════════

import type { Empregado, HorarioDia, ScheduleStatus, SundayCycle, WorkSchedule } from "../types";
import { empregadoAtivoEm } from "../utils/empregado";

export const WEEKDAYS: { idx: number; short: string; long: string }[] = [
  { idx: 0, short: "Dom", long: "Domingo" },
  { idx: 1, short: "Seg", long: "Segunda-feira" },
  { idx: 2, short: "Ter", long: "Terça-feira" },
  { idx: 3, short: "Qua", long: "Quarta-feira" },
  { idx: 4, short: "Qui", long: "Quinta-feira" },
  { idx: 5, short: "Sex", long: "Sexta-feira" },
  { idx: 6, short: "Sáb", long: "Sábado" },
];

// "HH:MM" → minutos desde meia-noite (number)
export function timeToMin(t: string | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(":").map(n => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

// Minutos → "HH:MM"
export function fmtHHMM(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "00:00";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Calcula horas do dia respeitando hora ficta noturna (CLT Art. 73).
// Hora noturna = 22h–05h, conta como 52min30s = 1h pra contrato.
// Retorna em MINUTOS:
//   worked         — minutos efetivamente trabalhados (descontando intervalo)
//   diurnal        — minutos no horário diurno
//   nocturnal      — minutos no horário noturno (22h-05h, "raw")
//   nocturnalFicta — minutos noturnos convertidos pela ficta (×60/52.5)
//   totalContract  — diurnal + nocturnalFicta (carga pra contrato)
export type DayHours = {
  worked: number;
  diurnal: number;
  nocturnal: number;
  nocturnalFicta: number;
  totalContract: number;
  error?: string;
};

export function calcDayHours(inTime: string | undefined, outTime: string | undefined, breakMin: number = 0): DayHours {
  const empty: DayHours = { worked: 0, diurnal: 0, nocturnal: 0, nocturnalFicta: 0, totalContract: 0 };
  if (!inTime || !outTime) return empty;
  const inMin = timeToMin(inTime);
  let outMin = timeToMin(outTime);
  // Overnight (ex: 22:00 → 06:00 do dia seguinte)
  if (outMin <= inMin) outMin += 24 * 60;
  const worked = outMin - inMin;
  if (worked <= 0) return { ...empty, error: "Horário inválido" };

  // Conta minutos noturnos brutos (22:00–05:00 do dia seguinte)
  // 22:00 = 1320min do dia 1; 05:00 do dia 2 = 1740min cumulativo
  let nocturnal = 0;
  // Janela 1: 22:00–24:00 (1320–1440)
  nocturnal += overlap(inMin, outMin, 22 * 60, 24 * 60);
  // Janela 2: 24:00–29:00 (1440–1740) — equivalente a 00:00–05:00 do dia seguinte
  nocturnal += overlap(inMin, outMin, 24 * 60, 29 * 60);
  // Se o turno começa antes da meia-noite (ex: 14:00 do dia 1 com saída 23:00), também precisa contar a janela do dia 1 (22:00–24:00) — já coberto acima.

  const diurnal = worked - nocturnal;

  // Desconta intervalo: prioritariamente do diurno, sobra pega do noturno
  const bk = Math.max(0, breakMin || 0);
  let diurnalFinal = diurnal;
  let nocturnalFinal = nocturnal;
  if (bk <= diurnalFinal) {
    diurnalFinal -= bk;
  } else {
    const restoBreak = bk - diurnalFinal;
    diurnalFinal = 0;
    nocturnalFinal = Math.max(0, nocturnalFinal - restoBreak);
  }

  // Hora ficta: 1h noturna trabalhada = 1h e 8.57min de contrato
  // (60 / 52.5) = 1.142857... — arredonda pra inteiro
  const nocturnalFicta = Math.round(nocturnalFinal * (60 / 52.5));
  const totalContract = diurnalFinal + nocturnalFicta;

  return {
    worked: diurnalFinal + nocturnalFinal,
    diurnal: diurnalFinal,
    nocturnal: nocturnalFinal,
    nocturnalFicta,
    totalContract,
  };
}

// Sobreposição entre dois intervalos [a1, a2] e [b1, b2] em minutos
function overlap(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

// ─── VALIDAÇÕES CLT ──────────────────────────────────────────────────────────

export type ValidacaoIssue = {
  tipo: "jornada_max" | "intra_jornada" | "inter_jornada" | "dsr" | "carga_semanal" | "horario_invalido";
  mensagem: string;
  artigo: string;
  severidade: "erro";
};

export type ValidacaoResultado = {
  errors: ValidacaoIssue[];
  totalContract: number;       // minutos
  diasAtivos: number;
};

/**
 * Valida um conjunto de 7 dias contra todas as regras CLT.
 * Retorna lista de erros + total contratado.
 *
 * Regras (idênticas ao AppTip):
 * - Art. 59: jornada contratual ≤ 10h/dia (8h + 2h extra, incluindo ficta noturna)
 * - Art. 71: intervalo intra-jornada (>6h: 1h; >4h e ≤6h: 15min)
 * - Art. 66: interjornada ≥ 11h consecutivas (entre fim de um dia e início do próximo)
 * - Art. 67: DSR ≥ 1 folga semanal (não pode trabalhar 7/7)
 * - Art. 58 + CF Art. 7º XIV: carga semanal entre os limites do restaurante
 */
export function validateWorkScheduleDays(
  days: { [key: number]: HorarioDia },
  cargaMinMin: number,
  cargaMaxMin: number,
): ValidacaoResultado {
  const errors: ValidacaoIssue[] = [];
  const ativos: { idx: number; dia: HorarioDia; calc: DayHours }[] = [];

  for (let i = 0; i < 7; i++) {
    const d = days[i];
    if (!d || !d.active) continue;
    const calc = calcDayHours(d.in, d.out, d.break || 0);
    if (calc.error) {
      errors.push({
        tipo: "horario_invalido",
        artigo: "—",
        severidade: "erro",
        mensagem: `${WEEKDAYS[i].long}: ${calc.error}`,
      });
      continue;
    }
    ativos.push({ idx: i, dia: d, calc });
  }

  // ── Jornada máxima: 10h contratuais/dia (Art. 59 CLT) ──
  for (const { idx, calc } of ativos) {
    if (calc.totalContract > 10 * 60) {
      errors.push({
        tipo: "jornada_max",
        artigo: "Art. 59 CLT",
        severidade: "erro",
        mensagem: `${WEEKDAYS[idx].long}: jornada contratual de ${fmtHHMM(calc.totalContract)} ultrapassa o máximo de 10h.`,
      });
    }
  }

  // ── Intervalo intra-jornada (Art. 71 CLT) ──
  for (const { idx, dia, calc } of ativos) {
    const bk = dia.break || 0;
    if (calc.worked > 6 * 60 && bk < 60) {
      errors.push({
        tipo: "intra_jornada",
        artigo: "Art. 71 CLT",
        severidade: "erro",
        mensagem: `${WEEKDAYS[idx].long}: jornada de ${fmtHHMM(calc.worked)} exige intervalo mínimo de 60min (atual: ${bk}min).`,
      });
    } else if (calc.worked > 4 * 60 && calc.worked <= 6 * 60 && bk < 15) {
      errors.push({
        tipo: "intra_jornada",
        artigo: "Art. 71 §1 CLT",
        severidade: "erro",
        mensagem: `${WEEKDAYS[idx].long}: jornada de ${fmtHHMM(calc.worked)} exige intervalo mínimo de 15min (atual: ${bk}min).`,
      });
    }
  }

  // ── Interjornada ≥ 11h (Art. 66 CLT) com wrap-around da semana ──
  if (ativos.length >= 2) {
    const sorted = [...ativos].sort((a, b) => a.idx - b.idx);
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      const nxt = sorted[(i + 1) % sorted.length];
      const daysBetween = nxt.idx > cur.idx ? nxt.idx - cur.idx : nxt.idx + 7 - cur.idx;
      const curIn = timeToMin(cur.dia.in);
      const curOut = timeToMin(cur.dia.out);
      const nxtIn = timeToMin(nxt.dia.in);
      const isOvernight = curOut <= curIn;
      let gap: number;
      if (isOvernight) {
        gap = (24 * 60 - curOut) + (daysBetween - 2) * 24 * 60 + nxtIn;
      } else {
        gap = (24 * 60 - curOut) + (daysBetween - 1) * 24 * 60 + nxtIn;
      }
      if (gap < 11 * 60) {
        errors.push({
          tipo: "inter_jornada",
          artigo: "Art. 66 CLT",
          severidade: "erro",
          mensagem: `Interjornada entre ${WEEKDAYS[cur.idx].short} e ${WEEKDAYS[nxt.idx].short} é de ${fmtHHMM(gap)}, mínimo exigido é 11h.`,
        });
      }
    }
  }

  // ── DSR: pelo menos 1 folga semanal (Art. 67 CLT) ──
  if (ativos.length >= 7) {
    errors.push({
      tipo: "dsr",
      artigo: "Art. 67 CLT",
      severidade: "erro",
      mensagem: "Sem dia de folga na semana. Empregado deve ter pelo menos 1 descanso semanal.",
    });
  }

  // ── Carga semanal: entre min/max do restaurante (Art. 58 + CF 7º XIV) ──
  const totalContract = ativos.reduce((s, a) => s + a.calc.totalContract, 0);
  if (ativos.length > 0 && (totalContract < cargaMinMin || totalContract > cargaMaxMin)) {
    errors.push({
      tipo: "carga_semanal",
      artigo: "Art. 58 + CF 7º XIV",
      severidade: "erro",
      mensagem: `Carga semanal de ${fmtHHMM(totalContract)} fora do intervalo permitido (${fmtHHMM(cargaMinMin)} a ${fmtHHMM(cargaMaxMin)}).`,
    });
  }

  return { errors, totalContract, diasAtivos: ativos.length };
}

// Pega o WorkSchedule vigente em uma data específica.
//
// Regra: entre as versões aplicáveis (validFrom <= dateStr), vence a ÚLTIMA
// CADASTRADA (maior `registradoEm`). Se duas tiverem o mesmo registradoEm,
// desempate pela maior `validFrom`.
//
// Por quê isso e não "último validFrom como ganha"? Porque o usuário às vezes
// edita uma versão antiga (ex: pra adicionar ciclo de domingo retroativo) e
// espera que essa edição PASSE A VALER no presente. Se outra versão posterior
// existe mas sem o ciclo, o "último validFrom vence" ignorava a edição recente.
// A nova regra respeita a INTENÇÃO do último cadastro.
export function getActiveWorkSchedule(
  workSchedules: WorkSchedule[] | undefined,
  dateStr: string,
): WorkSchedule | null {
  if (!workSchedules || workSchedules.length === 0) return null;
  const applicable = workSchedules.filter(s => !s.validFrom || s.validFrom <= dateStr);
  if (applicable.length === 0) return null;
  return [...applicable].sort((a, b) => {
    const ra = a.registradoEm || a.validFrom || "";
    const rb = b.registradoEm || b.validFrom || "";
    if (rb !== ra) return rb.localeCompare(ra);       // mais recente cadastrado primeiro
    return (b.validFrom || "").localeCompare(a.validFrom || ""); // empate: validFrom maior
  })[0];
}

// Cria um conjunto vazio de 7 dias (todos inativos)
export function emptyDays(): { [key: number]: HorarioDia } {
  return {
    0: { active: false }, 1: { active: false }, 2: { active: false }, 3: { active: false },
    4: { active: false }, 5: { active: false }, 6: { active: false },
  };
}

// ─── CICLO DE DOMINGO ────────────────────────────────────────────────────────
// Modelo: trabalha N domingos seguidos, depois folga 1.
// User informa só `primeiroDomingoFolga` (refDate). offCount sempre = 1.

export function isSundayOffByCycle(cycle: SundayCycle | null | undefined, dateStr: string): boolean {
  if (!cycle || !cycle.refDate || !dateStr) return false;
  const work = parseInt(String(cycle.workCount), 10);
  const off = parseInt(String(cycle.offCount), 10) || 1;
  if (!Number.isFinite(work) || work < 0) return false;
  // Ambos devem ser domingo
  const d = new Date(dateStr + "T12:00:00");
  if (d.getDay() !== 0) return false;
  const ref = new Date(cycle.refDate + "T12:00:00");
  if (ref.getDay() !== 0) return false;
  const diffMs = d.getTime() - ref.getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  // Posição no ciclo. refDate é a 1ª folga (pos 0). Posições 0..off-1 = folga, off..off+work-1 = trabalho.
  const cycleLen = work + off;
  if (cycleLen <= 0) return false;
  const pos = ((diffWeeks % cycleLen) + cycleLen) % cycleLen;
  return pos < off;
}

// Verifica se uma data é domingo (0)
export function isSunday(dateStr: string): boolean {
  return new Date(dateStr + "T12:00:00").getDay() === 0;
}

// ─── ESCALA ALTERNADA A/B ────────────────────────────────────────────────────
// Define qual semana (A ou B) uma data específica cai, baseado no anchor.
// Anchor.date é uma SEGUNDA-FEIRA de referência marcada como anchor.week.
// Próxima segunda alterna.

export function weekTypeForDate(
  anchor: { date: string; week: "A" | "B" } | undefined,
  dateStr: string,
): "A" | "B" {
  if (!anchor || !anchor.date) return "A";
  const monAnchor = getWeekMonday(anchor.date);
  const monTarget = getWeekMonday(dateStr);
  const diffMs = new Date(monTarget + "T12:00:00").getTime()
                - new Date(monAnchor + "T12:00:00").getTime();
  const diffWeeks = Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
  const isEven = ((diffWeeks % 2) + 2) % 2 === 0;
  return isEven ? anchor.week : (anchor.week === "A" ? "B" : "A");
}

// Retorna a segunda-feira da semana de uma data (YYYY-MM-DD)
export function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay(); // 0=Dom, 1=Seg, ..., 6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Retorna o objeto `days` efetivo do schedule pra uma data específica
// (resolve se é semana A ou B se for alternada)
export function getEffectiveDays(
  schedule: WorkSchedule | null | undefined,
  dateStr: string,
): { [k: number]: HorarioDia } | null {
  if (!schedule) return null;
  if (schedule.type !== "alternating") return schedule.days || null;
  const wk = weekTypeForDate(schedule.anchor, dateStr);
  return schedule.weeks?.[wk]?.days || null;
}

// Pega o ciclo de domingo efetivo (resolve A/B)
export function getEffectiveSundayCycle(
  schedule: WorkSchedule | null | undefined,
  dateStr: string,
): SundayCycle | null {
  if (!schedule) return null;
  if (schedule.type !== "alternating") return schedule.sundayCycle || null;
  const wk = weekTypeForDate(schedule.anchor, dateStr);
  return schedule.weeks?.[wk]?.sundayCycle || schedule.sundayCycle || null;
}

// ─── ESCALA DERIVADA AUTOMATICAMENTE ─────────────────────────────────────────
// Pra cada dia do mês, retorna o status que o empregado teria SE seguisse
// estritamente o horário cadastrado:
//   - Sem workSchedule: assume "trabalho" (mas marca um flag externo pra UI saber)
//   - Com workSchedule: pega effective days do dia da semana
//     • dia inativo → "folga"
//     • dia ativo + domingo + ciclo bate → "folga"
//     • caso contrário → "trabalho"
//   - Empregado fora do período (não admitido / demitido) → não inclui

export type DerivedDay = {
  status: ScheduleStatus;     // "trabalho" | "folga" (na fase 10, só esses)
  fonte: "schedule" | "implicito";  // schedule = veio do workSchedule; implicito = sem cadastro
  unidadeId?: string;         // Multi-unidades: override do dia (do HorarioDia.unidadeId)
};

export function derivedScheduleForEmpregado(
  emp: Empregado,
  year: number,
  month: number,           // 1-12
): { [date: string]: DerivedDay } {
  const result: { [date: string]: DerivedDay } = {};
  const lastDay = new Date(year, month, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!empregadoAtivoEm(emp, dateStr)) continue;
    const ws = getActiveWorkSchedule(emp.workSchedules, dateStr);
    if (!ws) {
      // Sem cadastro de horário — empregado é considerado trabalhando todo dia
      result[dateStr] = { status: "trabalho", fonte: "implicito" };
      continue;
    }
    const days = getEffectiveDays(ws, dateStr);
    if (!days) {
      result[dateStr] = { status: "trabalho", fonte: "implicito" };
      continue;
    }
    const dow = new Date(dateStr + "T12:00:00").getDay();
    const dayCfg = days[dow];
    if (!dayCfg || !dayCfg.active) {
      result[dateStr] = { status: "folga", fonte: "schedule" };
      continue;
    }
    // Dia ativo. Verifica ciclo de domingo.
    if (dow === 0) {
      const cycle = getEffectiveSundayCycle(ws, dateStr);
      if (cycle && isSundayOffByCycle(cycle, dateStr)) {
        result[dateStr] = { status: "folga", fonte: "schedule" };
        continue;
      }
    }
    result[dateStr] = {
      status: "trabalho",
      fonte: "schedule",
      ...(dayCfg.unidadeId ? { unidadeId: dayCfg.unidadeId } : {}),
    };
  }
  return result;
}

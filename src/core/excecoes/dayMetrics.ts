// ════════════════════════════════════════════════════════════════════════════
//  dayMetrics — funções PURAS de agrupamento e consolidação de marcações.
//  Sem I/O, sem Firestore, sem React. Fácil de testar isoladamente.
// ════════════════════════════════════════════════════════════════════════════

import type { DayMetrics, SolidesPunch } from "./types";

const SHORT_BLOCK_MIN = 10; // bloco com menos de 10min é "suspeito"

// "123.456.789-00" → "12345678900". null/undefined → "".
export function onlyDigits(s: string | undefined | null): string {
  return (s || "").replace(/\D/g, "");
}

// Agrupa marcações por (employeeId, date). Chave do Map: "<employeeId>|<date>".
export function groupByEmployeeDay(punches: SolidesPunch[]): Map<string, SolidesPunch[]> {
  const map = new Map<string, SolidesPunch[]>();
  for (const p of punches) {
    if (!p || typeof p.employeeId !== "number" || !p.date) continue;
    const key = `${p.employeeId}|${p.date}`;
    const arr = map.get(key);
    if (arr) arr.push(p);
    else map.set(key, [p]);
  }
  return map;
}

// Duração do bloco em minutos. Bloco aberto/inválido → 0.
function blockDurationMin(p: SolidesPunch): number {
  if (typeof p.dateIn !== "number" || typeof p.dateOut !== "number") return 0;
  const ms = p.dateOut - p.dateIn;
  if (ms <= 0) return 0;
  return Math.round(ms / 60_000);
}

// Bloco "aberto": sem dateIn, sem dateOut, ou dateOut <= dateIn.
function isOpenBlock(p: SolidesPunch): boolean {
  if (typeof p.dateIn !== "number") return true;
  if (typeof p.dateOut !== "number" || p.dateOut <= p.dateIn) return true;
  return false;
}

// Consolida os blocos de UM dia de UM colaborador num objeto DayMetrics.
export function computeDayMetrics(blocks: SolidesPunch[]): DayMetrics {
  const sorted = [...blocks].sort((a, b) => (a.dateIn || 0) - (b.dateIn || 0));
  const first = sorted[0];
  const cpf = onlyDigits(first?.employee?.cpf);
  const employeeName = first?.employee?.name || first?.employeeName || "(sem nome)";

  let totalMinutes = 0;
  let shortBlocks = 0;
  let hasOpenPunch = false;
  let hasAdjustment = false;
  let hasEdit = false;
  let hasExclusion = false;

  for (const b of sorted) {
    if (isOpenBlock(b)) {
      hasOpenPunch = true;
    } else {
      const dur = blockDurationMin(b);
      totalMinutes += dur;
      if (dur > 0 && dur < SHORT_BLOCK_MIN) shortBlocks += 1;
    }
    if (b.adjustmentReason != null || b.adjustmentReasonRecord != null) hasAdjustment = true;
    if (b.edited === true) hasEdit = true;
    if (b.excluded === true) hasExclusion = true;
  }

  // Gaps (intervalos intrajornada) entre blocos VÁLIDOS consecutivos
  const valid = sorted.filter((b) => !isOpenBlock(b));
  let intervalMinutes = 0;
  let maxGapMinutes = 0;
  for (let i = 0; i < valid.length - 1; i += 1) {
    const gap = Math.round((valid[i + 1].dateIn - valid[i].dateOut) / 60_000);
    if (gap > 0) {
      intervalMinutes += gap;
      if (gap > maxGapMinutes) maxGapMinutes = gap;
    }
  }

  const firstIn = valid.length > 0 ? valid[0].dateIn : (first?.dateIn ?? null);
  const lastOut = valid.length > 0 ? valid[valid.length - 1].dateOut : null;

  return {
    employeeId: first?.employeeId ?? 0,
    cpf,
    employeeName,
    date: first?.date || "",
    blocks: sorted,
    totalMinutes,
    intervalMinutes,
    maxGapMinutes,
    firstIn: firstIn ?? null,
    lastOut,
    hasAdjustment,
    hasEdit,
    hasExclusion,
    hasOpenPunch,
    shortBlocks,
  };
}

// DayMetrics "vazio" — usado pra dias escalados como trabalho mas SEM nenhuma
// marcação de ponto (a regra `faltaSemAjuste` roda sobre esses).
export function emptyDayMetrics(
  employeeId: number,
  cpf: string,
  employeeName: string,
  date: string,
): DayMetrics {
  return {
    employeeId,
    cpf,
    employeeName,
    date,
    blocks: [],
    totalMinutes: 0,
    intervalMinutes: 0,
    maxGapMinutes: 0,
    firstIn: null,
    lastOut: null,
    hasAdjustment: false,
    hasEdit: false,
    hasExclusion: false,
    hasOpenPunch: false,
    shortBlocks: 0,
  };
}

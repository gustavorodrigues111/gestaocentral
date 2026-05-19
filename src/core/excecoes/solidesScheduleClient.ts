// ════════════════════════════════════════════════════════════════════════════
//  Cliente front-end pra /api/solides-work-schedules. Devolve os quadros de
//  todos os empregados da Sólides já normalizados por dia da semana (0=dom).
// ════════════════════════════════════════════════════════════════════════════

import type { ScheduleStatus } from "../types";

export type SolidesEmployee = { id: number; name: string; cpf: string };

export type NormalizedDay =
  | { active: true; in: string; out: string; break: number }
  | { active: false };

export type SolidesSchedule = {
  scheduleId: number | null;
  scheduleName: string | null;
  byDay: Record<number, NormalizedDay>; // 0=dom .. 6=sáb
};

export type FetchSchedulesResult = {
  employees: SolidesEmployee[];
  schedules: Record<string, SolidesSchedule | null>;
  count: number;
  dateUsed?: Record<string, string | null>;
  errors: { employeeId: number; name: string; error: string }[];
  sampleProbe?: {
    employeeId: number;
    name: string;
    tryDate: string;
    url: string;
    status: number;
    bodyPreview: string;
    parsedShape: string;
  } | null;
};

// Aceita uma OU várias datas (em ordem de prioridade). A 1ª que retornar
// um quadro real é mantida pro empregado. Workaround pro bug da Sólides
// que devolve null inconsistente.
export async function fetchSolidesSchedules(
  dates: string | string[],
  restaurantKey: string,
): Promise<FetchSchedulesResult> {
  const list = Array.isArray(dates) ? dates : [dates];
  const params = new URLSearchParams({ dates: list.join(",") });
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-work-schedules?${params.toString()}`);
  const text = await resp.text();
  let json: unknown = {};
  if (text) {
    try { json = JSON.parse(text); } catch {
      throw new Error(`Resposta inválida do servidor (HTTP ${resp.status}).`);
    }
  }
  if (!resp.ok) {
    const msg = (json as { error?: string }).error || `Erro HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return json as FetchSchedulesResult;
}

// Converte o quadro Sólides numa "escala por data" pra alimentar o motor de
// regras do generateExceptionsReport. Pra cada data no range [start, end]:
//   - se aquele dia da semana é `active` no Sólides → status "trabalho"
//   - se não-active                                  → status "folga"
export function buildEscalaFromSolides(
  schedules: Record<string, SolidesSchedule | null>,
  empSolidesIdByCpf: Map<string, number>,
  empregadoIdsByCpf: Map<string, string>, // CPF → empregadoId do Planejamento
  startDate: string,
  endDate: string,
): Record<string, Record<string, ScheduleStatus>> {
  const out: Record<string, Record<string, ScheduleStatus>> = {};
  const dates = listDatesInRange(startDate, endDate);
  for (const [cpf, empId] of empregadoIdsByCpf) {
    const sid = empSolidesIdByCpf.get(cpf);
    if (sid == null) continue;
    const sched = schedules[String(sid)];
    if (!sched) continue;
    const perDate: Record<string, ScheduleStatus> = {};
    for (const date of dates) {
      const dow = parseDateLocal(date).getDay();
      const d = sched.byDay[dow];
      perDate[date] = d.active ? "trabalho" : "folga";
    }
    out[empId] = perDate;
  }
  return out;
}

function parseDateLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function listDatesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const a = parseDateLocal(start);
  const b = parseDateLocal(end);
  for (let dt = new Date(a); dt <= b; dt.setDate(dt.getDate() + 1)) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
//  Cliente front pra /api/solides-adjustments — busca os ajustes (folgas,
//  atestados, abonos, etc) aprovados na Sólides no range pedido.
// ════════════════════════════════════════════════════════════════════════════

import type { ScheduleStatus } from "../types";

export type SolidesAdjustment = {
  id: number;
  reason: string;       // ex: "FOLGA", "ATESTADO MÉDICO", "FALTA NÃO JUSTIFICADA"
  type?: string;
  status: "APROVADO" | "PENDENTE" | "REPROVADO";
  startDate: string;    // shape exato a confirmar — pode ser ISO, DD/MM ou ms
  endDate: string;
  recordDate?: string;
  allDay?: boolean;
};

export type FetchAdjustmentsResult = {
  employees: { id: number; name: string; cpf: string }[];
  adjustments: Record<string, SolidesAdjustment[]>;
  count: number;
  errors: { employeeId: number; name: string; error: string }[];
  sampleProbe?: unknown;
};

export async function fetchSolidesAdjustments(
  startDateMs: number,
  endDateMs: number,
  restaurantKey: string,
): Promise<FetchAdjustmentsResult> {
  const params = new URLSearchParams({
    startDate: String(startDateMs),
    endDate: String(endDateMs),
    status: "APROVADO",
  });
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-adjustments?${params.toString()}`);
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
  return json as FetchAdjustmentsResult;
}

// Normaliza diferentes formatos de data num YYYY-MM-DD local.
// Tenta: ISO "2026-05-04T00:00:00", "2026-05-04", "04/05/2026", epoch ms.
export function parseAdjustmentDate(s: string | undefined | null): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;
  // YYYY-MM-DD ou ISO YYYY-MM-DDTHH...
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  // DD/MM/YYYY
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }
  // epoch ms (string)
  if (/^\d+$/.test(t)) {
    const d = new Date(parseInt(t, 10));
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return null;
}

// Expande [startYmd, endYmd] num array de datas YYYY-MM-DD (inclusive).
function expandirRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const a = startYmd.split("-").map(Number);
  const b = endYmd.split("-").map(Number);
  let dt = new Date(a[0], a[1] - 1, a[2]);
  const end = new Date(b[0], b[1] - 1, b[2]);
  let guard = 0;
  while (dt <= end && guard < 366) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${d}`);
    dt = new Date(dt);
    dt.setDate(dt.getDate() + 1);
    guard += 1;
  }
  return out;
}

// Razões que NÃO devem virar folga (faltas não justificadas devem disparar
// a regra "Falta sem ajuste"). Tudo o resto (FOLGA, FÉRIAS, ATESTADO,
// ABONO, AFASTAMENTO, FALTA JUSTIFICADA, etc.) vira folga.
function eFaltaNaoJustificada(reason: string): boolean {
  return /FALTA\s+N[ÃA]O\s+JUSTIFICADA/i.test(reason || "");
}

// Aplica os ajustes sobre a escala vinda do quadro de horários. Pra cada
// ajuste APROVADO que não seja "falta não justificada", marca o range
// completo como "folga".
export function aplicarAjustesNaEscala(
  adjustments: Record<string, SolidesAdjustment[]>,
  solidesIdByEmpId: Record<string, number>, // empregadoId Planejamento → sid Sólides
  escala: Record<string, Record<string, ScheduleStatus>>,
): { aplicados: number } {
  let aplicados = 0;
  for (const [empId, sid] of Object.entries(solidesIdByEmpId)) {
    const ajs = adjustments[String(sid)];
    if (!Array.isArray(ajs) || ajs.length === 0) continue;
    const perDate = escala[empId];
    if (!perDate) continue;
    for (const aj of ajs) {
      if (aj.status !== "APROVADO") continue;
      if (eFaltaNaoJustificada(aj.reason)) continue;
      const a = parseAdjustmentDate(aj.startDate);
      const b = parseAdjustmentDate(aj.endDate);
      if (!a || !b) continue;
      const dias = expandirRange(a, b);
      for (const d of dias) {
        if (perDate[d] !== undefined) {
          perDate[d] = "folga";
          aplicados += 1;
        }
      }
    }
  }
  return { aplicados };
}

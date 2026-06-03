// ════════════════════════════════════════════════════════════════════════════
//  Cliente front pra /api/solides-leaves — busca AFASTAMENTOS aprovados do
//  módulo "Afastamento" da Sólides (Tangerino timeoffwork-api).
//
//  Esses afastamentos são DIFERENTES dos ajustes consumidos em
//  solidesAdjustmentsClient.ts. A UI nova "Afastamento" do RH lança aqui
//  (atestado óbito, licença, etc) e NÃO aparece no /v2/adjustments.
// ════════════════════════════════════════════════════════════════════════════

import type { ScheduleStatus } from "../types";
import type { AjustesAplicadosMap } from "./solidesAdjustmentsClient";
import { parseAdjustmentDate } from "./solidesAdjustmentsClient";

// Shape esperado do retorno timeoffwork. A API ainda não foi explorada a
// fundo — campos cobrem o que costuma vir e os apelidos comuns. Quando o
// sampleProbe da serverless retornar com chaves reais, ajustamos.
export type SolidesLeave = {
  // identificação do colaborador — pode vir como employeeId (number) OU
  // employee.id (nested) OU employee.cpf
  employeeId?: number;
  employee?: {
    id?: number;
    cpf?: string;
    name?: string;
  };
  // datas — formato esperado "YYYY-MM-DDTHH:mm:ss"
  startDate?: string;
  endDate?: string;
  // tipo do afastamento
  type?: string;
  reason?: string;
  leaveType?: string;
  // identificadores adicionais
  id?: number | string;
  status?: string;
};

export type FetchLeavesResult = {
  leaves: SolidesLeave[];
  count: number;
  sampleProbe?: unknown;
  error?: string;
};

export async function fetchSolidesLeaves(restaurantKey: string): Promise<FetchLeavesResult> {
  const params = new URLSearchParams({ status: "ALL" });
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-leaves?${params.toString()}`);
  const text = await resp.text();
  let json: unknown = {};
  if (text) {
    try { json = JSON.parse(text); } catch {
      return { leaves: [], count: 0, error: `Resposta inválida (HTTP ${resp.status}).` };
    }
  }
  if (!resp.ok) {
    const msg = (json as { error?: string }).error || `Erro HTTP ${resp.status}`;
    return { leaves: [], count: 0, error: msg };
  }
  const j = json as FetchLeavesResult;
  return {
    leaves: Array.isArray(j.leaves) ? j.leaves : [],
    count: j.count || 0,
    sampleProbe: j.sampleProbe,
  };
}

// Extrai o tipo do afastamento de um objeto com nome de campo variável.
function tipoDoAfastamento(l: SolidesLeave): string {
  return String(l.type || l.leaveType || l.reason || "AFASTAMENTO");
}

// Extrai o id Sólides do empregado, com fallback pra campo nested
function sidDoAfastamento(l: SolidesLeave): number | null {
  if (typeof l.employeeId === "number") return l.employeeId;
  if (l.employee?.id != null) return Number(l.employee.id);
  return null;
}

// Aplica os afastamentos sobre a escala (mesmo padrão do
// aplicarAjustesNaEscala — marca dia como "folga" e captura tipo). Reusa o
// mesmo schema AjustesAplicadosMap pra integrar com a regra
// `faltaJustificadaSolides`.
export function aplicarAfastamentosNaEscala(
  leaves: SolidesLeave[],
  solidesIdByEmpId: Record<string, number>,
  escala: Record<string, Record<string, ScheduleStatus>>,
): { aplicados: number; ajustesAplicados: AjustesAplicadosMap } {
  let aplicados = 0;
  const ajustesAplicados: AjustesAplicadosMap = {};

  // Index sid → list of leaves pra busca O(1)
  const leavesBySid = new Map<number, SolidesLeave[]>();
  for (const l of leaves) {
    const sid = sidDoAfastamento(l);
    if (sid == null) continue;
    if (l.status && l.status !== "APROVADO") continue;
    if (!leavesBySid.has(sid)) leavesBySid.set(sid, []);
    leavesBySid.get(sid)!.push(l);
  }

  for (const [empId, sid] of Object.entries(solidesIdByEmpId)) {
    const ls = leavesBySid.get(sid);
    if (!ls || ls.length === 0) continue;
    const perDate = escala[empId];
    if (!perDate) continue;

    for (const l of ls) {
      const a = parseAdjustmentDate(l.startDate);
      const b = parseAdjustmentDate(l.endDate);
      if (!a || !b) continue;
      const tipo = tipoDoAfastamento(l);

      // Expande range de a até b (inclusive)
      const startParts = a.split("-").map(Number);
      const endParts = b.split("-").map(Number);
      let dt = new Date(startParts[0], startParts[1] - 1, startParts[2]);
      const endDt = new Date(endParts[0], endParts[1] - 1, endParts[2]);
      let guard = 0;
      while (dt <= endDt && guard < 366) {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, "0");
        const d = String(dt.getDate()).padStart(2, "0");
        const ymd = `${y}-${m}-${d}`;
        if (perDate[ymd] !== undefined) {
          const statusAnterior = perDate[ymd];
          perDate[ymd] = "folga";
          aplicados += 1;
          if (!ajustesAplicados[empId]) ajustesAplicados[empId] = {};
          ajustesAplicados[empId][ymd] = { tipo, statusAnterior };
        }
        dt = new Date(dt);
        dt.setDate(dt.getDate() + 1);
        guard += 1;
      }
    }
  }

  return { aplicados, ajustesAplicados };
}

// ════════════════════════════════════════════════════════════════════════════
//  Client do módulo Análise de Ponto. Punches são reaproveitados de
//  core/excecoes/solidesClient (fetchPunches). Aqui só o catálogo de escalas
//  cru (/api/solides-schedule-catalog), que o motor novo precisa.
// ════════════════════════════════════════════════════════════════════════════

import type { PontoColaborador, PontoEscala } from "./analise";
import { authHeader } from "../firebase/idToken";

export async function fetchScheduleCatalog(restaurantKey: string): Promise<PontoEscala[]> {
  const params = new URLSearchParams();
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-schedule-catalog?${params.toString()}`, { method: "GET", headers: await authHeader() });
  const text = await resp.text();
  let json: unknown = {};
  if (text) {
    try { json = JSON.parse(text); }
    catch { throw new Error(`Resposta inválida do servidor (HTTP ${resp.status}).`); }
  }
  if (!resp.ok) {
    throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  }
  const data = json as { schedules?: unknown };
  return Array.isArray(data.schedules) ? (data.schedules as PontoEscala[]) : [];
}

// Roster de colaboradores (pra apontar FALTA). Pode vir vazio em algumas contas.
export async function fetchRoster(restaurantKey: string): Promise<PontoColaborador[]> {
  const params = new URLSearchParams();
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-roster?${params.toString()}`, { method: "GET", headers: await authHeader() });
  const text = await resp.text();
  let json: unknown = {};
  if (text) {
    try { json = JSON.parse(text); }
    catch { throw new Error(`Resposta inválida do servidor (HTTP ${resp.status}).`); }
  }
  if (!resp.ok) {
    throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  }
  const data = json as { employees?: unknown };
  return Array.isArray(data.employees) ? (data.employees as PontoColaborador[]) : [];
}

export type Justificativa = { id: number; description: string };

export async function fetchJustificativas(restaurantKey: string): Promise<Justificativa[]> {
  const params = new URLSearchParams();
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-ponto-correcao?${params.toString()}`, { method: "GET", headers: await authHeader() });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  const arr = (json as { justificativas?: unknown[] }).justificativas || [];
  return arr
    .map((j) => {
      const o = j as { id?: number; description?: string; nome?: string };
      return { id: Number(o.id), description: o.description || o.nome || `Justificativa ${o.id}` };
    })
    .filter((j) => Number.isFinite(j.id));
}

// Lança ponto em atraso. `dataHoraIso` = ISO com offset (ex: 2026-06-17T00:06:00.000-0300).
export async function corrigirPontoAtraso(
  restaurantKey: string,
  params: { employeeId: number; dataHoraIso: string; justificativaId: number },
): Promise<{ ok: boolean; resultado: unknown }> {
  const resp = await fetch(`/api/solides-ponto-correcao`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({
      restaurant: restaurantKey,
      employeeId: params.employeeId,
      date: params.dataHoraIso,
      justificativaId: params.justificativaId,
    }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as { ok: boolean; resultado: unknown };
}

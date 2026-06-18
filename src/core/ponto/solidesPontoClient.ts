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

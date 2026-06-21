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
export async function fetchRoster(restaurantKey: string, showFired = false): Promise<PontoColaborador[]> {
  const params = new URLSearchParams();
  if (restaurantKey) params.set("restaurant", restaurantKey);
  if (showFired) params.set("showFired", "true");
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

// ─── Aprovações de ajuste (o empregado ajustou no app dele → gestor aprova) ──
export type AprovacaoPendente = {
  punchId: number;
  employeeId: number;
  employeeName: string;
  date: string;          // YYYY-MM-DD (quando disponível)
  dateIn?: number;       // epoch ms
  dateOut?: number;      // epoch ms
  status: string;        // PENDING
  motivo?: string;       // descrição do ajuste
  observation?: string;
  editIn?: boolean;      // empregado mexeu na entrada
  editOut?: boolean;     // empregado mexeu na saída
};

function txtMotivo(x: unknown): string | undefined {
  if (!x) return undefined;
  if (typeof x === "string") return x;
  if (typeof x === "object") {
    const o = x as { description?: string; name?: string; reason?: string; descricao?: string };
    return o.description || o.descricao || o.name || o.reason || undefined;
  }
  return undefined;
}

// Lista pendências de aprovação no período (achata pendingPunchs/adjustments com status PENDING).
export async function fetchAprovacoesPendentes(
  restaurantKey: string, startDate: string, endDate: string,
): Promise<AprovacaoPendente[]> {
  const params = new URLSearchParams({ startDate, endDate });
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-ponto-aprovacoes?${params.toString()}`, { method: "GET", headers: await authHeader() });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  const employees = (json as { employees?: unknown[] }).employees || [];
  const out: AprovacaoPendente[] = [];
  for (const empRaw of employees) {
    const emp = empRaw as {
      id?: number; name?: string;
      pendingPunchs?: unknown[]; adjustments?: unknown[]; punchs?: unknown[];
    };
    const seen = new Set<number>();
    for (const arr of [emp.pendingPunchs, emp.adjustments, emp.punchs]) {
      if (!Array.isArray(arr)) continue;
      for (const itRaw of arr) {
        const it = itRaw as {
          id?: number; punchId?: number; status?: string; date?: string;
          dateIn?: number; dateOut?: number; adjustmentReason?: unknown;
          observation?: string; justification?: string;
        };
        if (String(it.status || "").toUpperCase() !== "PENDING") continue;
        const pid = it.id ?? it.punchId;
        if (pid == null || seen.has(Number(pid))) continue;
        seen.add(Number(pid));
        out.push({
          punchId: Number(pid),
          employeeId: Number(emp.id),
          employeeName: emp.name || "?",
          date: it.date || "",
          dateIn: typeof it.dateIn === "number" ? it.dateIn : undefined,
          dateOut: typeof it.dateOut === "number" ? it.dateOut : undefined,
          status: "PENDING",
          motivo: txtMotivo(it.adjustmentReason),
          observation: it.observation || it.justification || undefined,
        });
      }
    }
  }
  return out;
}

// Decide um ponto: APPROVED ou REPROVED (PUT .../status/{status} na Sólides).
export async function decidirAprovacao(
  restaurantKey: string,
  params: { punchId: number; status: "APPROVED" | "REPROVED"; observation?: string },
): Promise<{ ok: boolean; resultado: unknown }> {
  const resp = await fetch(`/api/solides-ponto-aprovacoes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ restaurant: restaurantKey, ...params }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as { ok: boolean; resultado: unknown };
}

// ─── Demissão na Sólides (módulo employer) ─────────────────────────────────
// Resolve o employeeId da Sólides pelo CPF (roster) e demite. Datas YYYY-MM-DD.
export async function demitirNoSolides(
  restaurantKey: string,
  params: { cpf: string; dismissalDate: string; reason?: string; noticeType?: string },
): Promise<{ ok: boolean; resultado: unknown }> {
  const soDig = (s?: string | null) => (s || "").replace(/\D/g, "");
  const alvo = soDig(params.cpf);
  if (!alvo) throw new Error("Pessoa sem CPF — não dá pra casar com a Sólides.");
  const roster = await fetchRoster(restaurantKey);
  const emp = roster.find((r) => soDig(r.cpf) === alvo && typeof r.id === "number");
  if (!emp || typeof emp.id !== "number") throw new Error("Empregado não encontrado/ativo na Sólides (CPF não casou).");
  const resp = await fetch(`/api/solides-demissao`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ restaurant: restaurantKey, employeeId: emp.id, dismissalDate: params.dismissalDate, reason: params.reason, noticeType: params.noticeType }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as { ok: boolean; resultado: unknown };
}

// ─── Espelho de ponto (PDF) — módulo report ────────────────────────────────
export type EspelhoPdf = { base64: string; fileExtension: string; fileName: string };

export async function fetchEspelhoPdf(
  restaurantKey: string, employeeId: number, startDate: string, endDate: string,
): Promise<EspelhoPdf> {
  const params = new URLSearchParams({ employeeId: String(employeeId), startDate, endDate });
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-timesheet?${params.toString()}`, { method: "GET", headers: await authHeader() });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as EspelhoPdf;
}

// ─── Afastamentos / Férias (módulo employer) ───────────────────────────────
export type MotivoAfastamento = { id: number; description: string; fullDay: boolean };

export async function fetchMotivosAfastamento(restaurantKey: string): Promise<MotivoAfastamento[]> {
  const params = new URLSearchParams();
  if (restaurantKey) params.set("restaurant", restaurantKey);
  const resp = await fetch(`/api/solides-afastamentos?${params.toString()}`, { method: "GET", headers: await authHeader() });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return (json as { reasons?: MotivoAfastamento[] }).reasons || [];
}

// Lança afastamento/férias no período inteiro (1 chamada). Datas YYYY-MM-DD.
export async function lancarAfastamento(
  restaurantKey: string,
  params: { employeeId: number; adjustmentReasonId: number; startDate: string; endDate: string; fullDay: boolean },
): Promise<{ ok: boolean }> {
  const resp = await fetch(`/api/solides-afastamentos`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ restaurant: restaurantKey, ...params }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as { ok: boolean };
}

// Editar batida (modify/punch). oldMs = batida atual, newMs = nova — ambos ms epoch.
export async function editarBatida(
  restaurantKey: string,
  params: { employeeId: number; punchId: number; oldMs: number; newMs: number; observation?: string },
): Promise<{ ok: boolean }> {
  const resp = await fetch(`/api/solides-ponto-correcao`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ restaurant: restaurantKey, action: "modify", ...params }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as { ok: boolean };
}

// Excluir batida (bloco). dateIn/dateOut = ms epoch do bloco.
export async function excluirBatida(
  restaurantKey: string,
  params: { employeeId: number; punchId: number; dateIn?: number; dateOut?: number },
): Promise<{ ok: boolean }> {
  const resp = await fetch(`/api/solides-ponto-correcao`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ restaurant: restaurantKey, action: "delete", ...params }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((json as { error?: string }).error || `Erro HTTP ${resp.status}`);
  return json as { ok: boolean };
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

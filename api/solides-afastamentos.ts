// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-afastamentos — afastamentos/férias na Sólides (módulo employer).
//
//  GET  → lista motivos de afastamento lançáveis pelo gestor:
//         {EMPLOYER}/adjustment-reason/find-all  (filtra active && enabledForManagers)
//  POST → lança o afastamento no PERÍODO (1 chamada cobre o intervalo inteiro):
//         {EMPLOYER}/adjustment/register
//         body do cliente: { restaurant, employeeId, adjustmentReasonId,
//                            startDate(YYYY-MM-DD), endDate(YYYY-MM-DD), fullDay }
//         Como é o gestor lançando, vai como APROVADO (origem API).
//
//  Sempre exige Firebase ID token (api/_auth). Token por restaurante (SOLIDES_TOKENS).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const EMPLOYER = "https://employer.tangerino.com.br";
const REQ_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 200;

type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = "HttpError"; }
}

function resolveToken(restaurantKey: string): { token: string } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TOKENS;
  if (restaurantKey) {
    if (!mapRaw) return { error: "SOLIDES_TOKENS não configurado nas env vars da Vercel.", status: 500 };
    let map: Record<string, string>;
    try { map = JSON.parse(mapRaw) as Record<string, string>; }
    catch { return { error: "SOLIDES_TOKENS com JSON inválido.", status: 500 }; }
    const token = map[restaurantKey];
    if (token) return { token };
    return { error: `Nenhum token Sólides configurado pro restaurante "${restaurantKey}".`, status: 400 };
  }
  const single = process.env.SOLIDES_TOKEN;
  if (single) return { token: single };
  return { error: "Integração Sólides não configurada (SOLIDES_TOKENS).", status: 500 };
}

// YYYY-MM-DD → epoch ms (America/Sao_Paulo, UTC-3 fixo).
function ymdToMs(d: string, fimDoDia: boolean): number {
  return new Date(`${d}T${fimDoDia ? "23:59:59" : "00:00:00"}.000-0300`).getTime();
}

async function solidesFetch(url: string, init: RequestInit, token: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      ...init,
      headers: { Authorization: `Basic ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) },
      signal: ctrl.signal,
    });
    if (resp.status === 401 || resp.status === 403) throw new HttpError(502, "Sólides recusou as credenciais (401/403).");
    const text = await resp.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!resp.ok) throw new HttpError(502, `Sólides retornou HTTP ${resp.status}. ${String(text).slice(0, 200)}`);
    return json;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new HttpError(504, "Timeout consultando a Sólides.");
    throw new HttpError(502, `Falha de rede consultando a Sólides: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  let usuario;
  try { usuario = await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }

  const method = req.method || "GET";
  const restaurantKey = String(
    req.query.restaurant ?? (typeof req.body === "object" && req.body ? (req.body as { restaurant?: string }).restaurant : "") ?? "",
  ).trim();
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    if (method === "GET") {
      // Lista motivos (paginado), só os ativos e lançáveis pelo gestor.
      const out: Array<{ id: number; description: string; fullDay: boolean }> = [];
      const seen = new Set<number>();
      for (let page = 0; page < 20; page++) {
        const data = await solidesFetch(`${EMPLOYER}/adjustment-reason/find-all?page=${page}&size=${PAGE_SIZE}`, { method: "GET" }, token);
        const content = Array.isArray(data) ? data : ((data as { content?: unknown[] })?.content || []);
        if (!content.length) break;
        for (const itRaw of content) {
          const it = itRaw as { id?: number; description?: string; fullDay?: boolean; active?: boolean; enabledForManagers?: boolean };
          if (it.id == null || seen.has(it.id)) continue;
          seen.add(it.id);
          if (it.active === false || it.enabledForManagers === false) continue;
          out.push({ id: it.id, description: it.description || `Motivo ${it.id}`, fullDay: it.fullDay === true });
        }
        if (content.length < PAGE_SIZE) break;
      }
      out.sort((a, b) => a.description.localeCompare(b.description));
      res.status(200).json({ reasons: out });
      return;
    }
    if (method === "POST") {
      const body = (req.body || {}) as {
        employeeId?: number; adjustmentReasonId?: number;
        startDate?: string; endDate?: string; fullDay?: boolean;
      };
      if (!body.employeeId || !body.adjustmentReasonId || !body.startDate || !body.endDate) {
        res.status(400).json({ error: "Campos obrigatórios: employeeId, adjustmentReasonId, startDate, endDate (YYYY-MM-DD)." });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate)) {
        res.status(400).json({ error: "startDate e endDate devem ser YYYY-MM-DD." });
        return;
      }
      if (body.startDate > body.endDate) {
        res.status(400).json({ error: "startDate não pode ser depois de endDate." });
        return;
      }
      const payload = {
        adjustmentReasonId: body.adjustmentReasonId,
        employeeId: body.employeeId,
        startDate: ymdToMs(body.startDate, false),
        endDate: ymdToMs(body.endDate, true),
        fullDay: body.fullDay === true,
        origem: "API",
        status: "APROVADO",
      };
      const data = await solidesFetch(`${EMPLOYER}/adjustment/register`, { method: "POST", body: JSON.stringify(payload) }, token);
      res.status(200).json({ ok: true, resultado: data, por: usuario.email || usuario.uid });
      return;
    }
    res.status(405).json({ error: "Método não permitido. Use GET ou POST." });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Erro no afastamento." });
  }
}

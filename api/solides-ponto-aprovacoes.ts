// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-ponto-aprovacoes — aprovação de ajustes de ponto na Sólides.
//
//  GET  → lista pendências de aprovação no período (o empregado ajustou no app
//         dele e está aguardando o gestor aprovar):
//         {PUNCH}/daily-activity?startDate={ms}&endDate={ms}&adjustmentList=true
//         Retorna array de EmployeeDTO { id, name, punchs[], adjustments[],
//         pendingPunchs[] }, cada DailyActivityDTO com status PENDING/APPROVED/REPROVED.
//         O cliente normaliza/achata os PENDING.
//  POST → decide um ponto:
//         {PUNCH}/{punchId}/status/{APPROVED|REPROVED}   (PUT na Sólides)
//         body do cliente: { restaurant, punchId, status, observation? }
//
//  Sempre exige Firebase ID token (api/_auth) — escrita em dado trabalhista.
//  O controle por restaurante/permissão "aprovar" é feito no app (perfil de acesso).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const PUNCH = "https://api.tangerino.com.br/api/punch";
const REQ_TIMEOUT_MS = 20_000;
const STATUS_VALIDOS = new Set(["APPROVED", "REPROVED", "PENDING"]);

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
      const ini = String(req.query.startDate ?? "");
      const fim = String(req.query.endDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) {
        res.status(400).json({ error: "startDate e endDate (YYYY-MM-DD) são obrigatórios." });
        return;
      }
      const url = `${PUNCH}/daily-activity?startDate=${ymdToMs(ini, false)}&endDate=${ymdToMs(fim, true)}&adjustmentList=true`;
      const data = await solidesFetch(url, { method: "GET" }, token);
      const employees = Array.isArray(data)
        ? data
        : ((data as { content?: unknown[]; employees?: unknown[] })?.content
          || (data as { employees?: unknown[] })?.employees || []);
      res.status(200).json({ employees });
      return;
    }
    if (method === "POST") {
      const body = (req.body || {}) as { punchId?: number; status?: string; observation?: string };
      const status = String(body.status || "").toUpperCase();
      if (!body.punchId || !STATUS_VALIDOS.has(status)) {
        res.status(400).json({ error: "Campos obrigatórios: punchId, status (APPROVED|REPROVED|PENDING)." });
        return;
      }
      const url = `${PUNCH}/${encodeURIComponent(String(body.punchId))}/status/${status}`;
      const data = await solidesFetch(url, { method: "PUT", body: JSON.stringify({ observation: body.observation || "" }) }, token);
      res.status(200).json({ ok: true, resultado: data, por: usuario.email || usuario.uid });
      return;
    }
    res.status(405).json({ error: "Método não permitido. Use GET ou POST." });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Erro nas aprovações de ponto." });
  }
}

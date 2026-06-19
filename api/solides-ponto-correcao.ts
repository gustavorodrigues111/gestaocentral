// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-ponto-correcao — correções de ponto na Sólides (escrita).
//
//  GET  → lista de justificativas de ponto em atraso ({id, description}).
//         {PUNCH}/manual-editing-justification-punch/  (BARRA FINAL — sem ela = 404)
//  POST → lança ponto em atraso (corrige batida faltante):
//         {PUNCH}/register/late/1.1
//         body do cliente: { restaurant, employeeId, date (ISO offset), justificativaId }
//         A Sólides resolve sozinha se é Entrada ou Saída e pareia. Para saída
//         de madrugada (vira-dia), o cliente manda a data do dia SEGUINTE.
//
//  Sempre exige Firebase ID token (api/_auth) — escrita em dado trabalhista.
//  O controle por restaurante/permissão "corrigir" é feito no app (perfil de acesso).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const PUNCH = "https://api.tangerino.com.br/api/punch";
const REQ_TIMEOUT_MS = 20_000;

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
    catch { return { error: 'SOLIDES_TOKENS com JSON inválido.', status: 500 }; }
    const token = map[restaurantKey];
    if (token) return { token };
    return { error: `Nenhum token Sólides configurado pro restaurante "${restaurantKey}".`, status: 400 };
  }
  const single = process.env.SOLIDES_TOKEN;
  if (single) return { token: single };
  return { error: "Integração Sólides não configurada (SOLIDES_TOKENS).", status: 500 };
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
  const restaurantKey = String(req.query.restaurant ?? (typeof req.body === "object" && req.body ? (req.body as { restaurant?: string }).restaurant : "") ?? "").trim();
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    if (method === "GET") {
      const data = await solidesFetch(`${PUNCH}/manual-editing-justification-punch/`, { method: "GET" }, token);
      const arr = Array.isArray(data) ? data : (data as { content?: unknown[] })?.content || [];
      res.status(200).json({ justificativas: arr });
      return;
    }
    if (method === "POST") {
      const body = (req.body || {}) as {
        action?: string;
        employeeId?: number; date?: string; justificativaId?: number;
        punchId?: number; oldMs?: number; newMs?: number; observation?: string;
        dateIn?: number; dateOut?: number;
      };
      const action = body.action || "late";

      // Editar batida: POST /modify/punch/1.1 (datas em ms epoch).
      if (action === "modify") {
        if (!body.employeeId || !body.punchId || !body.oldMs || !body.newMs) {
          res.status(400).json({ error: "Campos obrigatórios: employeeId, punchId, oldMs, newMs (ms epoch)." });
          return;
        }
        const payload = {
          employeeId: body.employeeId,
          punchId: body.punchId,
          punchOldDateHour: body.oldMs,
          punchNewDateHour: body.newMs,
          observation: body.observation || "",
          user: usuario.email || usuario.uid,
        };
        const data = await solidesFetch(`${PUNCH}/modify/punch/1.1`, { method: "POST", body: JSON.stringify(payload) }, token);
        res.status(200).json({ ok: true, resultado: data, por: usuario.email || usuario.uid });
        return;
      }

      // Excluir batida (bloco): DELETE /punches/{punchId}/employee/{employeeId}?dateIn&dateOut (ms).
      if (action === "delete") {
        if (!body.employeeId || !body.punchId) {
          res.status(400).json({ error: "Campos obrigatórios: employeeId, punchId." });
          return;
        }
        const qs = new URLSearchParams();
        if (typeof body.dateIn === "number") qs.set("dateIn", String(body.dateIn));
        if (typeof body.dateOut === "number") qs.set("dateOut", String(body.dateOut));
        const url = `${PUNCH}/punches/${encodeURIComponent(String(body.punchId))}/employee/${encodeURIComponent(String(body.employeeId))}${qs.toString() ? `?${qs.toString()}` : ""}`;
        const data = await solidesFetch(url, { method: "DELETE" }, token);
        res.status(200).json({ ok: true, resultado: data, por: usuario.email || usuario.uid });
        return;
      }

      // Lançar ponto em atraso (default): POST /register/late/1.1 (a Sólides decide entrada/saída).
      if (!body.employeeId || !body.date || !body.justificativaId) {
        res.status(400).json({ error: "Campos obrigatórios: employeeId, date (ISO offset), justificativaId." });
        return;
      }
      const payload = {
        employeeId: body.employeeId,
        date: body.date,
        manualEditingJustificationId: body.justificativaId,
      };
      const data = await solidesFetch(`${PUNCH}/register/late/1.1`, { method: "POST", body: JSON.stringify(payload) }, token);
      res.status(200).json({ ok: true, resultado: data, por: usuario.email || usuario.uid });
      return;
    }
    res.status(405).json({ error: "Método não permitido. Use GET ou POST." });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Erro na correção de ponto." });
  }
}

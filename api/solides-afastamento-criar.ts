// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-afastamento-criar — CRIA um afastamento no módulo novo da
//  Sólides (Tangerino timeoffwork-api). Atestados médicos e licenças passaram
//  a exigir essa rotina (o /adjustment/register antigo recusa com HTTP 400).
//
//  POST body (do cliente):
//    { restaurant, employee (id Sólides/ponto), timeOffWork (id do tipo),
//      esocialReason (ex "COD_02"), startDate "YYYY-MM-DD", endDate "YYYY-MM-DD",
//      recordType? ("DAYS" default), samePreviousCid? }
//
//  Repassa pro endpoint:
//    POST https://timeoffwork-app.tangerino.com.br/timeoffwork-api/internal/api/v1/timeoffwork
//  com os 2 tokens proprietários (tng-web-token JWT ~24h + tng-client-token),
//  lidos de SOLIDES_TIMEOFFWORK_TOKENS (mesmo do solides-leaves).
//
//  Exige Firebase ID token (write).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const TIMEOFFWORK_API = "https://timeoffwork-app.tangerino.com.br/timeoffwork-api/internal/api/v1/timeoffwork";
const REQ_TIMEOUT_MS = 25_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

type Tokens = { web: string; client: string };
function resolveTokens(restaurantKey: string): { tokens: Tokens } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TIMEOFFWORK_TOKENS;
  if (!mapRaw) return { error: "SOLIDES_TIMEOFFWORK_TOKENS não configurado no Vercel.", status: 500 };
  let map: Record<string, Tokens>;
  try { map = JSON.parse(mapRaw) as Record<string, Tokens>; }
  catch { return { error: "SOLIDES_TIMEOFFWORK_TOKENS com JSON inválido.", status: 500 }; }
  const t = map[restaurantKey];
  if (!t || !t.web || !t.client) return { error: `Sem tokens timeoffwork pra "${restaurantKey}".`, status: 400 };
  return { tokens: t };
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if ((req.method || "GET") !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const b = (req.body || {}) as {
    restaurant?: string; employee?: number | string; timeOffWork?: number | string;
    esocialReason?: string; startDate?: string; endDate?: string; recordType?: string; samePreviousCid?: boolean;
  };
  const restaurantKey = String(b.restaurant ?? "").trim();
  const employee = Number(b.employee);
  const timeOffWork = Number(b.timeOffWork);
  const esocialReason = String(b.esocialReason ?? "").trim();
  const recordType = String(b.recordType ?? "DAYS").trim() || "DAYS";
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!employee || !timeOffWork) { res.status(400).json({ error: "Falta employee ou timeOffWork." }); return; }
  if (!esocialReason) { res.status(400).json({ error: "Falta esocialReason (ex: COD_02)." }); return; }
  if (!ymd.test(b.startDate || "") || !ymd.test(b.endDate || "")) { res.status(400).json({ error: "Datas inválidas (use YYYY-MM-DD)." }); return; }

  const tokensResult = resolveTokens(restaurantKey);
  if ("error" in tokensResult) { res.status(tokensResult.status).json({ error: tokensResult.error }); return; }
  const { tokens } = tokensResult;

  // Meio-dia evita virada de dia por fuso. Para DAYS as horas vão vazias.
  const payload = {
    samePreviousCid: b.samePreviousCid === true,
    employee,
    timeOffWork,
    recordType,
    startDate: `${b.startDate}T12:00:00`,
    endDate: `${b.endDate}T12:00:00`,
    startHour: "",
    endHour: "",
    initPartialHour: "",
    esocialReason,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(TIMEOFFWORK_API, {
      method: "POST",
      headers: {
        "tng-web-token": tokens.web,
        "tng-client-token": tokens.client,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://timeoffwork-web.tangerino.com.br",
        "Referer": "https://timeoffwork-web.tangerino.com.br/",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (resp.status === 401) { res.status(401).json({ error: "Token timeoffwork expirado/ inválido. Atualize SOLIDES_TIMEOFFWORK_TOKENS no Vercel." }); return; }
    if (!resp.ok) {
      let msg = text;
      try { const j = JSON.parse(text) as { message?: string }; if (j?.message) msg = j.message; } catch { /* texto cru */ }
      res.status(502).json({ error: `Sólides retornou HTTP ${resp.status}. ${String(msg).slice(0, 1500)}` });
      return;
    }
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    res.status(200).json({ ok: true, data });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") { res.status(504).json({ error: "Timeout criando o afastamento na Sólides." }); return; }
    res.status(502).json({ error: `Falha de rede: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    clearTimeout(timer);
  }
}

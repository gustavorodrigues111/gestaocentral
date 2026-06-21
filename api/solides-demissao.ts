// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-demissao — demitir empregado na Sólides (módulo employer).
//
//  POST {EMPLOYER}/employee/dismiss
//      body do cliente: { restaurant, employeeId, dismissalDate(YYYY-MM-DD),
//                         reason?, noticeType? }
//  ⚠️ Irreversível. Payload "best-guess" (o DTO exato não está na doc pública) —
//  validar na 1ª demissão real; se a Sólides recusar, NINGUÉM é demitido.
//
//  Exige Firebase ID token. Token por restaurante (SOLIDES_TOKENS).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const EMPLOYER = "https://employer.tangerino.com.br";
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = { method?: string; query: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined>; body?: unknown };
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

// 00:00 America/Sao_Paulo (UTC-3) em ms — via Date.UTC pra não depender do
// parser de string (offset "-0300" sem dois-pontos vira Invalid Date no Node).
function ymdToMs(d: string): number {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd, 3, 0, 0, 0);
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  let usuario;
  try { usuario = await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if ((req.method || "GET") !== "POST") {
    res.status(405).json({ error: "Método não permitido. Use POST." });
    return;
  }
  const body = (req.body || {}) as {
    restaurant?: string; employeeId?: number; dismissalDate?: string; reason?: string; noticeType?: string;
  };
  const restaurantKey = String(body.restaurant ?? "").trim();
  if (!body.employeeId || !body.dismissalDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.dismissalDate)) {
    res.status(400).json({ error: "Obrigatórios: employeeId, dismissalDate (YYYY-MM-DD)." });
    return;
  }
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  // Assinatura: dismiss(String, DismissDTO) — o DTO é @RequestBody (JSON) e há um
  // parâmetro String (provável employeeId na query). Mandamos os dois.
  const dto = { resignationDateInMillis: ymdToMs(body.dismissalDate), employeeId: body.employeeId };
  const qs = new URLSearchParams({ employeeId: String(body.employeeId) });
  const url = `${EMPLOYER}/employee/dismiss?${qs.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(dto),
      signal: ctrl.signal,
    });
    if (resp.status === 401 || resp.status === 403) throw new HttpError(502, "Sólides recusou as credenciais (401/403).");
    const text = await resp.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!resp.ok) throw new HttpError(502, `Sólides HTTP ${resp.status}. URL: ${url} · BODY: ${JSON.stringify(dto)} · RESP: ${String(text).slice(0, 450)}`);
    res.status(200).json({ ok: true, resultado: json, por: usuario.email || usuario.uid });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") { res.status(504).json({ error: "Timeout na demissão (Sólides)." }); return; }
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Erro ao demitir na Sólides." });
  } finally {
    clearTimeout(timer);
  }
}

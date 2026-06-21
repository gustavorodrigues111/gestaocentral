// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-timesheet — espelho de ponto (folha) em PDF, módulo report.
//
//  GET {REPORT}/time-sheet?employeeId&startDate&endDate
//      → { base64FileContent, fileExtension, fileName }  (PDF em base64)
//  Repassa pro cliente pra VISUALIZAR (e baixar opcional). Basic por restaurante.
//
//  Datas YYYY-MM-DD (mesmos filtros da tela de Relatório de folha de ponto).
//  Exige Firebase ID token.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const REPORT = "https://api.tangerino.com.br/api/report";
const REQ_TIMEOUT_MS = 30_000; // gerar PDF pode demorar

type VercelReq = { method?: string; query: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined> };
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

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido. Use GET." });
    return;
  }
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const employeeId = String(req.query.employeeId ?? "").trim();
  const startDate = String(req.query.startDate ?? "").trim();
  const endDate = String(req.query.endDate ?? "").trim();
  if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    res.status(400).json({ error: "Obrigatórios: employeeId, startDate, endDate (YYYY-MM-DD)." });
    return;
  }
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  // Manda datas em YYYY-MM-DD E em millis + showFired (demitido) + identificadores
  // — não sabemos os nomes exatos do report; os que casarem valem, o resto é ignorado.
  const ymdMs = (d: string, end: boolean) => {
    const [y, m, dd] = d.split("-").map(Number);
    return end ? Date.UTC(y, m - 1, dd, 26, 59, 59, 999) : Date.UTC(y, m - 1, dd, 3, 0, 0, 0);
  };
  // Obs.: o report NÃO retorna espelho de DEMITIDO por API (testado vários params).
  // Pra ativo funciona normal.
  const p = new URLSearchParams({
    employeeId, tangerinoId: employeeId,
    startDate, endDate,
    startDateInMillis: String(ymdMs(startDate, false)),
    endDateInMillis: String(ymdMs(endDate, true)),
    showFired: "true",
  });
  const url = `${REPORT}/time-sheet?${p.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (resp.status === 401 || resp.status === 403) throw new HttpError(502, "Sólides recusou as credenciais (401/403).");
    const text = await resp.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!resp.ok) throw new HttpError(502, `Sólides retornou HTTP ${resp.status}. ${String(text).slice(0, 200)}`);
    const obj = (json || {}) as { base64FileContent?: string; fileExtension?: string; fileName?: string };
    if (!obj.base64FileContent) {
      res.status(502).json({ error: "Sólides não retornou o PDF do espelho (base64FileContent vazio)." });
      return;
    }
    res.status(200).json({
      base64: obj.base64FileContent,
      fileExtension: obj.fileExtension || "PDF",
      fileName: obj.fileName || `espelho_${employeeId}_${startDate}_${endDate}.pdf`,
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      res.status(504).json({ error: "Timeout gerando o espelho na Sólides." });
      return;
    }
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Erro ao gerar o espelho." });
  } finally {
    clearTimeout(timer);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Probe: GET /employee-work-schedule/free-work-schedule/find-by-filter
//  Devolve folgas/exceções pontuais cadastradas no mês.
//
//  GET /api/solides-free-schedule?employeeId=N&month=5&year=2026&restaurant=SRC
//    → 200 { data, status, url }
//    → 4xx/5xx { error }
// ════════════════════════════════════════════════════════════════════════════

const BASE_URL = "https://employer.tangerino.com.br/employee-work-schedule/free-work-schedule/find-by-filter";
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

function resolveToken(restaurantKey: string): { token: string } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TOKENS;
  if (!mapRaw) return { error: "SOLIDES_TOKENS não configurado.", status: 500 };
  let map: Record<string, string>;
  try {
    map = JSON.parse(mapRaw) as Record<string, string>;
  } catch {
    return { error: "SOLIDES_TOKENS com JSON inválido.", status: 500 };
  }
  const token = map[restaurantKey];
  if (!token) return { error: `Sem token pra "${restaurantKey}".`, status: 400 };
  return { token };
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const employeeId = String(req.query.employeeId ?? "").trim();
  const month = String(req.query.month ?? "").trim();
  const year = String(req.query.year ?? "").trim();
  if (!employeeId || !month || !year) {
    res.status(400).json({ error: "employeeId, month, year obrigatórios." });
    return;
  }
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  const url = `${BASE_URL}?employeeId=${encodeURIComponent(employeeId)}&month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* keep null */ }
    res.status(200).json({
      url,
      status: resp.status,
      ok: resp.ok,
      bodyPreview: text.slice(0, 1000),
      data: parsed,
    });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : "Erro desconhecido.",
      url,
    });
  } finally {
    clearTimeout(timer);
  }
}

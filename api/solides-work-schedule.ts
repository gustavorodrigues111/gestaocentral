// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — proxy autenticado pro quadro de horários de UM
//  empregado na Sólides (Tangerino):
//    GET https://employer.tangerino.com.br/employee-work-schedule/{employeeId}?date=YYYY-MM-DD
//
//  Devolve o WorkScheduleReturnDTO. Usado pra investigar o formato da resposta
//  antes de implementar a leitura massiva no módulo de Exceções.
//
//  GET /api/solides-work-schedule?employeeId=N&date=YYYY-MM-DD&restaurant=<sc>
//    → 200 { schedule: ..., raw: <resposta crua da Sólides> }
//    → 4xx/5xx { error: string }
// ════════════════════════════════════════════════════════════════════════════

const BASE_URL = "https://employer.tangerino.com.br/employee-work-schedule";
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "HttpError";
  }
}

function resolveToken(restaurantKey: string): { token: string } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TOKENS;
  if (restaurantKey) {
    if (!mapRaw) return { error: "SOLIDES_TOKENS não configurado.", status: 500 };
    let map: Record<string, string>;
    try {
      map = JSON.parse(mapRaw) as Record<string, string>;
    } catch {
      return { error: "SOLIDES_TOKENS com JSON inválido.", status: 500 };
    }
    const token = map[restaurantKey];
    if (token) return { token };
    return {
      error: `Nenhum token pra restaurante "${restaurantKey}".`,
      status: 400,
    };
  }
  const single = process.env.SOLIDES_TOKEN;
  if (single) return { token: single };
  return { error: "Integração Sólides não configurada.", status: 500 };
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido. Use GET." });
    return;
  }

  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const employeeId = String(req.query.employeeId ?? "").trim();
  const date = String(req.query.date ?? "").trim();

  if (!employeeId) {
    res.status(400).json({ error: "employeeId é obrigatório." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date é obrigatório (YYYY-MM-DD)." });
    return;
  }
  // Sólides espera o `date` em epoch ms (Long), não em YYYY-MM-DD.
  const [y, mo, d] = date.split("-").map(Number);
  const dateMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
  if (!Number.isFinite(dateMs)) {
    res.status(400).json({ error: "date inválido." });
    return;
  }

  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  const url = `${BASE_URL}/${encodeURIComponent(employeeId)}?date=${dateMs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${token}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    if (resp.status === 401 || resp.status === 403) {
      throw new HttpError(
        502,
        `Sólides recusou credenciais (HTTP ${resp.status}). Resposta: ${text.slice(0, 200)}`,
      );
    }
    if (resp.status === 404) {
      res.status(200).json({ schedule: null, message: "Empregado sem quadro de horários (404).", raw: null });
      return;
    }
    if (!resp.ok) {
      throw new HttpError(502, `Sólides retornou HTTP ${resp.status}. ${text.slice(0, 300)}`);
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new HttpError(502, `Resposta não-JSON. Primeiros 200 chars: ${text.slice(0, 200)}`);
    }
    res.status(200).json({ schedule: parsed, raw: parsed });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    if (e instanceof Error && e.name === "AbortError") {
      res.status(504).json({ error: `Timeout (${REQ_TIMEOUT_MS / 1000}s).` });
      return;
    }
    res.status(500).json({
      error: e instanceof Error ? e.message : "Erro desconhecido.",
    });
  } finally {
    clearTimeout(timer);
  }
}

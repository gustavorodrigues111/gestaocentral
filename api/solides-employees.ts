// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — proxy autenticado pra LISTA de empregados da Sólides.
//  Endpoint Tangerino: GET https://employer.tangerino.com.br/employee/find-all
//
//  Usado pelo módulo de Exceções como passo prévio pra buscar o quadro de
//  horários de cada empregado (regra de escala vinda direto da Sólides em
//  vez de derivar da escala do Planejamento).
//
//  GET /api/solides-employees?restaurant=<shortCode>&showFired=false
//    → 200 { employees: [{id, name, cpf, externalId?}], totalElements: number }
//    → 4xx/5xx { error: string }
//
//  Usa o MESMO token de SOLIDES_TOKENS{shortCode} usado em solides-punches.ts.
// ════════════════════════════════════════════════════════════════════════════

const EMPLOYEE_API = "https://employer.tangerino.com.br/employee/find-all";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

type SolidesEmployeesPage = {
  content?: unknown[];
  totalPages?: number;
  totalElements?: number;
  last?: boolean;
  number?: number;
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
    if (!mapRaw) {
      return {
        error: "SOLIDES_TOKENS não configurado nas env vars da Vercel.",
        status: 500,
      };
    }
    let map: Record<string, string>;
    try {
      map = JSON.parse(mapRaw) as Record<string, string>;
    } catch {
      return { error: 'SOLIDES_TOKENS com JSON inválido.', status: 500 };
    }
    const token = map[restaurantKey];
    if (token) return { token };
    return {
      error: `Nenhum token Sólides configurado pro restaurante "${restaurantKey}".`,
      status: 400,
    };
  }
  const single = process.env.SOLIDES_TOKEN;
  if (single) return { token: single };
  return { error: "Integração Sólides não configurada.", status: 500 };
}

async function fetchPage(
  token: string,
  page: number,
  showFired: boolean,
): Promise<SolidesEmployeesPage> {
  const url = `${EMPLOYEE_API}?page=${page}&size=${PAGE_SIZE}&showFired=${showFired ? "true" : "false"}`;
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
    if (resp.status === 401 || resp.status === 403) {
      throw new HttpError(
        502,
        `Sólides recusou credenciais no endpoint /employee/find-all (HTTP ${resp.status}). ` +
          "Confirma com o suporte Sólides se o token tem permissão pra esse endpoint.",
      );
    }
    if (resp.status === 404) {
      const body = await resp.text().catch(() => "");
      throw new HttpError(
        502,
        `Endpoint /employee/find-all retornou 404. Resposta: ${body.slice(0, 300)}`,
      );
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new HttpError(502, `Sólides retornou HTTP ${resp.status}. ${body.slice(0, 300)}`);
    }
    const text = await resp.text();
    try {
      return JSON.parse(text) as SolidesEmployeesPage;
    } catch {
      throw new HttpError(
        502,
        `Resposta não-JSON do /employee/find-all (status ${resp.status}). Primeiros 200 chars: ${text.slice(0, 200)}`,
      );
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new HttpError(504, `Timeout (${REQ_TIMEOUT_MS / 1000}s) consultando /employee/find-all.`);
    }
    throw new HttpError(
      502,
      `Falha de rede consultando /employee/find-all: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Método não permitido. Use GET." });
    return;
  }

  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const showFired = String(req.query.showFired ?? "false") === "true";

  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    const employees: unknown[] = [];
    let page = 0;
    let totalElements = 0;
    while (page < MAX_PAGES) {
      const data = await fetchPage(token, page, showFired);
      const content = Array.isArray(data.content) ? data.content : [];
      employees.push(...content);
      totalElements = typeof data.totalElements === "number" ? data.totalElements : employees.length;
      const isLast =
        data.last === true ||
        content.length === 0 ||
        content.length < PAGE_SIZE;
      if (isLast) break;
      page += 1;
    }
    // Normaliza pro shape mais útil pro front
    type Raw = { id?: unknown; externalId?: unknown; name?: unknown; cpf?: unknown };
    const normalized = employees.map((e) => {
      const r = e as Raw;
      return {
        id: typeof r.id === "number" ? r.id : Number(r.id) || null,
        externalId: r.externalId ?? null,
        name: typeof r.name === "string" ? r.name : "",
        cpf: typeof r.cpf === "string" ? r.cpf.replace(/\D/g, "") : "",
      };
    });
    res.status(200).json({ employees: normalized, totalElements: normalized.length, raw: employees.length });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(500).json({
      error: e instanceof Error ? e.message : "Erro desconhecido ao consultar a Sólides.",
    });
  }
}

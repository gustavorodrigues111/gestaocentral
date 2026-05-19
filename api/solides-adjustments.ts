// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — busca AJUSTES (folgas, atestados, abonos, etc) de TODOS
//  os empregados ativos da Sólides em UMA chamada.
//
//  Endpoint Tangerino:
//    GET /v2/adjustments/employees/{employeeId}?startDate=&endDate=&status=APROVADO
//
//  Resposta crua: Array<AdjustmentSuccinctDTO>
//    { id, reason (ex: "FOLGA"), type, status (APROVADO/PENDENTE/REPROVADO),
//      startDate, endDate, recordDate, allDay }
//
//  GET /api/solides-adjustments?restaurant=SRC&startDate=ms&endDate=ms&status=APROVADO
//    → 200 { employees: [...], adjustments: { [empId]: Adjustment[] }, errors,
//            sampleProbe }
// ════════════════════════════════════════════════════════════════════════════

const EMPLOYEE_LIST_API = "https://employer.tangerino.com.br/employee/find-all";
const ADJUSTMENTS_API   = "https://employer.tangerino.com.br/v2/adjustments/employees";
const PAGE_SIZE = 200;
const MAX_PAGES = 20;
const REQ_TIMEOUT_MS = 25_000;

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

async function fetchJsonWithMeta(
  url: string,
  token: string,
): Promise<{ data: unknown; status: number; bodyPreview: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    const bodyPreview = text.slice(0, 200);
    if (resp.status === 404) return { data: null, status: resp.status, bodyPreview };
    if (!resp.ok) {
      throw new HttpError(502, `HTTP ${resp.status} em ${url}. ${bodyPreview}`);
    }
    try {
      return { data: JSON.parse(text), status: resp.status, bodyPreview };
    } catch {
      throw new HttpError(502, `Resposta não-JSON em ${url}: ${bodyPreview}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function listEmployees(token: string): Promise<{ id: number; name: string; cpf: string }[]> {
  const all: { id: number; name: string; cpf: string }[] = [];
  let page = 0;
  while (page < MAX_PAGES) {
    const url = `${EMPLOYEE_LIST_API}?page=${page}&size=${PAGE_SIZE}&showFired=false`;
    const { data } = await fetchJsonWithMeta(url, token);
    if (!data) break;
    const d = data as { content?: unknown[]; last?: boolean };
    const content = Array.isArray(d.content) ? d.content : [];
    type Raw = { id?: unknown; name?: unknown; cpf?: unknown };
    for (const e of content) {
      const r = e as Raw;
      const id = typeof r.id === "number" ? r.id : Number(r.id);
      if (!Number.isFinite(id)) continue;
      all.push({
        id,
        name: typeof r.name === "string" ? r.name : "",
        cpf: typeof r.cpf === "string" ? r.cpf.replace(/\D/g, "") : "",
      });
    }
    if (d.last === true || content.length === 0 || content.length < PAGE_SIZE) break;
    page += 1;
  }
  return all;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  const restaurantKey = String(req.query.restaurant ?? "").trim();
  const startDate = String(req.query.startDate ?? "").trim();
  const endDate = String(req.query.endDate ?? "").trim();
  const status = (String(req.query.status ?? "APROVADO").trim() || "APROVADO");

  if (!/^\d+$/.test(startDate) || !/^\d+$/.test(endDate)) {
    res.status(400).json({ error: "startDate e endDate em ms (Long) são obrigatórios." });
    return;
  }
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    const employees = await listEmployees(token);
    const adjustments: Record<string, unknown[]> = {};
    const errors: { employeeId: number; name: string; error: string }[] = [];
    let sampleProbe: {
      employeeId: number; name: string; url: string;
      status: number; bodyPreview: string; arrayLength: number;
      firstItemKeys?: string[];
    } | null = null;

    const CONCURRENCY = 5;
    let idx = 0;
    async function worker() {
      while (idx < employees.length) {
        const i = idx++;
        const emp = employees[i];
        const url = `${ADJUSTMENTS_API}/${emp.id}?startDate=${startDate}&endDate=${endDate}&status=${encodeURIComponent(status)}`;
        try {
          const meta = await fetchJsonWithMeta(url, token);
          const arr = Array.isArray(meta.data) ? (meta.data as unknown[]) : [];
          adjustments[String(emp.id)] = arr;
          if (!sampleProbe && arr.length > 0) {
            const first = arr[0] as Record<string, unknown> | undefined;
            sampleProbe = {
              employeeId: emp.id,
              name: emp.name,
              url,
              status: meta.status,
              bodyPreview: meta.bodyPreview,
              arrayLength: arr.length,
              firstItemKeys: first ? Object.keys(first) : [],
            };
          }
        } catch (e) {
          errors.push({
            employeeId: emp.id,
            name: emp.name,
            error: e instanceof Error ? e.message : String(e),
          });
          adjustments[String(emp.id)] = [];
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    res.status(200).json({
      employees,
      adjustments,
      count: Object.values(adjustments).reduce((acc, a) => acc + a.length, 0),
      errors,
      sampleProbe,
    });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro desconhecido." });
  }
}

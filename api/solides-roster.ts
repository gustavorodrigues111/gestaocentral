// ════════════════════════════════════════════════════════════════════════════
//  /api/solides-roster — roster CRU de colaboradores da Sólides.
//
//  GET {EMPLOYER}/employee/find-all → lista de colaboradores com os campos que o
//  motor de Análise de Ponto precisa pra apontar FALTA: id, name, workSchedule
//  (id da escala), admissionDate/effectiveDate, fired, firedDate.
//
//  Obs.: em algumas contas esse endpoint retorna vazio — nesse caso FALTA
//  simplesmente não é apontada (o resto da análise segue normal).
//
//  Token por restaurante via SOLIDES_TOKENS. Paginação com de-dup por id.
// ════════════════════════════════════════════════════════════════════════════

const EMPLOYER_API = "https://employer.tangerino.com.br/employee/find-all";
const PAGE_SIZE = 200;
const MAX_PAGES = 50;
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = { method?: string; query: Record<string, string | string[] | undefined> };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };
type SolidesPage = { content?: unknown[]; last?: boolean };

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
    if (!mapRaw) return { error: "SOLIDES_TOKENS não configurado nas env vars da Vercel.", status: 500 };
    let map: Record<string, string>;
    try { map = JSON.parse(mapRaw) as Record<string, string>; }
    catch { return { error: 'SOLIDES_TOKENS com JSON inválido. Esperado: {"SHORTCODE":"token"}.', status: 500 }; }
    const token = map[restaurantKey];
    if (token) return { token };
    return { error: `Nenhum token Sólides configurado pro restaurante "${restaurantKey}".`, status: 400 };
  }
  const single = process.env.SOLIDES_TOKEN;
  if (single) return { token: single };
  return { error: "Integração Sólides não configurada (SOLIDES_TOKENS).", status: 500 };
}

async function fetchPage(token: string, page: number, showFired: boolean): Promise<SolidesPage> {
  const url = `${EMPLOYER_API}?page=${page}&size=${PAGE_SIZE}&showFired=${showFired ? "true" : "false"}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${token}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new HttpError(502, "Sólides recusou as credenciais (401/403). Verifique o token.");
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new HttpError(502, `Sólides retornou HTTP ${resp.status}. ${body.slice(0, 200)}`);
    }
    return (await resp.json()) as SolidesPage;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new HttpError(504, `Timeout consultando a Sólides (${REQ_TIMEOUT_MS / 1000}s).`);
    }
    throw new HttpError(502, `Falha de rede consultando a Sólides: ${e instanceof Error ? e.message : String(e)}`);
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
  const showFired = String(req.query.showFired ?? "true") !== "false"; // inclui demitidos (analyzer respeita firedDate)
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    const out: unknown[] = [];
    const seen = new Set<unknown>();
    let page = 0;
    while (page < MAX_PAGES) {
      const data = await fetchPage(token, page, showFired);
      const content = Array.isArray(data.content) ? data.content : [];
      let novos = 0;
      for (const it of content) {
        const rid = (it as { id?: unknown })?.id;
        if (rid != null) {
          if (seen.has(rid)) continue;
          seen.add(rid);
        }
        out.push(it);
        novos += 1;
      }
      if (data.last === true || content.length === 0 || content.length < PAGE_SIZE || novos === 0) break;
      page += 1;
    }
    res.status(200).json({ employees: out, total: out.length });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : "Erro ao consultar o roster da Sólides." });
  }
}

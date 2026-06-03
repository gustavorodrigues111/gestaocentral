// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — busca AFASTAMENTOS (licenças, atestados de óbito, etc)
//  do módulo "Afastamento" da Sólides (Tangerino timeoffwork-api).
//
//  Por que outro endpoint? A Sólides tem 2 caminhos pra justificar ausência:
//    1) Módulo "Ajustes" antigo → API /v2/adjustments (já consumida por
//       solides-adjustments.ts, usa token Basic)
//    2) Módulo "Afastamento" novo → API timeoffwork-api (esta), usa 2 tokens
//       proprietários: tng-client-token + tng-web-token (JWT 24h)
//
//  Endpoint Tangerino:
//    GET https://timeoffwork-app.tangerino.com.br/timeoffwork-api/internal/api/v1/timeoffwork
//      ?size=N&page=1&status=APROVADO&startDate=...&endDate=...
//
//  Env vars necessárias no Vercel (atualizar quando tng-web-token expirar
//  — ~24h):
//    SOLIDES_TIMEOFFWORK_TOKENS = JSON {"PUB":{"web":"<jwt>","client":"<token>"},...}
//
//  GET /api/solides-leaves?restaurant=PUB&startDateMs=...&endDateMs=...
//    → 200 { leaves: Array<Leave>, count, errors, sampleProbe }
// ════════════════════════════════════════════════════════════════════════════

const TIMEOFFWORK_API = "https://timeoffwork-app.tangerino.com.br/timeoffwork-api/internal/api/v1/timeoffwork";
const PAGE_SIZE = 100;
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

type Tokens = { web: string; client: string };

function resolveTokens(restaurantKey: string): { tokens: Tokens } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TIMEOFFWORK_TOKENS;
  if (!mapRaw) {
    return {
      error: "SOLIDES_TIMEOFFWORK_TOKENS não configurado no Vercel. Adicione um JSON {\"PUB\":{\"web\":\"<jwt>\",\"client\":\"<token>\"}}.",
      status: 500,
    };
  }
  let map: Record<string, Tokens>;
  try {
    map = JSON.parse(mapRaw) as Record<string, Tokens>;
  } catch {
    return { error: "SOLIDES_TIMEOFFWORK_TOKENS com JSON inválido.", status: 500 };
  }
  const t = map[restaurantKey];
  if (!t || !t.web || !t.client) {
    return { error: `Sem tokens timeoffwork pra "${restaurantKey}".`, status: 400 };
  }
  return { tokens: t };
}

async function fetchPage(
  page: number,
  size: number,
  status: string,
  tokens: Tokens,
): Promise<{ data: unknown; httpStatus: number; bodyPreview: string }> {
  // Se status vazio ou "ALL", omite o filtro — pega tudo e o cliente filtra.
  // O status real da timeoffwork não é "APROVADO" (parece ser CIENTE/SINCRONIZADO).
  const statusParam = status && status !== "ALL"
    ? `&status=${encodeURIComponent(status)}`
    : "";
  const url = `${TIMEOFFWORK_API}?size=${size}&total=${size}&page=${page}${statusParam}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "tng-web-token": tokens.web,
        "tng-client-token": tokens.client,
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://timeoffwork-web.tangerino.com.br",
        "Referer": "https://timeoffwork-web.tangerino.com.br/",
      },
      signal: ctrl.signal,
    });
    const text = await resp.text();
    const bodyPreview = text.slice(0, 300);
    if (resp.status === 401) {
      throw new HttpError(401, `Token timeoffwork expirado ou inválido. Atualize SOLIDES_TIMEOFFWORK_TOKENS no Vercel.`);
    }
    if (!resp.ok) {
      throw new HttpError(502, `HTTP ${resp.status} em ${url}. ${bodyPreview}`);
    }
    try {
      return { data: JSON.parse(text), httpStatus: resp.status, bodyPreview };
    } catch {
      throw new HttpError(502, `Resposta não-JSON: ${bodyPreview}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }
  const restaurantKey = String(req.query.restaurant ?? "").trim();
  // Default ALL = busca afastamentos em todos os status (timeoffwork tem
  // chips visuais "ciente/sincronizado/em análise/em desacordo" — a API
  // não aceita "APROVADO" como o /v2/adjustments aceita).
  const status = String(req.query.status ?? "ALL").trim() || "ALL";

  const tokensResult = resolveTokens(restaurantKey);
  if ("error" in tokensResult) {
    res.status(tokensResult.status).json({ error: tokensResult.error });
    return;
  }
  const tokens = tokensResult.tokens;

  try {
    // Pagina pelos afastamentos do status pedido. A API parece retornar
    // tudo em ordem decrescente por data — não filtra por date no servidor,
    // então a gente busca todos os APROVADOs e filtra por range no cliente.
    const allLeaves: unknown[] = [];
    let page = 1;
    let sampleProbe: unknown = null;
    while (page <= MAX_PAGES) {
      const { data, bodyPreview } = await fetchPage(page, PAGE_SIZE, status, tokens);
      const d = data as { content?: unknown[]; totalPages?: number; last?: boolean } | unknown[];
      // A API pode retornar { content: [...] } (formato Spring Page) ou
      // diretamente um array. Detecta os 2 cenários.
      let content: unknown[];
      let last = false;
      if (Array.isArray(d)) {
        content = d;
        last = content.length < PAGE_SIZE;
      } else {
        content = Array.isArray(d.content) ? d.content : [];
        last = d.last === true || content.length < PAGE_SIZE;
      }
      if (page === 1 && content.length > 0) {
        sampleProbe = {
          firstItemKeys: Object.keys(content[0] as Record<string, unknown>),
          firstItem: content[0],
          bodyPreview,
        };
      }
      allLeaves.push(...content);
      if (last || content.length === 0) break;
      page += 1;
    }

    res.status(200).json({
      leaves: allLeaves,
      count: allLeaves.length,
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

// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — proxy autenticado pra API de marcações de ponto da Sólides
//  (Tangerino).
//
//  Cada restaurante tem a SUA própria conta Sólides → o SEU próprio token. Os
//  tokens ficam em env vars da Vercel (SEM prefixo VITE_, nunca vão pro bundle):
//
//    SOLIDES_TOKENS  → JSON mapeando shortCode do restaurante → token Basic.
//                      Ex: {"LOB":"abc123...","SOR":"def456..."}
//    SOLIDES_TOKEN   → token único de fallback (dev / single-tenant), opcional.
//
//  Configure em: Vercel → Project Settings → Environment Variables.
//
//  GET /api/solides-punches?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&restaurant=<shortCode>
//    → 200 { punches: SolidesPunch[], totalElements: number }
//    → 4xx/5xx { error: string }
//
//  Faz paginação automática (segue até `last: true`) contra:
//    GET https://api.tangerino.com.br/api/punch/
//
//  Obs: a pasta /api NÃO entra no tsconfig do projeto (include = ["src"]); a
//  Vercel compila esta function com o runtime Node próprio dela. Por isso os
//  tipos de req/res são declarados inline — zero dependência nova.
// ════════════════════════════════════════════════════════════════════════════

const PUNCH_API = "https://api.tangerino.com.br/api/punch/";
const PAGE_SIZE = 200;
const MAX_PAGES = 50; // trava de segurança (50 × 200 = 10k marcações por restaurante por período)
const REQ_TIMEOUT_MS = 20_000;

// Tipos estruturais mínimos do req/res da Vercel (evita depender de @vercel/node)
type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

type SolidesPage = {
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

// Resolve o token Sólides do restaurante. Cada restaurante tem a sua conta.
//   1) restaurant informado + presente em SOLIDES_TOKENS → usa esse token
//   2) restaurant informado mas ausente do mapa → erro claro (não faz fallback
//      silencioso — consultaria a empresa errada)
//   3) restaurant não informado → cai no SOLIDES_TOKEN único (dev/single-tenant)
function resolveToken(
  restaurantKey: string,
): { token: string } | { error: string; status: number } {
  const mapRaw = process.env.SOLIDES_TOKENS;
  if (restaurantKey) {
    if (!mapRaw) {
      return {
        error:
          "SOLIDES_TOKENS não configurado. Defina o mapa JSON de tokens por restaurante nas env vars da Vercel.",
        status: 500,
      };
    }
    let map: Record<string, string>;
    try {
      map = JSON.parse(mapRaw) as Record<string, string>;
    } catch {
      return {
        error: 'SOLIDES_TOKENS está com JSON inválido. Esperado: {"SHORTCODE":"token"}.',
        status: 500,
      };
    }
    const token = map[restaurantKey];
    if (token) return { token };
    return {
      error: `Nenhum token Sólides configurado pro restaurante "${restaurantKey}". Adicione a chave em SOLIDES_TOKENS.`,
      status: 400,
    };
  }
  const single = process.env.SOLIDES_TOKEN;
  if (single) return { token: single };
  return {
    error:
      "Integração Sólides não configurada. Defina SOLIDES_TOKENS (mapa por restaurante) nas env vars da Vercel.",
    status: 500,
  };
}

// "YYYY-MM-DD" → epoch ms (início ou fim do dia, horário local do servidor)
function ymdToMs(ymd: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  const t = date.getTime();
  return Number.isFinite(t) ? t : null;
}

async function fetchPage(
  token: string,
  startMs: number,
  endMs: number,
  page: number,
): Promise<SolidesPage> {
  const url = `${PUNCH_API}?startDate=${startMs}&endDate=${endMs}&page=${page}&size=${PAGE_SIZE}`;
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
        "Sólides recusou as credenciais (401/403). Verifique o SOLIDES_TOKEN nas env vars da Vercel.",
      );
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
    throw new HttpError(
      502,
      `Falha de rede consultando a Sólides: ${e instanceof Error ? e.message : String(e)}`,
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
  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  const startDate = String(req.query.startDate ?? "");
  const endDate = String(req.query.endDate ?? "");
  const startMs = ymdToMs(startDate, false);
  const endMs = ymdToMs(endDate, true);

  if (startMs == null || endMs == null) {
    res.status(400).json({
      error: "Parâmetros startDate e endDate são obrigatórios no formato YYYY-MM-DD.",
    });
    return;
  }
  if (startMs > endMs) {
    res.status(400).json({ error: "startDate não pode ser depois de endDate." });
    return;
  }

  try {
    const punches: unknown[] = [];
    let page = 0;
    let totalElements = 0;
    const pageSizes: number[] = [];
    const responsesMeta: Array<{ requested: number; number?: number; last?: boolean; totalPages?: number; size: number }> = [];

    // Paginação cautelosa: a API Sólides às vezes ignora o `page` informado e
    // devolve a primeira página repetida (visto em 2026-05). NÃO confiar em
    // `totalPages` pra decidir o fim — paginar até receber explicitamente
    // `last: true` ou uma página parcial (< PAGE_SIZE). Dedupe por id remove
    // as repetições antes de devolver pro front.
    while (page < MAX_PAGES) {
      const data = await fetchPage(token, startMs, endMs, page);
      const content = Array.isArray(data.content) ? data.content : [];
      punches.push(...content);
      pageSizes.push(content.length);
      responsesMeta.push({
        requested: page,
        number: data.number,
        last: data.last,
        totalPages: data.totalPages,
        size: content.length,
      });
      totalElements = typeof data.totalElements === "number" ? data.totalElements : punches.length;

      const isLast =
        data.last === true ||
        content.length === 0 ||
        content.length < PAGE_SIZE;
      if (isLast) break;
      page += 1;
    }

    // ── Dedupe por punch.id ──────────────────────────────────────────────
    // Defesa contra páginas que retornam os mesmos elementos (já visto: API
    // ignorando `page` e devolvendo sempre a 1ª página, o que dobrava todas
    // as durações). Mantém o 1º match e descarta repetições.
    const dedupedById = new Map<unknown, unknown>();
    const noId: unknown[] = [];
    for (const p of punches) {
      const id = (p as { id?: unknown })?.id;
      if (id === null || id === undefined) {
        noId.push(p);
      } else if (!dedupedById.has(id)) {
        dedupedById.set(id, p);
      }
    }
    const dedupedBeforeRange: unknown[] = [...dedupedById.values(), ...noId];
    const duplicatesRemoved = punches.length - dedupedBeforeRange.length;

    // ── Filtra por range de data ────────────────────────────────────────
    // A Sólides às vezes inclui punches do dia anterior ou seguinte (efeito
    // de timezone — servidor Vercel em UTC, Sólides em BRT, 01/05 00:00 UTC =
    // 30/04 21:00 BRT). Descarta punches cujo `date` está fora do range
    // pedido pelo usuário.
    const deduped = dedupedBeforeRange.filter((p) => {
      const d = (p as { date?: unknown })?.date;
      return typeof d === "string" && d >= startDate && d <= endDate;
    });
    const outOfRange = dedupedBeforeRange.length - deduped.length;

    // ── Log de diagnóstico (temporário) ──────────────────────────────────
    // Conta por (date, employeeId) e por status pra ajudar a debugar Bugs
    // de "punches sumindo" e "jornada errada". Visível em Vercel → Logs.
    type Bucket = { date?: unknown; employeeId?: unknown; excluded?: unknown; edited?: unknown; adjustmentReason?: unknown };
    const porDiaEmp: Record<string, number> = {};
    const flags = { excluded: 0, edited: 0, withAdjustment: 0, total: deduped.length };
    for (const p of deduped) {
      const b = p as Bucket;
      const key = `${String(b.date ?? "?")}|${String(b.employeeId ?? "?")}`;
      porDiaEmp[key] = (porDiaEmp[key] || 0) + 1;
      if (b.excluded === true) flags.excluded += 1;
      if (b.edited === true)   flags.edited += 1;
      if (b.adjustmentReason != null) flags.withAdjustment += 1;
    }
    const debug = {
      restaurant: restaurantKey || null,
      range: { startDate, endDate },
      pages: { count: pageSizes.length, sizes: pageSizes },
      responsesMeta,
      totalElementsReported: totalElements,
      raw: punches.length,
      dedupedTotal: deduped.length,
      duplicatesRemoved,
      outOfRange,
      flags,
      perDateEmployee: porDiaEmp,
    };
    console.log(JSON.stringify({ tag: "solides-punches", ...debug }));

    res.status(200).json({ punches: deduped, totalElements: deduped.length, _debug: debug });
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

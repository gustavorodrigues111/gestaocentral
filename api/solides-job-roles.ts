// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — lista TODOS os cargos (job-role) da Sólides.
//  Endpoint Tangerino: GET https://employer.tangerino.com.br/job-role/find-all
//  (paginado — doc oficial). Antes tentamos /job-role direto e dava 404.
//
//  Usado pela aba "Compatibilidade de cadastros" → sub-tab "Cargos" pra
//  comparar Planejamento ↔ Sólides e gerar o mapeamento bidirecional.
//
//  GET /api/solides-job-roles?restaurant=<shortCode>
//    → 200 { items: [{ id, name, externalId? }] }
//    → 4xx/5xx { error: string }
//
//  Usa o MESMO token de SOLIDES_TOKENS{shortCode} usado em solides-employees.ts.
// ════════════════════════════════════════════════════════════════════════════

const JOB_ROLE_API = "https://employer.tangerino.com.br/job-role/find-all";
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

type SolidesJobRolePage = {
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
  if (!mapRaw) return { error: "SOLIDES_TOKENS não configurado.", status: 500 };
  let map: Record<string, string>;
  try {
    map = JSON.parse(mapRaw) as Record<string, string>;
  } catch {
    return { error: "SOLIDES_TOKENS com JSON inválido.", status: 500 };
  }
  const token = map[restaurantKey];
  if (!token) return { error: `Sem token pra restaurante "${restaurantKey}".`, status: 400 };
  return { token };
}

async function fetchPage(token: string, page: number): Promise<SolidesJobRolePage> {
  const url = `${JOB_ROLE_API}?page=${page}&size=${PAGE_SIZE}`;
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
        `Token sem permissão pra ler job-role (HTTP ${resp.status}). Confirma com o suporte Sólides se o token tem escopo de leitura.`,
      );
    }
    if (resp.status >= 500) {
      throw new HttpError(502, `Sólides indisponível (HTTP ${resp.status}).`);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new HttpError(502, `Sólides retornou HTTP ${resp.status}. ${body.slice(0, 300)}`);
    }
    const text = await resp.text();
    try {
      // Tangerino retorna array direto OU page-object. Normaliza pra page-object.
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return { content: parsed, last: true };
      }
      return parsed as SolidesJobRolePage;
    } catch {
      throw new HttpError(
        502,
        `Resposta não-JSON do /job-role (status ${resp.status}). Primeiros 200 chars: ${text.slice(0, 200)}`,
      );
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new HttpError(504, `Timeout (${REQ_TIMEOUT_MS / 1000}s) consultando /job-role.`);
    }
    throw new HttpError(
      502,
      `Falha de rede consultando /job-role: ${e instanceof Error ? e.message : String(e)}`,
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
  if (!restaurantKey) {
    res.status(400).json({ error: "Informe restaurant=<shortCode>." });
    return;
  }

  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  try {
    const itemsRaw: unknown[] = [];
    let page = 0;
    while (page < MAX_PAGES) {
      const data = await fetchPage(token, page);
      const content = Array.isArray(data.content) ? data.content : [];
      itemsRaw.push(...content);
      const isLast =
        data.last === true ||
        content.length === 0 ||
        content.length < PAGE_SIZE;
      if (isLast) break;
      page += 1;
    }
    // A Sólides pode usar diferentes nomes de campo pro "nome do cargo".
    // Visto: name, description, nome, jobRoleName, roleName. Tenta nessa ordem.
    function extractName(r: Record<string, unknown>): string {
      const candidates = ["name", "description", "nome", "jobRoleName", "roleName", "title"];
      for (const k of candidates) {
        const v = r[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    }
    type Raw = Record<string, unknown> & { id?: unknown; externalId?: unknown };
    const items = itemsRaw
      .map((e) => {
        const r = e as Raw;
        const id = typeof r.id === "number" ? r.id : Number(r.id);
        if (!Number.isFinite(id)) return null;
        return {
          id,
          name: extractName(r),
          externalId: r.externalId == null ? undefined : String(r.externalId),
        };
      })
      .filter((x): x is { id: number; name: string; externalId?: string } => x !== null);
    // Debug: expõe as chaves do primeiro item raw pra UI mostrar quando os
    // nomes vierem vazios. Útil pra identificar se a Sólides usa outro
    // campo (description, nome, etc).
    const sampleKeys = itemsRaw.length > 0 && itemsRaw[0] && typeof itemsRaw[0] === "object"
      ? Object.keys(itemsRaw[0] as object)
      : [];
    res.status(200).json({ items, _sampleKeys: sampleKeys, _sampleRaw: itemsRaw[0] || null });
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

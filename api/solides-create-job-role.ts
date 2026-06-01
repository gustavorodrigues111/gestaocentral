// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — cria um cargo (job-role) na Sólides.
//  Endpoint Tangerino: POST https://employer.tangerino.com.br/job-role/register
//
//  Body JSON aceito:
//    { restaurant: "SHORTCODE", name: string, externalId?: string }
//
//  Resposta:
//    → 200/201 { id, name, externalId? } (JSON cru da Sólides)
//    → 4xx/5xx { error, status }
//
//  Usa o MESMO token de SOLIDES_TOKENS{shortCode} usado em solides-employees.ts.
// ════════════════════════════════════════════════════════════════════════════

const JOB_ROLE_REGISTER_API = "https://employer.tangerino.com.br/job-role/register";
const REQ_TIMEOUT_MS = 25_000;

type VercelReq = {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
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
  if (!token) return { error: `Sem token pra restaurante "${restaurantKey}".`, status: 400 };
  return { token };
}

function parseBody(req: VercelReq): Record<string, unknown> {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof b === "object") return b as Record<string, unknown>;
  return {};
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido. Use POST." });
    return;
  }

  const body = parseBody(req);
  const restaurantKey = String(body.restaurant ?? "").trim();
  const name = String(body.name ?? "").trim();
  const externalIdRaw = body.externalId;
  const externalId =
    externalIdRaw == null || externalIdRaw === "" ? undefined : String(externalIdRaw);

  if (!restaurantKey) {
    res.status(400).json({ error: "Informe restaurant=<shortCode>." });
    return;
  }
  if (!name) {
    res.status(400).json({ error: "Campo 'name' é obrigatório e não pode ser vazio." });
    return;
  }

  const tokenResult = resolveToken(restaurantKey);
  if ("error" in tokenResult) {
    res.status(tokenResult.status).json({ error: tokenResult.error });
    return;
  }
  const token = tokenResult.token;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);

  try {
    const payload: { name: string; externalId?: string } = { name };
    if (externalId) payload.externalId = externalId;

    const resp = await fetch(JOB_ROLE_REGISTER_API, {
      method: "POST",
      headers: {
        Authorization: `Basic ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await resp.text();

    if (resp.status === 401 || resp.status === 403) {
      res.status(502).json({
        error: `Token sem permissão pra escrever job-role (HTTP ${resp.status}). Precisa do escopo de escrita do contrato.`,
        status: resp.status,
      });
      return;
    }
    if (resp.status >= 500) {
      res.status(502).json({
        error: `Sólides indisponível (HTTP ${resp.status}). ${text.slice(0, 200)}`,
        status: resp.status,
      });
      return;
    }
    if (!resp.ok) {
      res.status(502).json({
        error: `Sólides retornou HTTP ${resp.status}. ${text.slice(0, 300)}`,
        status: resp.status,
      });
      return;
    }

    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        res.status(502).json({
          error: `Resposta não-JSON do /job-role/register (status ${resp.status}). Primeiros 200 chars: ${text.slice(0, 200)}`,
          status: resp.status,
        });
        return;
      }
    }
    res.status(200).json(parsed);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      res.status(504).json({ error: `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao criar job-role.` });
      return;
    }
    res.status(502).json({
      error: `Falha de rede criando job-role: ${e instanceof Error ? e.message : String(e)}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

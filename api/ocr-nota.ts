// ════════════════════════════════════════════════════════════════════════════
//  /api/ocr-nota — extrai dados de uma nota fiscal (imagem ou PDF) via Claude
//  vision (Haiku, barato). Devolve { emissor, valorTotal, dataEmissao } pra
//  PRÉ-PREENCHER o form — o usuário confere e corrige antes de salvar.
//
//  POST body: { data: <base64 sem prefixo>, mediaType: "image/jpeg"|"image/png"|
//               "image/webp"|"application/pdf" }
//  Exige Firebase ID token. Chave Anthropic em env var ANTHROPIC_API_KEY.
//
//  Segue o padrão das outras functions deste projeto (fetch cru; a pasta /api
//  roda num runtime próprio fora do tsconfig).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5"; // barato; trocar pra claude-sonnet-4-6 se errar muito
const REQ_TIMEOUT_MS = 30_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const PROMPT =
  "Você recebe a imagem/PDF de uma nota fiscal brasileira. Extraia APENAS estes campos e responda " +
  "SOMENTE um objeto JSON, sem texto antes ou depois:\n" +
  '{"emissor": <razão social ou nome do fornecedor que EMITIU a nota, string ou null>, ' +
  '"valorTotal": <valor TOTAL da nota em reais como NÚMERO, ex 1234.56, sem "R$" e sem separador de milhar, ou null>, ' +
  '"dataEmissao": <data de emissão no formato YYYY-MM-DD, ou null>}\n' +
  "Se não tiver certeza de um campo, use null. Não invente valores.";

function parseNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = parseFloat(t);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if ((req.method || "GET") !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (req.body || {}) as { data?: string; mediaType?: string };
  const data = typeof body.data === "string" ? body.data : "";
  const mediaType = String(body.mediaType || "");
  if (!data) { res.status(400).json({ error: "Falta o arquivo (data base64)." }); return; }

  const isPdf = mediaType === "application/pdf";
  const docBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data } };

  const payload = {
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: "user", content: [docBlock, { type: "text", text: PROMPT }] }],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
    const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) { res.status(200).json({ emissor: null, valorTotal: null, dataEmissao: null, _raw: textOut.slice(0, 200) }); return; }
    let parsed: { emissor?: unknown; valorTotal?: unknown; dataEmissao?: unknown } = {};
    try { parsed = JSON.parse(m[0]); } catch { /* devolve vazio abaixo */ }
    const emissor = typeof parsed.emissor === "string" && parsed.emissor.trim() ? parsed.emissor.trim() : null;
    const valorTotal = parseNum(parsed.valorTotal) ?? null;
    const dataEmissao = typeof parsed.dataEmissao === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.dataEmissao) ? parsed.dataEmissao : null;
    res.status(200).json({ emissor, valorTotal, dataEmissao });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") { res.status(504).json({ error: "Timeout lendo a nota." }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro ao ler a nota." });
  } finally {
    clearTimeout(timer);
  }
}

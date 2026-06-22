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
  "Você recebe a imagem/PDF de uma nota fiscal brasileira. Extraia os campos abaixo e responda " +
  "SOMENTE um objeto JSON (sem texto antes ou depois). Números em reais como NÚMERO (ex 1234.56), " +
  'sem "R$" e sem separador de milhar. Se não tiver certeza de um campo, use null. NÃO invente valores.\n' +
  "{\n" +
  '  "emissor": <razão social/nome do fornecedor que EMITIU a nota, ou null>,\n' +
  '  "cnpjEmissor": <CNPJ do emissor só com dígitos, ou null>,\n' +
  '  "numeroNota": <número da NF, ou null>,\n' +
  '  "serieNota": <série da NF, ou null>,\n' +
  '  "chaveAcesso": <chave de acesso de 44 dígitos, só números, ou null>,\n' +
  '  "valorProdutos": <subtotal dos produtos antes de frete/desconto, ou null>,\n' +
  '  "valorTotal": <valor TOTAL da nota, ou null>,\n' +
  '  "valorImpostos": <total de tributos/impostos, ou null>,\n' +
  '  "dataEmissao": <data de emissão em YYYY-MM-DD, ou null>,\n' +
  '  "itens": [<{"descricao": str, "quantidade": num, "unidade": str, "valorUnitario": num, "valorTotal": num}>, ...] ou []\n' +
  "}";

function parseNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = parseFloat(t);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function digits(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\D/g, "") : (typeof v === "number" ? String(v) : "");
  return s || null;
}
function parseItens(v: unknown): ItemNotaOut[] {
  if (!Array.isArray(v)) return [];
  const out: ItemNotaOut[] = [];
  for (const it of v.slice(0, 200)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const item: ItemNotaOut = {};
    const d = str(o.descricao); if (d) item.descricao = d;
    const q = parseNum(o.quantidade); if (q != null) item.quantidade = q;
    const u = str(o.unidade); if (u) item.unidade = u;
    const vu = parseNum(o.valorUnitario); if (vu != null) item.valorUnitario = vu;
    const vt = parseNum(o.valorTotal); if (vt != null) item.valorTotal = vt;
    if (Object.keys(item).length) out.push(item);
  }
  return out;
}
type ItemNotaOut = { descricao?: string; quantidade?: number; unidade?: string; valorUnitario?: number; valorTotal?: number };

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
    if (!m) { res.status(200).json({ emissor: null, valorTotal: null, dataEmissao: null, itens: [], _raw: textOut.slice(0, 200) }); return; }
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(m[0]) as Record<string, unknown>; } catch { /* devolve vazio abaixo */ }
    res.status(200).json({
      emissor: str(p.emissor),
      cnpjEmissor: digits(p.cnpjEmissor),
      numeroNota: str(p.numeroNota) ?? (parseNum(p.numeroNota) != null ? String(parseNum(p.numeroNota)) : null),
      serieNota: str(p.serieNota) ?? (parseNum(p.serieNota) != null ? String(parseNum(p.serieNota)) : null),
      chaveAcesso: digits(p.chaveAcesso),
      valorProdutos: parseNum(p.valorProdutos) ?? null,
      valorTotal: parseNum(p.valorTotal) ?? null,
      valorImpostos: parseNum(p.valorImpostos) ?? null,
      dataEmissao: typeof p.dataEmissao === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.dataEmissao) ? p.dataEmissao : null,
      itens: parseItens(p.itens),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") { res.status(504).json({ error: "Timeout lendo a nota." }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro ao ler a nota." });
  } finally {
    clearTimeout(timer);
  }
}

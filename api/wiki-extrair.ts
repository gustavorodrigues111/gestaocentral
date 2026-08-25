// ════════════════════════════════════════════════════════════════════════════
//  /api/wiki-extrair — extrai o TEXTO de um documento (PDF ou imagem) pra virar
//  base de conhecimento do agente da Wiki. Recebe a URL do arquivo já no Storage,
//  baixa, manda pro Claude transcrever fielmente e devolve { texto }. NÃO grava
//  nada. Exige Firebase ID token. Chave em ANTHROPIC_API_KEY.
//  (HTML/TXT são extraídos no cliente; docx/outros entram por "colar texto".)
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 300 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const IA_TIMEOUT_MS = 285_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const PROMPT =
  "Transcreva FIELMENTE todo o texto deste documento, em texto puro. " +
  "Mantenha a ordem, os títulos, as seções, listas e numerações. " +
  "Se for um formulário ou modelo, transcreva os rótulos e os campos como aparecem. " +
  "NÃO resuma, NÃO comente, NÃO adicione nada — devolva apenas o conteúdo textual do documento.";

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { fileUrl?: string; mime?: string } | null;
  const fileUrl = (body?.fileUrl || "").toString();
  const mime = (body?.mime || "").toString().toLowerCase();
  if (!/^https?:\/\//.test(fileUrl)) { res.status(400).json({ error: "fileUrl inválida." }); return; }
  const ehPdf = mime.includes("pdf") || /\.pdf(\?|$)/i.test(fileUrl);
  const ehImg = mime.startsWith("image/");
  if (!ehPdf && !ehImg) { res.status(400).json({ error: "Só extraio texto de PDF ou imagem. Para outros formatos, cole o texto." }); return; }

  // Download com teto curto próprio (se travar aqui é rede/Storage, não a IA).
  const dlCtrl = new AbortController();
  const dlTimer = setTimeout(() => dlCtrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let b64: string; let mediaType: string;
  try {
    const pr = await fetch(fileUrl, { signal: dlCtrl.signal });
    if (!pr.ok) { res.status(502).json({ error: `Não consegui baixar o arquivo (HTTP ${pr.status}).` }); return; }
    const buf = Buffer.from(await pr.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) { res.status(413).json({ error: "Arquivo muito grande (máx 25MB)." }); return; }
    b64 = buf.toString("base64");
    mediaType = ehPdf ? "application/pdf" : (mime || "image/jpeg");
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${DOWNLOAD_TIMEOUT_MS / 1000}s) ao baixar o arquivo.` : (e instanceof Error ? e.message : "Falha ao baixar o arquivo.");
    res.status(502).json({ error: msg }); return;
  } finally { clearTimeout(dlTimer); }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IA_TIMEOUT_MS);
  try {
    const bloco = ehPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 16000, thinking: { type: "adaptive" },
        messages: [{ role: "user", content: [bloco, { type: "text", text: PROMPT }] }],
      }),
      signal: ctrl.signal,
    });
    const t = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude HTTP ${resp.status}. ${t.slice(0, 200)}` }); return; }
    const j = JSON.parse(t) as { content?: Array<{ type?: string; text?: string }> };
    const texto = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
    if (!texto) { res.status(502).json({ error: "Não consegui extrair texto do arquivo." }); return; }
    res.status(200).json({ texto });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${IA_TIMEOUT_MS / 1000}s) ao extrair o texto.` : (e instanceof Error ? e.message : "Falha ao extrair o texto.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

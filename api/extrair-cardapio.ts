// ════════════════════════════════════════════════════════════════════════════
//  /api/extrair-cardapio — lê um CARDÁPIO em PDF e devolve os itens vendáveis
//  com preço (lista "sombra" que alimenta o vínculo de preços das fichas
//  técnicas). NÃO grava nada; a revisão/gravação é no cliente. Exige Firebase
//  ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const PROMPT =
  "Você recebe o PDF de um CARDÁPIO de restaurante (pode estar diagramado, com seções, imagens e preços). " +
  "Extraia CADA item VENDÁVEL com seu preço e a SEÇÃO em que ele aparece. Regras:\n" +
  "1) titulo = o nome do prato/bebida EXATAMENTE como aparece no cardápio (sem a descrição).\n" +
  "2) preco = o texto do preço como aparece (ex: '45', 'R$ 45,00', '32'). Se o item não tiver preço visível, use \"\".\n" +
  "3) secao = o nome do cabeçalho/categoria sob o qual o item aparece (ex: 'ENTRADAS', 'PRATOS PRINCIPAIS', 'DRINKS', 'SOBREMESAS', 'VINHOS TINTOS'). Use EXATAMENTE o texto do cabeçalho da seção. Se o item não estiver sob nenhuma seção clara, use \"\".\n" +
  "4) NÃO trate os cabeçalhos de seção como itens; eles só preenchem o campo 'secao' dos itens abaixo deles. IGNORE textos decorativos, observações ('consulte o garçom') e logos.\n" +
  "5) Se um mesmo prato tiver vários tamanhos/preços, gere uma linha por tamanho, com o tamanho no titulo (ex: 'CHOPP 300ml'), repetindo a mesma secao.\n" +
  "6) NÃO invente itens, preços nem seções. Se não der pra ler, omita.\n\n" +
  "Responda SOMENTE um objeto JSON (sem texto antes/depois): { \"itens\": [ { \"titulo\": \"...\", \"preco\": \"...\", \"secao\": \"...\" } ] }";

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { pdfUrl?: string } | null;
  const pdfUrl = (body?.pdfUrl || "").toString();
  if (!/^https?:\/\//.test(pdfUrl)) { res.status(400).json({ error: "pdfUrl inválida." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    // Baixa o PDF do Storage e converte pra base64.
    const pr = await fetch(pdfUrl, { signal: ctrl.signal });
    if (!pr.ok) { res.status(502).json({ error: `Não consegui baixar o PDF (HTTP ${pr.status}).` }); return; }
    const buf = Buffer.from(await pr.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) { res.status(413).json({ error: "PDF muito grande (máx 25MB)." }); return; }
    const b64 = buf.toString("base64");

    const payload = {
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        { type: "text", text: PROMPT },
      ] }],
    };
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
    const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) { res.status(502).json({ error: "A IA não retornou JSON." }); return; }
    const parsed = JSON.parse(m[0]) as { itens?: Array<{ titulo?: string; preco?: string; secao?: string }> };
    const itens = (Array.isArray(parsed.itens) ? parsed.itens : [])
      .filter((i) => i && typeof i.titulo === "string" && i.titulo.trim())
      .map((i) => ({ titulo: String(i.titulo).trim(), preco: (i.preco ?? "").toString().trim(), secao: (i.secao ?? "").toString().trim() }));
    res.status(200).json({ itens });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) na leitura do PDF.` : (e instanceof Error ? e.message : "Falha ao processar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

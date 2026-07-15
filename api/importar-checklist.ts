// ════════════════════════════════════════════════════════════════════════════
//  /api/importar-checklist — lê um CHECKLIST em FOTO ou PDF e devolve o nome +
//  a lista de itens estruturados (texto, obrigatório, como-fazer). NÃO grava
//  nada; a revisão/gravação é no cliente. Exige Firebase ID token. Planilha é
//  lida no cliente (SheetJS) sem passar por aqui. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const PROMPT =
  "Você recebe um CHECKLIST operacional de restaurante (pode ser foto de um cartaz/folha plastificada, print, ou PDF). " +
  "Extraia o NOME do checklist e a LISTA DE ITENS (tarefas). Para CADA item:\n" +
  "1) texto = a tarefa, curta e clara (ex: 'Limpar a chapa', 'Conferir temperatura da câmara').\n" +
  "2) obrigatorio = true se o item é essencial/crítico (segurança, higiene/food safety, dinheiro, algo que não pode faltar); false pros demais. Na dúvida, true.\n" +
  "3) descricao = instrução de COMO FAZER, só se o documento trouxer detalhe/explicação do item; senão \"\".\n" +
  "4) periodicidade = se o documento indicar de quanto em quanto tempo o item é feito (coluna 'Periodicidade', 'Frequência', ou anotação ao lado), copie o TEXTO EXATO como está escrito (ex: 'SEMANAL', 'DIA SIM DIA NÃO', 'QUINZENAL', '2X NA SEMANA', 'MENSAL', '1 X semana'). Se o item não tiver periodicidade indicada, use \"\".\n" +
  "Regras: IGNORE cabeçalhos decorativos, logos e rodapés. NÃO invente itens nem periodicidades. Mantenha a ordem do documento.\n\n" +
  "Responda SOMENTE um objeto JSON (sem texto antes/depois): { \"nome\": \"...\", \"itens\": [ { \"texto\": \"...\", \"obrigatorio\": true, \"descricao\": \"...\", \"periodicidade\": \"...\" } ] }";

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
  const mime = (body?.mime || "").toString();
  if (!/^https?:\/\//.test(fileUrl)) { res.status(400).json({ error: "fileUrl inválida." }); return; }
  const ehPdf = mime === "application/pdf" || /\.pdf($|\?)/i.test(fileUrl);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const fr = await fetch(fileUrl, { signal: ctrl.signal });
    if (!fr.ok) { res.status(502).json({ error: `Não consegui baixar o arquivo (HTTP ${fr.status}).` }); return; }
    const buf = Buffer.from(await fr.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) { res.status(413).json({ error: "Arquivo muito grande (máx 25MB)." }); return; }
    const b64 = buf.toString("base64");
    const mediaType = ehPdf ? "application/pdf" : (mime && mime.startsWith("image/") ? mime : "image/jpeg");
    const bloco = ehPdf
      ? { type: "document", source: { type: "base64", media_type: mediaType, data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };

    const payload = {
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: "user", content: [bloco, { type: "text", text: PROMPT }] }],
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
    const parsed = JSON.parse(m[0]) as { nome?: string; itens?: Array<{ texto?: string; obrigatorio?: boolean; descricao?: string; periodicidade?: string }> };
    const itens = (Array.isArray(parsed.itens) ? parsed.itens : [])
      .filter((i) => i && typeof i.texto === "string" && i.texto.trim())
      .map((i) => ({ texto: String(i.texto).trim(), obrigatorio: i.obrigatorio !== false, descricao: (i.descricao ?? "").toString().trim(), periodicidade: (i.periodicidade ?? "").toString().trim() }));
    res.status(200).json({ nome: (parsed.nome || "").toString().trim(), itens });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) na leitura.` : (e instanceof Error ? e.message : "Falha ao processar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

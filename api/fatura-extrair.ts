// ════════════════════════════════════════════════════════════════════════════
//  /api/fatura-extrair — lê uma FATURA de cartão em PDF e devolve os lançamentos
//  estruturados (data, descrição, valor, parcela) + vencimento + total da
//  fatura. NÃO grava nada; a classificação/gravação é no cliente. Exige Firebase
//  ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function montarPrompt(cartoes: string[]): string {
  const listaCartoes = cartoes.length
    ? "8) cartao = identifique de QUAL cartão é esta fatura, escolhendo EXATAMENTE UM desta lista cadastrada: " + JSON.stringify(cartoes) +
      ". Use a bandeira (Mastercard/Visa/Elo), o banco/emissor e os 4 últimos dígitos que aparecem no PDF pra casar. Retorne a string idêntica à da lista. Se nenhum casar com confiança, retorne null.\n"
    : "8) cartao = null (nenhum cartão cadastrado pra casar).\n";
  return "Você recebe o PDF de uma FATURA de cartão de crédito (Itaú, Santander, etc). Extraia TODOS os lançamentos e os dados da fatura. Regras:\n" +
  "1) Para CADA lançamento (compra, estorno, encargo, anuidade, IOF): data ('DD/MM'), descricao (nome do estabelecimento, SEM o código de parcela grudado), valor (número), parcela.\n" +
  "2) valor = número em reais. Use ponto decimal. ESTORNOS/CRÉDITOS/PAGAMENTOS a favor do cliente = valor NEGATIVO. Ex: '1.977,50' → 1977.50 ; '-30,98' → -30.98.\n" +
  "3) parcela = se a descrição tiver marca de parcela (ex: 'MURR CADEIRAS LTDA03/03', 'AGP*BARFACIL*T08/12'), extraia como '03/03' / '08/12' e TIRE ela da descricao. Se não for parcelado, parcela = null.\n" +
  "4) NÃO inclua linhas de resumo/subtotal ('Total desta fatura', 'Lançamentos atuais', 'Total da fatura anterior', 'Pagamento efetuado'), nem textos legais/instruções. SÓ os lançamentos reais.\n" +
  "5) vencimento = data de vencimento da fatura no formato 'YYYY-MM-DD'.\n" +
  "6) totalFatura = o valor do 'Total desta fatura' (número, ponto decimal).\n" +
  "7) NÃO invente nada. Se um campo não existir, use null.\n" +
  listaCartoes +
  "\nResponda SOMENTE um objeto JSON (sem texto antes/depois): { \"cartao\": \"...\"|null, \"vencimento\": \"YYYY-MM-DD\"|null, \"totalFatura\": number|null, \"lancamentos\": [ { \"data\": \"DD/MM\", \"descricao\": \"...\", \"valor\": number, \"parcela\": \"XX/YY\"|null } ] }";
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { pdfUrl?: string; cartoes?: string[] } | null;
  const pdfUrl = (body?.pdfUrl || "").toString();
  if (!/^https?:\/\//.test(pdfUrl)) { res.status(400).json({ error: "pdfUrl inválida." }); return; }
  const cartoes = Array.isArray(body?.cartoes) ? body!.cartoes.filter((c) => typeof c === "string" && c.trim()).slice(0, 20) : [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const pr = await fetch(pdfUrl, { signal: ctrl.signal });
    if (!pr.ok) { res.status(502).json({ error: `Não consegui baixar o PDF (HTTP ${pr.status}).` }); return; }
    const buf = Buffer.from(await pr.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) { res.status(413).json({ error: "PDF muito grande (máx 25MB)." }); return; }
    const b64 = buf.toString("base64");

    const payload = {
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        { type: "text", text: montarPrompt(cartoes) },
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
    const parsed = JSON.parse(m[0]) as { cartao?: string | null; vencimento?: string | null; totalFatura?: number | null; lancamentos?: Array<{ data?: string; descricao?: string; valor?: number; parcela?: string | null }> };
    const lancamentos = (Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [])
      .filter((l) => l && typeof l.descricao === "string" && l.descricao.trim() && typeof l.valor === "number")
      .map((l) => ({ data: String(l.data || "").trim(), descricao: String(l.descricao).trim(), valor: Number(l.valor), parcela: l.parcela ? String(l.parcela).trim() : null }));
    // Só aceita cartão se casar (case-insensitive) com um dos cadastrados.
    const cartaoDetectado = typeof parsed.cartao === "string"
      ? (cartoes.find((c) => c.toLowerCase() === parsed.cartao!.toLowerCase().trim()) || null)
      : null;
    res.status(200).json({ cartao: cartaoDetectado, vencimento: parsed.vencimento || null, totalFatura: typeof parsed.totalFatura === "number" ? parsed.totalFatura : null, lancamentos });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) na leitura do PDF.` : (e instanceof Error ? e.message : "Falha ao processar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

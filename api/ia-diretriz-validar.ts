// ════════════════════════════════════════════════════════════════════════════
//  /api/ia-diretriz-validar — antes de adicionar um NOVO bloco de diretriz da IA,
//  checa contra os blocos existentes: se contradiz algum, se é redundante, ou se
//  complementa (ok). NÃO grava nada. Exige Firebase ID token. ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function montarPrompt(nova: string, existentes: string[]): string {
  const lista = existentes.length
    ? existentes.map((d, i) => `[${i}] ${d}`).join("\n")
    : "(ainda não há diretrizes)";
  return (
    "Você mantém as DIRETRIZES de uma assistente de IA interna (o que ela pode/não pode responder numa plataforma de gestão de restaurantes). As diretrizes são BLOCOS independentes que NÃO podem se contradizer. " +
    "Recebo uma NOVA diretriz e preciso saber se ela pode ser adicionada.\n\n" +
    "DIRETRIZES EXISTENTES:\n" + lista + "\n\n" +
    "NOVA DIRETRIZ:\n\"" + nova + "\"\n\n" +
    "Avalie:\n" +
    "- \"contradiz\": a nova entra em conflito lógico com uma ou mais existentes (uma permite o que a outra proíbe, ou vice-versa). Liste os índices em conflitos.\n" +
    "- \"redundante\": a nova já está coberta por uma existente (mesmo sentido). Liste o(s) índice(s) em conflitos.\n" +
    "- \"ok\": a nova complementa sem conflito nem redundância.\n" +
    "Seja criterioso: só marque contradiz se houver conflito REAL. Diferença de tema não é conflito.\n\n" +
    "Responda SOMENTE um objeto JSON: { \"veredito\": \"ok\"|\"contradiz\"|\"redundante\", \"explicacao\": \"<1-2 frases, em pt-BR>\", \"conflitos\": [<índices>] }"
  );
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { nova?: string; existentes?: string[] } | null;
  const nova = (body?.nova || "").toString().trim().slice(0, 2000);
  if (nova.length < 3) { res.status(400).json({ error: "Diretriz vazia." }); return; }
  const existentes = (Array.isArray(body?.existentes) ? body!.existentes : [])
    .filter((d): d is string => typeof d === "string" && !!d.trim()).map((d) => d.trim().slice(0, 2000)).slice(0, 60);

  if (existentes.length === 0) { res.status(200).json({ veredito: "ok", explicacao: "Primeira diretriz — nada pra conflitar.", conflitos: [] }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = {
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: [{ type: "text", text: montarPrompt(nova, existentes) }] }],
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
    const parsed = JSON.parse(m[0]) as { veredito?: string; explicacao?: string; conflitos?: unknown };
    const veredito = parsed.veredito === "contradiz" || parsed.veredito === "redundante" ? parsed.veredito : "ok";
    const conflitos = Array.isArray(parsed.conflitos)
      ? parsed.conflitos.filter((n): n is number => typeof n === "number" && n >= 0 && n < existentes.length)
      : [];
    res.status(200).json({ veredito, explicacao: String(parsed.explicacao || "").trim().slice(0, 500), conflitos });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao validar.` : (e instanceof Error ? e.message : "Falha ao validar a diretriz.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

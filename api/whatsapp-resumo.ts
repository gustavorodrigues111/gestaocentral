// ════════════════════════════════════════════════════════════════════════════
//  /api/whatsapp-resumo — resumo de um atendimento de WhatsApp pra repassar.
//  Recebe o contato + as mensagens da conversa; o Claude devolve um resumo curto
//  e prático (o que o cliente quer, status, o que falta) pra outra pessoa assumir.
//  NÃO grava nada. Exige Firebase ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 30 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 28_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

type MsgIn = { de?: string; texto?: string };
type ContatoIn = { nome?: string; telefone?: string; info?: string };

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

function montarPrompt(contato: ContatoIn, mensagens: MsgIn[]): string {
  const linhas = mensagens.map((m) => `${m.de === "cliente" ? "Cliente" : "Atendente"}: ${(m.texto || "").trim()}`).join("\n");
  return (
    "Você trabalha no atendimento de WhatsApp de um restaurante e vai REPASSAR este atendimento pra outra pessoa continuar. " +
    "Escreva um RESUMO curto e prático, em português do Brasil, do que a outra pessoa precisa saber pra assumir agora. " +
    "Foque em: o que o cliente quer, o status atual e o que falta fazer. " +
    "Regras: baseie-se SOMENTE na conversa abaixo (não invente nada); no máximo ~5 linhas; direto ao ponto; " +
    "sem saudação, sem se despedir, sem repetir o nome/telefone do contato (já vão à parte).\n\n" +
    `CONTATO: ${contato.nome || "—"}${contato.telefone ? ` (${contato.telefone})` : ""}\n` +
    (contato.info ? `${contato.info}\n` : "") +
    "\nCONVERSA:\n" + (linhas || "(sem mensagens de texto)") + "\n\n" +
    "Responda SOMENTE o texto do resumo, sem aspas e sem rótulo."
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

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { contato?: ContatoIn; mensagens?: MsgIn[] } | null;
  const contato: ContatoIn = {
    nome: String(body?.contato?.nome || "").slice(0, 120),
    telefone: String(body?.contato?.telefone || "").slice(0, 40),
    info: String(body?.contato?.info || "").slice(0, 300),
  };
  const mensagens = (Array.isArray(body?.mensagens) ? body!.mensagens : [])
    .filter((m) => m && typeof m.texto === "string" && m.texto.trim())
    .map((m) => ({ de: m.de === "cliente" ? "cliente" : "atendente", texto: String(m.texto || "").slice(0, 2000) }))
    .slice(-40);
  if (mensagens.length === 0) { res.status(200).json({ resumo: "" }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, thinking: { type: "adaptive" }, messages: [{ role: "user", content: [{ type: "text", text: montarPrompt(contato, mensagens) }] }] }),
      signal: ctrl.signal,
    });
    const t = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude HTTP ${resp.status}. ${t.slice(0, 200)}` }); return; }
    const j = JSON.parse(t) as { content?: Array<{ type?: string; text?: string }> };
    const out = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();
    res.status(200).json({ resumo: out });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao gerar o resumo.` : (e instanceof Error ? e.message : "Falha ao gerar o resumo.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

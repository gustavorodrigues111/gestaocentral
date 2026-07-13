// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-acao — ações sobre uma mensagem já enviada, via EVOLUTION API:
//    • reagir  → POST   /message/sendReaction/{instancia}      { key, reaction }
//    • editar  → POST   /chat/updateMessage/{instancia}        { number, key, text }
//    • apagar  → DELETE /chat/deleteMessageForEveryone/{inst}  { id, remoteJid, fromMe }
//  (apagar é SEMPRE pra todos — nunca "só pra mim".)
//  Exige Firebase ID token.
//
//  Corpo: { instancia, acao, remoteJid, id, fromMe, reaction?, texto?, to? }
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 20 };
const REQ_TIMEOUT_MS = 15_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) { res.status(503).json({ error: "Evolution não configurada.", naoConfigurado: true }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as {
    instancia?: string; acao?: string; remoteJid?: string; id?: string; fromMe?: boolean;
    reaction?: string; texto?: string; to?: string;
  } | null;

  const instancia = (body?.instancia || "").toString().trim();
  const acao = (body?.acao || "").toString().trim();
  const remoteJid = (body?.remoteJid || "").toString().trim();
  const id = (body?.id || "").toString().trim();
  const fromMe = !!body?.fromMe;
  if (!instancia) { res.status(400).json({ error: "Informe a instância." }); return; }
  if (!remoteJid || !id) { res.status(400).json({ error: "Mensagem inválida (falta remoteJid/id)." }); return; }

  const msgKey = { remoteJid, fromMe, id };
  let url = "";
  let method = "POST";
  let payload: Record<string, unknown> = {};
  if (acao === "reagir") {
    url = `${base}/message/sendReaction/${encodeURIComponent(instancia)}`;
    payload = { key: msgKey, reaction: (body?.reaction ?? "").toString() };
  } else if (acao === "editar") {
    const texto = (body?.texto || "").toString();
    if (!texto.trim()) { res.status(400).json({ error: "Texto vazio." }); return; }
    if (!fromMe) { res.status(400).json({ error: "Só dá pra editar mensagem enviada por você." }); return; }
    url = `${base}/chat/updateMessage/${encodeURIComponent(instancia)}`;
    payload = { number: (body?.to || remoteJid.split("@")[0]).toString(), key: msgKey, text: texto };
  } else if (acao === "apagar") {
    if (!fromMe) { res.status(400).json({ error: "Só dá pra apagar (pra todos) mensagem enviada por você." }); return; }
    url = `${base}/chat/deleteMessageForEveryone/${encodeURIComponent(instancia)}`;
    method = "DELETE";
    payload = { id, remoteJid, fromMe };
  } else {
    res.status(400).json({ error: "Ação inválida (use reagir/editar/apagar)." });
    return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method,
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Evolution HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timeout ao falar com a Evolution." : (e instanceof Error ? e.message : "Falha na ação.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

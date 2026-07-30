// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-enviar — envia texto pelo WhatsApp via EVOLUTION API (número
//  plugado como dispositivo, device-link). Cada número = uma "instância".
//  Prefixa o nome de quem digitou (*Nome:*) pra identificar o atendente.
//  Exige Firebase ID token.
//
//  Env vars (Vercel):
//    EVOLUTION_API_URL   — ex.: https://evolution-api-production-1b36.up.railway.app
//    EVOLUTION_API_KEY   — a AUTHENTICATION_API_KEY da Evolution
//
//  Corpo: { instancia, to, texto, autorNome? }
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 30 };
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

// E.164 sem "+": só dígitos, DDI 55 quando faltar.
function normalizarFone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;
  return d;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) { res.status(503).json({ error: "Evolution ainda não configurada (faltam EVOLUTION_API_URL / EVOLUTION_API_KEY nas env vars).", naoConfigurado: true }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { instancia?: string; to?: string; texto?: string; autorNome?: string; mentioned?: string[] } | null;
  const instancia = (body?.instancia || "").toString().trim();
  const toRaw = (body?.to || "").toString();
  // Grupo: JID "<id>@g.us" vai VERBATIM (não normaliza — senão perde o @g.us e
  // vira envio pra um número). Individual: normaliza pra E.164 sem "+".
  const to = toRaw.endsWith("@g.us") ? toRaw : normalizarFone(toRaw);
  const mentioned = Array.isArray(body?.mentioned) ? body!.mentioned.filter((x) => typeof x === "string" && x) : [];
  const textoBase = (body?.texto || "").toString();
  const autor = (body?.autorNome || "").toString().trim();
  if (!instancia) { res.status(400).json({ error: "Informe a instância (número)." }); return; }
  if (!to) { res.status(400).json({ error: "Número (to) inválido." }); return; }
  if (!textoBase.trim()) { res.status(400).json({ error: "Texto vazio." }); return; }

  // Prefixo de autoria: "*Gustavo Rodrigues:*\n<texto>"
  const texto = autor ? `*${autor}:*\n${textoBase}` : textoBase;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/message/sendText/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      // `mentioned`: JIDs (<num>@s.whatsapp.net) marcados no texto (@num) — em grupo.
      body: JSON.stringify({ number: to, text: texto, ...(mentioned.length ? { mentioned } : {}) }),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    const j = safeParse(txt) as { key?: { id?: string }; message?: unknown; error?: unknown; response?: { message?: Array<{ exists?: boolean }> } } | null;
    if (!resp.ok) {
      // Evolution devolve exists:false quando o número não tem conta no WhatsApp.
      const msgs = j?.response?.message;
      if (Array.isArray(msgs) && msgs.some((m) => m && m.exists === false)) {
        res.status(400).json({ error: "Este número não tem WhatsApp — não há uma conta ativa nele, então não é possível enviar a mensagem.", numeroInexistente: true });
        return;
      }
      res.status(502).json({ error: `Evolution retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` });
      return;
    }
    res.status(200).json({ ok: true, messageId: j?.key?.id || null, to, texto });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timeout ao falar com a Evolution." : (e instanceof Error ? e.message : "Falha ao enviar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-grupo-criar — cria um GRUPO de WhatsApp pela Evolution.
//  Corpo: { instancia, subject, participants: string[] (telefones) }
//  Exige Firebase ID token.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 30 };
const REQ_TIMEOUT_MS = 25_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function normFone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;
  return d;
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) { res.status(503).json({ error: "Evolution ainda não configurada (env vars).", naoConfigurado: true }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { instancia?: string; subject?: string; participants?: string[] } | null;
  const instancia = (body?.instancia || "").toString().trim();
  const subject = (body?.subject || "").toString().trim();
  const participants = (Array.isArray(body?.participants) ? body!.participants : []).map(normFone).filter(Boolean).map((n) => `${n}@s.whatsapp.net`);
  if (!instancia) { res.status(400).json({ error: "Informe a instância (número)." }); return; }
  if (!subject) { res.status(400).json({ error: "Informe o nome do grupo." }); return; }
  if (participants.length === 0) { res.status(400).json({ error: "Adicione pelo menos um participante com telefone." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}/group/create/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ subject, participants }),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    const j = safeParse(txt) as { id?: string; groupJid?: string; key?: { id?: string } } | null;
    if (!resp.ok) { res.status(502).json({ error: `Evolution retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    res.status(200).json({ ok: true, groupId: j?.id || j?.groupJid || j?.key?.id || null });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timeout ao falar com a Evolution." : (e instanceof Error ? e.message : "Falha ao criar grupo.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

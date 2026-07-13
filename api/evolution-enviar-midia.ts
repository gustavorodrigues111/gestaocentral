// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-enviar-midia — envia foto/vídeo/documento/áudio pelo WhatsApp
//  via EVOLUTION API (device-link). Recebe o arquivo em base64 do navegador.
//  Exige Firebase ID token.
//
//  Corpo: { instancia, to, tipo:"image"|"video"|"document"|"audio",
//           base64, mimetype?, fileName?, caption?, autorNome? }
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };
const REQ_TIMEOUT_MS = 45_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function normalizarFone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;
  return d;
}
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }
// Tira o prefixo "data:...;base64," se vier (a Evolution quer o base64 puro).
function soBase64(s: string): string { const i = s.indexOf("base64,"); return i >= 0 ? s.slice(i + 7) : s; }

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) { res.status(503).json({ error: "Evolution ainda não configurada (env vars EVOLUTION_*).", naoConfigurado: true }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as
    { instancia?: string; to?: string; tipo?: string; base64?: string; mimetype?: string; fileName?: string; caption?: string; autorNome?: string } | null;
  const instancia = (body?.instancia || "").toString().trim();
  const to = normalizarFone((body?.to || "").toString());
  const tipo = (body?.tipo || "").toString();
  const b64 = soBase64((body?.base64 || "").toString());
  const mimetype = (body?.mimetype || "").toString();
  const fileName = (body?.fileName || "arquivo").toString();
  const caption = (body?.caption || "").toString();
  const autor = (body?.autorNome || "").toString().trim();
  if (!instancia) { res.status(400).json({ error: "Informe a instância." }); return; }
  if (!to) { res.status(400).json({ error: "Número inválido." }); return; }
  if (!b64) { res.status(400).json({ error: "Arquivo vazio." }); return; }
  if (!["image", "video", "document", "audio"].includes(tipo)) { res.status(400).json({ error: "Tipo inválido." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    let url: string; let payload: Record<string, unknown>;
    if (tipo === "audio") {
      url = `${base}/message/sendWhatsAppAudio/${encodeURIComponent(instancia)}`;
      payload = { number: to, audio: b64 };
    } else {
      url = `${base}/message/sendMedia/${encodeURIComponent(instancia)}`;
      payload = { number: to, mediatype: tipo, media: b64, fileName, ...(mimetype ? { mimetype } : {}), ...(caption ? { caption: autor ? `*${autor}:*\n${caption}` : caption } : {}) };
    }
    const resp = await fetch(url, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    const txt = await resp.text();
    const j = safeParse(txt) as { key?: { id?: string } } | null;
    if (!resp.ok) { res.status(502).json({ error: `Evolution HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    res.status(200).json({ ok: true, messageId: j?.key?.id || null });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timeout ao enviar mídia." : (e instanceof Error ? e.message : "Falha ao enviar mídia.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

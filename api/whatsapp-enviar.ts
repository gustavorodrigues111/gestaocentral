// ════════════════════════════════════════════════════════════════════════════
//  /api/whatsapp-enviar — envia mensagem pelo WhatsApp Cloud API (Meta).
//  Serviço CENTRAL: qualquer módulo (checklists, admissão, plano de ação…) chama
//  este endpoint pra disparar uma mensagem. Fica INERTE até as env vars estarem
//  configuradas na Vercel (então retorna 503 "não configurado", sem quebrar).
//
//  Env vars (você me passa depois de criar a WABA):
//    WHATSAPP_TOKEN         — token permanente (system user) com whatsapp_business_messaging
//    WHATSAPP_PHONE_ID      — Phone Number ID do número
//    WHATSAPP_API_VERSION   — opcional (default v21.0)
//
//  Corpo:
//    { to, template, idioma?, params? }  → mensagem-MODELO (proativa; fora das 24h)
//    { to, texto }                        → texto livre (só dentro da janela de 24h)
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 30 };
const REQ_TIMEOUT_MS = 20_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

// Normaliza pra E.164 sem "+": só dígitos, com DDI 55 (Brasil) quando faltar.
function normalizarFone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d;          // sem DDI → assume Brasil
  return d;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const versao = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneId) { res.status(503).json({ error: "WhatsApp ainda não configurado (faltam WHATSAPP_TOKEN / WHATSAPP_PHONE_ID nas env vars).", naoConfigurado: true }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as
    { to?: string; template?: string; idioma?: string; params?: string[]; texto?: string } | null;
  const to = normalizarFone((body?.to || "").toString());
  if (!to) { res.status(400).json({ error: "Número (to) inválido." }); return; }

  // Monta o payload: template (proativo) ou texto (dentro da janela de 24h).
  let payload: Record<string, unknown>;
  if (body?.template) {
    const params = Array.isArray(body.params) ? body.params : [];
    payload = {
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: body.template,
        language: { code: body.idioma || "pt_BR" },
        ...(params.length ? { components: [{ type: "body", parameters: params.map(p => ({ type: "text", text: String(p ?? "") })) }] } : {}),
      },
    };
  } else if (body?.texto) {
    payload = { messaging_product: "whatsapp", to, type: "text", text: { preview_url: true, body: body.texto } };
  } else {
    res.status(400).json({ error: "Informe 'template' (com params) ou 'texto'." }); return;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    const j = safeParse(txt) as { messages?: Array<{ id?: string }>; error?: { message?: string } } | null;
    if (!resp.ok) { res.status(502).json({ error: j?.error?.message || `WhatsApp retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    res.status(200).json({ ok: true, messageId: j?.messages?.[0]?.id || null, to });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Timeout ao falar com o WhatsApp." : (e instanceof Error ? e.message : "Falha ao enviar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

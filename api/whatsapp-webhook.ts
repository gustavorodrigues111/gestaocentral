// ════════════════════════════════════════════════════════════════════════════
//  /api/whatsapp-webhook — recebe eventos do WhatsApp Cloud API (Meta).
//   GET  → verificação (a Meta manda hub.challenge; devolvemos se o verify_token bate).
//   POST → mensagens recebidas + status de entrega → grava no Firestore (via REST/SA).
//
//  Público (a Meta chama sem login). Segurança:
//   - GET valida WHATSAPP_VERIFY_TOKEN.
//   - POST valida a assinatura X-Hub-Signature-256 se WHATSAPP_APP_SECRET estiver setada.
//
//  Env: WHATSAPP_VERIFY_TOKEN (você escolhe, e põe igual no painel da Meta),
//       WHATSAPP_APP_SECRET (opcional, do app), FIREBASE_SERVICE_ACCOUNT (pra gravar).
// ════════════════════════════════════════════════════════════════════════════
import crypto from "node:crypto";
import { firestoreCriar, firestoreLer, firestoreDisponivel } from "./_firestoreRest.js";
import { atenderWhatsAgente, atenderWhatsAudio } from "./_roteadorWhats.js";

export const config = { maxDuration: 120 };   // o agente pode gerar PDF (Puppeteer, ~40s); retry da Meta é deduplicado

type Req = { method?: string; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (c: number) => Res; json: (b: unknown) => void; send: (b: string) => void; end: () => void };

export default async function handler(req: Req, res: Res): Promise<void> {
  // ── Verificação do webhook (GET) ──
  if (req.method === "GET") {
    const q = req.query || {};
    const modo = String(q["hub.mode"] || "");
    const token = String(q["hub.verify_token"] || "");
    const challenge = String(q["hub.challenge"] || "");
    if (modo === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) { res.status(200).send(challenge); return; }
    res.status(403).send("forbidden"); return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Método não suportado." }); return; }

  // ── Assinatura (opcional, se WHATSAPP_APP_SECRET setada) ──
  const segredo = process.env.WHATSAPP_APP_SECRET;
  if (segredo) {
    try {
      const assinatura = String(req.headers?.["x-hub-signature-256"] || "");
      const corpoStr = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
      const esperado = "sha256=" + crypto.createHmac("sha256", segredo).update(corpoStr).digest("hex");
      if (!assinatura || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperado))) { res.status(401).json({ error: "assinatura inválida" }); return; }
    } catch { /* se falhar a checagem, não derruba — segue */ }
  }

  // Sempre devolve 200 rápido pra Meta não reenviar (processa o que der).
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as WebhookBody | null;
    if (firestoreDisponivel()) await processar(body);
  } catch (e) { console.log("[wpp-webhook] erro:", (e as Error)?.message); }
  res.status(200).json({ ok: true });
}

type WebhookBody = { entry?: Array<{ changes?: Array<{ value?: WValue }> }> };
type WValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{ from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string }; image?: { caption?: string }; document?: { caption?: string; filename?: string }; audio?: { id?: string; mime_type?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }>;
  statuses?: Array<{ id?: string; status?: string; timestamp?: string; recipient_id?: string }>;
};

async function processar(body: WebhookBody | null): Promise<void> {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  if (!value) return;
  const nome = value.contacts?.[0]?.profile?.name || null;

  for (const m of value.messages || []) {
    if (!m.id || !m.from) continue;
    const texto = m.text?.body || m.image?.caption || m.document?.caption || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || (m.type && m.type !== "text" ? `[${m.type}]` : "");
    const ts = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
    // Lê ANTES de gravar: se a Meta reenviar (retry), o doc já existe → não
    // reprocessa no agente (evita resposta duplicada).
    const jaTinha = await firestoreLer("whatsappMensagens", m.id).catch(() => null);
    try {
      await firestoreCriar("whatsappMensagens", m.id, {
        waId: m.from, nome, direcao: "in", tipo: m.type || "text", texto,
        timestamp: ts, recebidoEm: new Date().toISOString(), lido: false,
        messageId: m.id, phoneNumberId: value.metadata?.phone_number_id || null,
      });
    } catch (e) { console.log("[wpp-webhook] falha ao gravar msg:", (e as Error)?.message); }
    // Roteia pro Agente de IA só se for mensagem NOVA e com texto de verdade
    // (mídia sem legenda não é atendida por ora).
    const ehTexto = !!(m.text?.body || m.image?.caption || m.document?.caption || m.button?.text || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title);
    if (!jaTinha) {
      try {
        if (ehTexto && texto) await atenderWhatsAgente(m.from, texto, nome, m.id);
        else if (m.type === "audio" && m.audio?.id) await atenderWhatsAudio(m.from, m.audio.id, nome, m.id);
      } catch (e) { console.log("[wpp-webhook] roteador:", (e as Error)?.message); }
    }
  }
  // Status de entrega dos que ENVIAMOS (marca no doc do envio, se existir).
  for (const s of value.statuses || []) {
    if (!s.id) continue;
    try {
      await firestoreCriar("whatsappStatus", s.id + "_" + (s.status || ""), {
        messageId: s.id, status: s.status || null, recipiente: s.recipient_id || null,
        em: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
      });
    } catch { /* status é secundário */ }
  }
}

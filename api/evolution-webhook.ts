// ════════════════════════════════════════════════════════════════════════════
//  /api/evolution-webhook — recebe eventos da EVOLUTION API (mensagens do
//  WhatsApp device-link) e grava no Firestore (whatsappMensagens + whatsapp
//  Contatos), com o numeroId = nome da instância. Público (a Evolution chama
//  sem login) → protegido por ?token= (EVOLUTION_WEBHOOK_TOKEN).
//
//  Aponte o webhook de cada instância na Evolution pra:
//    <APP_URL>/api/evolution-webhook?token=<EVOLUTION_WEBHOOK_TOKEN>
//  com o evento MESSAGES_UPSERT ligado.
// ════════════════════════════════════════════════════════════════════════════
import { firestoreCriar, firestoreDisponivel } from "./_firestoreRest.js";

export const config = { maxDuration: 15 };

type Req = { method?: string; query?: Record<string, string | string[] | undefined>; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type Res = { status: (c: number) => Res; json: (b: unknown) => void; send: (b: string) => void };

type EvoMsg = {
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
  messageType?: string;
  messageTimestamp?: number | string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string; mimetype?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string; fileName?: string };
    audioMessage?: { mimetype?: string };
    stickerMessage?: { mimetype?: string };
    reactionMessage?: { text?: string };
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number };
    contactMessage?: { displayName?: string };
    contactsArrayMessage?: unknown;
    pollCreationMessage?: { name?: string };
  };
};
type EvoBody = { event?: string; instance?: string; data?: EvoMsg | EvoMsg[] };

const soDig = (s?: string) => (s || "").replace(/\D/g, "");
// Chave normalizada BR: ignora DDI 55 e o 9º dígito de celular (DDD + 8 últimos).
// Mesma lógica do foneKey do front — pra o contato semeado casar as duas formas.
function chaveBR(raw?: string): string {
  let d = soDig(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}
function textoDe(m?: EvoMsg["message"], tipo?: string): string {
  if (!m) return tipo ? `[${tipo}]` : "";
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || (m.reactionMessage?.text ? `reagiu ${m.reactionMessage.text}` : "")
    || (m.stickerMessage ? "🟢 Figurinha" : "")
    || (m.documentMessage?.fileName ? `📄 ${m.documentMessage.fileName}` : "")
    || (m.imageMessage ? "🖼️ Imagem" : "")
    || (m.videoMessage ? "🎬 Vídeo" : "")
    || (m.audioMessage ? "🎤 Áudio" : "")
    || (m.locationMessage ? "📍 Localização" : "")
    || (m.contactMessage?.displayName ? `👤 Contato: ${m.contactMessage.displayName}` : "")
    || (m.contactsArrayMessage ? "👥 Contatos" : "")
    || (m.pollCreationMessage?.name ? `📊 Enquete: ${m.pollCreationMessage.name}` : "")
    || (tipo ? `[${tipo}]` : "");
}

// Busca o conteúdo real da mídia (figurinha/imagem) na Evolution → data URL.
// Só pra tipos leves; erro/grande → volta vazio (fica só o rótulo).
async function baixarMidia(instancia: string, msg: EvoMsg): Promise<{ midia: string; mime: string } | null> {
  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const resp = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(instancia)}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key: msg.key }, convertToMp4: false }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const j = (await resp.json()) as { base64?: string; mimetype?: string } | null;
    const b64 = j?.base64 || "";
    if (!b64 || b64.length > 800_000) return null;   // ~600KB — não estoura o doc do Firestore
    const mime = j?.mimetype || "application/octet-stream";
    return { midia: `data:${mime};base64,${b64}`, mime };
  } catch { return null; }
}

export default async function handler(req: Req, res: Res): Promise<void> {
  if (req.method === "GET") { res.status(200).send("ok"); return; }   // teste de saúde
  if (req.method !== "POST") { res.status(405).json({ error: "Método não suportado." }); return; }

  const token = String(req.query?.token || "");
  if (!process.env.EVOLUTION_WEBHOOK_TOKEN || token !== process.env.EVOLUTION_WEBHOOK_TOKEN) { res.status(401).json({ error: "token inválido" }); return; }

  // Responde 200 rápido; processa o que der.
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as EvoBody | null;
    if (body && firestoreDisponivel()) await processar(body);
  } catch (e) { console.log("[evo-webhook] erro:", (e as Error)?.message); }
  res.status(200).json({ ok: true });
}

async function processar(body: EvoBody): Promise<void> {
  const evento = String(body.event || "").toLowerCase();
  if (evento && !evento.includes("messages.upsert") && !evento.includes("messages_upsert")) return;
  const numeroId = String(body.instance || "").trim();
  if (!numeroId) return;
  const itens = Array.isArray(body.data) ? body.data : (body.data ? [body.data] : []);

  for (const m of itens) {
    const jid = m.key?.remoteJid || "";
    if (!jid || jid.endsWith("@g.us")) continue;          // ignora grupos por enquanto
    const id = m.key?.id;
    if (!id) continue;
    const waId = soDig(jid.split("@")[0]);
    if (!waId) continue;
    const fromMe = !!m.key?.fromMe;
    const texto = textoDe(m.message, m.messageType);
    const tsNum = Number(m.messageTimestamp);
    const ts = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();
    // Figurinha e imagem: tenta baixar o conteúdo pra exibir de verdade.
    let midia: { midia: string; mime: string } | null = null;
    if (m.message?.stickerMessage || m.message?.imageMessage) midia = await baixarMidia(numeroId, m);
    try {
      await firestoreCriar("whatsappMensagens", `${numeroId}_${id}`, {
        waId, nome: m.pushName || null, direcao: fromMe ? "out" : "in",
        tipo: m.messageType || "text", texto, timestamp: ts, recebidoEm: new Date().toISOString(),
        lido: fromMe, numeroId, messageId: id,
        autorNome: fromMe ? "via aparelho" : null, viaAparelho: fromMe,
        ...(midia ? { midia: midia.midia, mime: midia.mime } : {}),
      });
      // Semeia o contato na 1ª mensagem (create-if-not-exists — não sobrescreve
      // ajustes manuais posteriores, que vêm pelo app com merge).
      if (m.pushName) { const ck = chaveBR(waId); await firestoreCriar("whatsappContatos", ck, { id: ck, waId, nomePush: m.pushName, atualizadoEm: new Date().toISOString() }); }
    } catch (e) { console.log("[evo-webhook] falha ao gravar:", (e as Error)?.message); }
  }
}

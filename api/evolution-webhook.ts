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
import { firestoreCriar, firestoreLer, firestoreAtualizar, firestoreDisponivel } from "./_firestoreRest.js";

type RotOpcao = { id?: string; rotulo?: string; pessoaId?: string; pessoaNome?: string; atalhos?: string[] };
type Roteamento = { ativo?: boolean; saudacao?: string; mensagemRoteado?: string; opcoes?: RotOpcao[] };

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
    reactionMessage?: { text?: string; key?: { id?: string; remoteJid?: string; fromMe?: boolean } };
    protocolMessage?: { type?: string | number; key?: { id?: string } };
    locationMessage?: { degreesLatitude?: number; degreesLongitude?: number };
    contactMessage?: { displayName?: string };
    contactsArrayMessage?: unknown;
    pollCreationMessage?: { name?: string };
  };
};
type EvoBody = { event?: string; instance?: string; data?: EvoMsg | EvoMsg[] };

// Tipos de mensagem que são protocolo/bastidor do WhatsApp — não têm conteúdo
// pra mostrar na conversa (o app oficial também não exibe).
const IGNORAR_TIPOS = new Set([
  "secretEncryptedMessage", "senderKeyDistributionMessage", "messageContextInfo",
  "pollUpdateMessage", "protocolMessage", "keepInChatMessage",
]);

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

    // Reação → anexa na mensagem-alvo (não vira mensagem nova). text vazio = removeu.
    const reac = m.message?.reactionMessage;
    if (reac && reac.key?.id) {
      const alvoId = `${numeroId}_${reac.key.id}`;
      try { if (await firestoreLer("whatsappMensagens", alvoId)) await firestoreAtualizar("whatsappMensagens", alvoId, { reacao: reac.text || null }); } catch (e) { console.log("[evo-webhook] reacao:", (e as Error)?.message); }
      continue;
    }
    // "Apagar pra todos" (revoke) → marca a mensagem-alvo como apagada.
    const proto = m.message?.protocolMessage;
    if (proto && proto.key?.id && (proto.type === "REVOKE" || proto.type === 0)) {
      const alvoId = `${numeroId}_${proto.key.id}`;
      try { if (await firestoreLer("whatsappMensagens", alvoId)) await firestoreAtualizar("whatsappMensagens", alvoId, { apagada: true, texto: "", midia: null }); } catch (e) { console.log("[evo-webhook] revoke:", (e as Error)?.message); }
      continue;
    }

    // Envelopes de PROTOCOLO/bastidor do WhatsApp — sem conteúdo pra exibir
    // (chaves de sessão, payloads com segredo, votos de enquete, sync). Ignora
    // pra não virar bolha "[secretEncryptedMessage]" na conversa.
    if (IGNORAR_TIPOS.has(m.messageType || "")) continue;

    const texto = textoDe(m.message, m.messageType);
    const tsNum = Number(m.messageTimestamp);
    const ts = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();
    const recente = !fromMe && !!tsNum && (Date.now() / 1000 - tsNum) < 300;

    // Reabre conversa finalizada O QUANTO ANTES (em paralelo) — não espera o
    // download de mídia (que pode levar segundos) nem a gravação da mensagem.
    // É o que move o chip de Finalizados → Pendentes/atendente padrão rápido.
    const pReabrir = recente
      ? reabrirSeFinalizada(numeroId, waId).catch((e) => console.log("[evo-webhook] reabrir:", (e as Error)?.message))
      : null;

    // Figurinha, imagem e ÁUDIO (voice notes): tenta baixar o conteúdo pra
    // exibir/tocar de verdade. Áudio longo que estourar o limite do doc cai no
    // rótulo "🎤 Áudio" (baixarMidia devolve null acima de ~600KB).
    let midia: { midia: string; mime: string } | null = null;
    if (m.message?.stickerMessage || m.message?.imageMessage || m.message?.audioMessage) midia = await baixarMidia(numeroId, m);
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

    // Automação: só pra mensagens RECEBIDAS e RECENTES (evita disparar no
    // replay de histórico ao reconectar). Espera a reabertura terminar antes
    // (a automação só age se a conversa ainda ficar sem responsável).
    if (recente) {
      if (pReabrir) await pReabrir;
      try { await automacao(numeroId, waId, texto); } catch (e) { console.log("[evo-webhook] automacao:", (e as Error)?.message); }
    }
  }
}

// Reabre atendimento finalizado quando o cliente volta a escrever.
// - Se o contato tem ATENDENTE PADRÃO → reabre já atribuída a ele.
// - Senão → volta pra pendentes (sem responsável) e reseta a triagem.
async function reabrirSeFinalizada(numeroId: string, waIdCru: string): Promise<void> {
  const ck = chaveBR(waIdCru);
  const contato = await firestoreLer("whatsappContatos", ck);
  if (!contato?.finalizadoEm) return;
  const padrao = (contato.atendentePadrao as string) || null;
  if (padrao) {
    const nome = (contato.atendentePadraoNome as string) || null;
    await firestoreAtualizar("whatsappContatos", ck, {
      finalizadoEm: null, finalizadoPor: null,
      atribuidoA: padrao, atribuidoNome: nome, atualizadoEm: new Date().toISOString(),
    });
    await msgSistema(numeroId, waIdCru, `🙋 Reaberta e atribuída automaticamente a ${nome || "atendente padrão"}`);
  } else {
    await firestoreAtualizar("whatsappContatos", ck, {
      finalizadoEm: null, finalizadoPor: null, atribuidoA: null, atribuidoNome: null,
      roteamentoEstado: null, atualizadoEm: new Date().toISOString(),
    });
  }
}

// ── Automação: atendente padrão do contato + menu de triagem por área ──────────
async function automacao(numeroId: string, waIdCru: string, textoMsg: string): Promise<void> {
  const ck = chaveBR(waIdCru);
  const contato = await firestoreLer("whatsappContatos", ck);
  if (contato?.atribuidoA) return;   // já tem responsável → bot não age

  // 1) Atendente padrão do contato tem prioridade (pula o menu).
  if (contato?.atendentePadrao) {
    const nome = (contato.atendentePadraoNome as string) || null;
    await firestoreAtualizar("whatsappContatos", ck, { atribuidoA: contato.atendentePadrao, atribuidoNome: nome, atualizadoEm: new Date().toISOString() });
    await msgSistema(numeroId, waIdCru, `🙋 Atribuída automaticamente a ${nome || "atendente padrão"}`);
    return;
  }

  // 2) Menu de triagem por área (config no número).
  const numero = await firestoreLer("whatsappNumeros", numeroId);
  const rot = (numero?.roteamento || undefined) as Roteamento | undefined;
  if (!rot || !rot.ativo || !Array.isArray(rot.opcoes) || rot.opcoes.length === 0) return;

  const estado = contato?.roteamentoEstado;
  if (estado === "roteado") return;
  if (estado === "menu_enviado") {
    const opc = matchOpcao(rot.opcoes, textoMsg);
    if (opc && opc.pessoaId) {
      await firestoreAtualizar("whatsappContatos", ck, { atribuidoA: opc.pessoaId, atribuidoNome: opc.pessoaNome || null, roteamentoEstado: "roteado", atualizadoEm: new Date().toISOString() });
      const conf = (rot.mensagemRoteado || "Perfeito! Vou te encaminhar para {atendente}. 😊").replace("{atendente}", opc.pessoaNome || "nosso time");
      await enviarTexto(numeroId, waIdCru, conf);
      await msgSistema(numeroId, waIdCru, `🤖 Triagem: cliente escolheu "${opc.rotulo}" → atribuída a ${opc.pessoaNome || "—"}`);
    } else {
      await enviarTexto(numeroId, waIdCru, "Não entendi a opção. " + montarMenu(rot));
    }
    return;
  }
  // Primeira mensagem da conversa → manda o menu.
  await enviarTexto(numeroId, waIdCru, montarMenu(rot));
  await firestoreAtualizar("whatsappContatos", ck, { roteamentoEstado: "menu_enviado", atualizadoEm: new Date().toISOString() });
}

function montarMenu(rot: Roteamento): string {
  const linhas = (rot.opcoes || []).map((o, i) => `${i + 1}. ${o.rotulo || ""}`).join("\n");
  return `${rot.saudacao || "Olá! Com qual área você quer falar?"}\n\n${linhas}\n\nResponda com o número da opção.`;
}
function matchOpcao(opcoes: RotOpcao[], texto: string): RotOpcao | null {
  const t = (texto || "").trim().toLowerCase();
  if (!t) return null;
  const soNum = t.replace(/\D/g, "");
  const n = parseInt(soNum, 10);
  if (soNum && String(n) === soNum && n >= 1 && n <= opcoes.length) return opcoes[n - 1];   // "1", "2"…
  for (const o of opcoes) {
    if ((o.atalhos || []).some(a => (a || "").toLowerCase() === t)) return o;
    if (o.rotulo && t.includes(o.rotulo.toLowerCase())) return o;
  }
  if (n >= 1 && n <= opcoes.length) return opcoes[n - 1];   // número solto no meio do texto
  return null;
}

// Envia texto pela Evolution + grava no thread (mensagem automática do sistema).
async function enviarTexto(numeroId: string, to: string, texto: string): Promise<void> {
  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
  const key = process.env.EVOLUTION_API_KEY;
  if (!base || !key) return;
  let mid = `auto_${Date.now()}`;
  try {
    const resp = await fetch(`${base}/message/sendText/${encodeURIComponent(numeroId)}`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ number: to, text: texto }),
    });
    const j = (await resp.json().catch(() => null)) as { key?: { id?: string } } | null;
    if (j?.key?.id) mid = j.key.id;
  } catch (e) { console.log("[evo-webhook] enviarTexto:", (e as Error)?.message); }
  await firestoreCriar("whatsappMensagens", `${numeroId}_${mid}`, {
    waId: to, direcao: "out", tipo: "text", texto, timestamp: new Date().toISOString(),
    recebidoEm: new Date().toISOString(), lido: true, numeroId, autorNome: "🤖 Automático", viaAutomacao: true,
  }).catch(() => {});
}
// Mensagem de sistema no thread (não vai pro WhatsApp).
async function msgSistema(numeroId: string, to: string, texto: string): Promise<void> {
  await firestoreCriar("whatsappMensagens", `${numeroId}_sys_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, {
    waId: to, numeroId, direcao: "out", tipo: "sistema", sistema: true, lido: true,
    texto, timestamp: new Date().toISOString(), recebidoEm: new Date().toISOString(),
  }).catch(() => {});
}

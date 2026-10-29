// ════════════════════════════════════════════════════════════════════════════
//  _botMonitor — MOTOR GENÉRICO do "Bot Planejamento.app".
//
//  Chamado pelo evolution-webhook quando chega mensagem RECEBIDA e RECENTE.
//  É INERTE por padrão: só age se existir um doc `whatsappMonitores/{numeroId__waId}`
//  ativo pra aquela conversa/grupo. Sem monitor → devolve false e o webhook segue
//  o fluxo normal de atendimento. Com monitor → trata e devolve true (o webhook
//  NÃO roda o menu/atendimento humano naquela conversa).
//
//  Arquitetura de SKILLS (plugável): cada função implementa { id, match, handle }.
//  O monitor guarda a lista de skills ativas + config (restaurante, projeto…).
//  Hoje: 1 skill (investimentos). Novas skills = novo handler + registrar aqui.
//  Regra: linguagem/visão = Claude; aritmética/gravação/dedup = código.
// ════════════════════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { firestoreLer, firestoreCriar, firestoreListar, firestorePatchCampos } from "./_firestoreRest.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const evoBase = () => (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
const evoKey = () => process.env.EVOLUTION_API_KEY || "";

// ── Evolution: reação (mesmo endpoint do evolution-acao) ─────────────────────
export async function reagir(numeroId: string, remoteJid: string, msgId: string, emoji: string): Promise<void> {
  const base = evoBase(), key = evoKey();
  if (!base || !key) return;
  try {
    await fetch(`${base}/message/sendReaction/${encodeURIComponent(numeroId)}`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ key: { remoteJid, fromMe: false, id: msgId }, reaction: emoji }),
    });
  } catch (e) { console.log("[bot] reagir:", (e as Error)?.message); }
}

// Baixa a mídia já no Storage de volta como base64 (p/ a visão da Claude).
async function urlParaBase64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    if (ab.byteLength > 20_000_000) return null;   // ~20MB
    return Buffer.from(ab).toString("base64");
  } catch { return null; }
}

// ── IA: extrai os campos de um comprovante (imagem/PDF) ──────────────────────
type Comprovante = {
  data?: string; estabelecimento?: string; categoriaExistente?: string; categoriaSugerida?: string;
  valor?: number; formaPagamento?: string; parcelado?: boolean; parcelas?: { data: string; valor: number }[];
};
async function extrairComprovante(mime: string, base64: string, categorias: string[]): Promise<Comprovante | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  const system = `Você extrai dados de um COMPROVANTE (nota fiscal, recibo, cupom, comprovante de pix/cartão/boleto) de um investimento de restaurante. Devolva SÓ JSON, sem texto fora do JSON, no formato:
{"data":"YYYY-MM-DD","estabelecimento":"","categoriaExistente":"","categoriaSugerida":"","valor":0,"formaPagamento":"dinheiro|pix|debito|credito|boleto|transferencia|outro","parcelado":false,"parcelas":[{"data":"YYYY-MM-DD","valor":0}]}
Regras:
- data = data da compra/pagamento; se não achar, use "${hoje}".
- estabelecimento = fornecedor/loja (o nome mais reconhecível).
- valor = total em reais (número, ponto decimal, sem "R$").
- formaPagamento = uma das opções (minúsculas); crédito=credito, débito=debito; sem saber, "outro".
- categoriaExistente = escolha UMA da lista se encaixar bem; senão "".
- categoriaSugerida = se nenhuma existente serve, sugira 1 curta e genérica; senão "".
- parcelado/parcelas = só se o comprovante indicar; senão parcelas=[].
Categorias existentes: ${categorias.length ? categorias.join(", ") : "(nenhuma)"}.`;
  const isImg = /^image\//.test(mime);
  const fileBlock = isImg
    ? { type: "image", source: { type: "base64", media_type: mime, data: base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, system, messages: [{ role: "user", content: [fileBlock, { type: "text", text: "Extraia os dados deste comprovante." }] }] }),
    });
    if (!resp.ok) { console.log("[bot] claude", resp.status); return null; }
    const j = await resp.json() as { content?: { text?: string }[] };
    const txt = (j?.content?.[0]?.text || "").trim();
    const limpo = txt.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { return JSON.parse(limpo) as Comprovante; }
    catch { const m = limpo.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) as Comprovante : null; }
  } catch (e) { console.log("[bot] extrair:", (e as Error)?.message); return null; }
}

// ── Contrato de skill + contexto ─────────────────────────────────────────────
export type BotMsg = { id: string; remoteJid: string; texto: string; autor: string | null; midiaUrl: string | null; mime: string | null };
export type BotCtx = {
  numeroId: string; waId: string; ehGrupo: boolean;
  rid: string; projetoId: string | null; responsavelPessoaId: string | null; modo: string;
  config: Record<string, unknown>; msg: BotMsg;
};
export type BotSkill = { id: string; match: (ctx: BotCtx) => boolean; handle: (ctx: BotCtx) => Promise<void> };

// ── Skill #1: lançar comprovante em Novos Investimentos ──────────────────────
const skillInvestimentos: BotSkill = {
  id: "investimentos",
  match: (ctx) => !!ctx.msg.midiaUrl && (/^image\//.test(ctx.msg.mime || "") || (ctx.msg.mime || "").includes("pdf")),
  handle: async (ctx) => {
    const docKey = `${ctx.numeroId}_${ctx.msg.id}`;
    const jaMsg = await firestoreLer("whatsappMensagens", docKey).catch(() => null);
    if (jaMsg?.botProcessado) return;                           // dedup: reentrega do webhook
    if (!ctx.rid || !ctx.projetoId) { await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "⚠️"); return; }
    const b64 = await urlParaBase64(ctx.msg.midiaUrl!);
    if (!b64) { await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "⚠️"); return; }
    const todas = await firestoreListar("investCategorias").catch(() => [] as Record<string, unknown>[]);
    const cats = todas.filter((c) => c.restaurantId === ctx.rid).map((c) => String(c.nome || "")).filter(Boolean);
    const ext = await extrairComprovante(ctx.msg.mime!, b64, cats);
    if (!ext || !(Number(ext.valor) > 0)) {
      await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true, botFalhou: true }).catch(() => {});
      await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "⚠️");
      return;
    }
    const id = randomUUID();
    const nowISO = new Date().toISOString();
    await firestoreCriar("investLancamentos", id, {
      id, restaurantId: ctx.rid, projetoId: ctx.projetoId,
      data: ext.data || nowISO.slice(0, 10),
      estabelecimento: ext.estabelecimento || "—",
      categoriaNome: ext.categoriaExistente || ext.categoriaSugerida || null,
      valor: Number(ext.valor),
      formaPagamento: ext.formaPagamento || null,
      comprovanteUrl: ctx.msg.midiaUrl,
      observacao: `via Bot · WhatsApp${ctx.msg.autor ? " · " + ctx.msg.autor : ""}`,
      parcelado: !!ext.parcelado, parcelas: Array.isArray(ext.parcelas) ? ext.parcelas : [],
      origem: "bot", rascunho: true,
      criadoEm: nowISO, criadoPorNome: "Bot Planejamento.app",
    });
    await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true, botLancamentoId: id }).catch(() => {});
    await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "✅");
  },
};

const REGISTRY: Record<string, BotSkill> = { investimentos: skillInvestimentos };

// ── Entrada: roda o monitor (se houver) pra uma conversa/grupo ───────────────
// Retorna true se a conversa é monitorada (o webhook NÃO roda atendimento humano).
export async function rodarMonitor(
  numeroId: string, waId: string, remoteJidRaw: string, msgId: string,
  texto: string, midia: { url: string; mime: string } | null, autor: string | null,
): Promise<boolean> {
  const monId = `${numeroId}__${waId}`;
  let config: Record<string, unknown> | null;
  try { config = await firestoreLer("whatsappMonitores", monId); } catch { return false; }
  if (!config || config.ativo === false) return false;         // não monitorado → fluxo normal
  const skillsIds = Array.isArray(config.skills) ? config.skills.map(String)
    : (config.finalidade ? [String(config.finalidade)] : []);
  const ctx: BotCtx = {
    numeroId, waId, ehGrupo: waId.startsWith("g:") || remoteJidRaw.endsWith("@g.us"),
    rid: String(config.restaurantId || ""),
    projetoId: config.projetoId ? String(config.projetoId) : null,
    responsavelPessoaId: config.responsavelPessoaId ? String(config.responsavelPessoaId) : null,
    modo: String(config.modo || "silencioso"), config,
    msg: { id: msgId, remoteJid: remoteJidRaw, texto, autor, midiaUrl: midia?.url || null, mime: midia?.mime || null },
  };
  for (const sid of skillsIds) {
    const skill = REGISTRY[sid];
    if (!skill) continue;
    try { if (skill.match(ctx)) await skill.handle(ctx); }
    catch (e) { console.log(`[bot] skill ${sid}:`, (e as Error)?.message); }
  }
  return true;   // conversa é do bot → não cair no atendimento humano
}

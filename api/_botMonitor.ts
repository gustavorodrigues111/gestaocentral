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
//
//  F2: custo em TEXTO ("paguei 300 de areia"), dúvidas/divergências no PRIVADO do
//      responsável técnico + aviso na Central, e a resposta dele CASA a pendência.
//  F3: o bot FALA no grupo só quando CHAMADO (menção @ ou reply à msg dele).
// ════════════════════════════════════════════════════════════════════════════
import { randomUUID } from "node:crypto";
import { firestoreLer, firestoreCriar, firestoreListar, firestorePatchCampos, firestoreConsultarUm, firestoreCriarSeAusente } from "./_firestoreRest.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const evoBase = () => (process.env.EVOLUTION_API_URL || "").replace(/\/+$/, "");
const evoKey = () => process.env.EVOLUTION_API_KEY || "";
const soDig = (s?: string) => (s || "").replace(/\D/g, "");
const normalizarFone = (raw: string) => { let d = soDig(raw); if (!d) return ""; if (d.length <= 11) d = "55" + d; return d; };
function fmtBR(iso?: string): string { const d = (iso || "").slice(0, 10).split("-"); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : (iso || ""); }

// ── Evolution: reação ────────────────────────────────────────────────────────
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

// ── Evolution: enviar texto (grupo ou privado). Pode citar (reply) uma msg. ──
export async function enviarTexto(numeroId: string, numeroOuJid: string, texto: string, opts?: { quotedId?: string }): Promise<void> {
  const base = evoBase(), key = evoKey();
  if (!base || !key || !texto.trim()) return;
  try {
    await fetch(`${base}/message/sendText/${encodeURIComponent(numeroId)}`, {
      method: "POST", headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        number: numeroOuJid, text: texto,
        ...(opts?.quotedId ? { quoted: { key: { remoteJid: numeroOuJid, fromMe: false, id: opts.quotedId } } } : {}),
      }),
    });
  } catch (e) { console.log("[bot] enviarTexto:", (e as Error)?.message); }
}

// Número próprio da instância (p/ detectar menção @). Best-effort + cache quente.
const ownCache = new Map<string, string>();
async function numeroProprioDigits(numeroId: string): Promise<string> {
  if (ownCache.has(numeroId)) return ownCache.get(numeroId)!;
  const base = evoBase(), key = evoKey();
  if (!base || !key) return "";
  try {
    const r = await fetch(`${base}/instance/fetchInstances`, { headers: { apikey: key, "Content-Type": "application/json" } });
    if (!r.ok) return "";
    const j = await r.json() as unknown;
    const arr = Array.isArray(j) ? j : (Array.isArray((j as { instances?: unknown[] })?.instances) ? (j as { instances: unknown[] }).instances : []);
    for (const el of arr as Array<Record<string, unknown>>) {
      const inner = (el.instance || {}) as Record<string, unknown>;
      const nome = String(el.name || el.instanceName || inner.instanceName || inner.name || "");
      if (nome !== numeroId) continue;
      const own = String(el.ownerJid || el.owner || el.number || inner.ownerJid || inner.owner || inner.wuid || "");
      const dig = soDig(own.split("@")[0]);
      if (dig) ownCache.set(numeroId, dig);
      return dig;
    }
  } catch (e) { console.log("[bot] numeroProprio:", (e as Error)?.message); }
  return "";
}

// ── Claude: chamada de texto genérica ────────────────────────────────────────
async function claudeTexto(system: string, userText: string, maxTokens = 600): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: userText }] }),
    });
    if (!resp.ok) { console.log("[bot] claudeTexto", resp.status); return null; }
    const j = await resp.json() as { content?: { text?: string }[] };
    return (j?.content?.[0]?.text || "").trim() || null;
  } catch (e) { console.log("[bot] claudeTexto:", (e as Error)?.message); return null; }
}
function parseJSON<T>(txt: string | null): T | null {
  if (!txt) return null;
  const limpo = txt.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(limpo) as T; }
  catch { const m = limpo.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) as T : null; } catch { return null; } }
}

// ── IA: extrai os campos de um comprovante (imagem/PDF) ──────────────────────
type Pagamento = { pagador: string; valor: number };
type Comprovante = {
  ehComprovante?: boolean; pagador?: string; rateioIgual?: boolean; pagamentos?: Pagamento[];
  data?: string; estabelecimento?: string; categoriaExistente?: string; categoriaSugerida?: string;
  valor?: number; formaPagamento?: string; parcelado?: boolean; parcelas?: { data: string; valor: number }[];
};
async function extrairComprovante(mime: string, base64: string, categorias: string[]): Promise<Comprovante | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  const system = `Você analisa uma imagem/PDF recebido num grupo de WhatsApp e decide se é um COMPROVANTE financeiro (nota fiscal, recibo, cupom fiscal, comprovante de pix/cartão/boleto/transferência) de um investimento de restaurante. Devolva SÓ JSON, sem texto fora do JSON, no formato:
{"ehComprovante":true,"pagador":"","data":"YYYY-MM-DD","estabelecimento":"","categoriaExistente":"","categoriaSugerida":"","valor":0,"formaPagamento":"dinheiro|pix|debito|credito|boleto|transferencia|outro","parcelado":false,"parcelas":[{"data":"YYYY-MM-DD","valor":0}]}
Regras:
- ehComprovante=false se a imagem NÃO for um comprovante financeiro (foto de obra/produto/pessoas, meme, print de conversa, documento qualquer). Nesse caso devolva o resto zerado/vazio.
- ehComprovante=true se for comprovante, mesmo que ilegível/parcial (aí valor pode ficar 0).
- pagador = só preencha se o comprovante disser explicitamente o nome de quem pagou; senão "" (o sistema usa quem mandou a mensagem).
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
    return parseJSON<Comprovante>((j?.content?.[0]?.text || "").trim());
  } catch (e) { console.log("[bot] extrair:", (e as Error)?.message); return null; }
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

// ── IA: custo em TEXTO livre ("paguei 300 de areia hoje") ────────────────────
type CustoTexto = {
  ehCusto?: boolean; valor?: number; descricao?: string; estabelecimento?: string; pagador?: string;
  rateioIgual?: boolean; pagamentos?: Pagamento[];
  categoriaExistente?: string; categoriaSugerida?: string; formaPagamento?: string; data?: string;
};
// Gate barato: só chama a IA se o texto cheira a gasto (evita rodar em "bom dia").
function pareceCusto(texto: string): boolean {
  const t = (texto || "").toLowerCase();
  if (!/\d/.test(t)) return false;
  return /r\$|\breais?\b|\bpix\b|paguei|pagamos|comprei|compramos|gastei|gastamos|custou|custo|valor|nota|boleto|transfer|deposit|investi/.test(t);
}
async function extrairCustoTexto(texto: string, categorias: string[]): Promise<CustoTexto | null> {
  const hoje = new Date().toISOString().slice(0, 10);
  const system = `Você lê uma mensagem de WhatsApp de sócios de um restaurante sobre GASTOS/INVESTIMENTOS de um projeto. Diga se a mensagem relata um gasto e extraia os dados. Devolva SÓ JSON:
{"ehCusto":true,"valor":0,"descricao":"","estabelecimento":"","pagador":"","categoriaExistente":"","categoriaSugerida":"","formaPagamento":"dinheiro|pix|debito|credito|boleto|transferencia|outro","data":"YYYY-MM-DD"}
Regras:
- ehCusto=false se for conversa comum (bom dia, pergunta, combinando algo) e NÃO um gasto concreto.
- valor = em reais (número, ponto decimal); se a pessoa não disse o valor, use 0.
- descricao = o que foi comprado/pago, curto (ex.: "areia", "pedreiro diária").
- estabelecimento = fornecedor/loja se citado; senão "".
- pagador = só se a mensagem disser explicitamente QUEM pagou (ex.: "o João pagou"); senão "" (o sistema usa quem mandou a mensagem).
- rateioIgual = true se disser que foi dividido igualmente entre os sócios ("entre todos", "um terço cada", "metade cada", "rachado"); senão false.
- pagamentos = só se citar nomes COM valores (ex.: "João 300, Pedro 300"): [{"pagador":"João","valor":300}]; senão [].
- data = se citar ("ontem", "dia 3"); senão "${hoje}".
- categoriaExistente = UMA da lista se encaixar; senão "". categoriaSugerida = curta se nenhuma serve; senão "".
Categorias existentes: ${categorias.length ? categorias.join(", ") : "(nenhuma)"}.`;
  return parseJSON<CustoTexto>(await claudeTexto(system, texto, 400));
}
// Extrai um valor em reais de uma resposta curta ("é 350", "R$ 1.250,90").
function parseValor(texto: string): number {
  const m = (texto || "").replace(/\s/g, "").match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!m) return 0;
  let s = m[1];
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");   // 1.250,90 → 1250.90
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

// ── Contrato de skill + contexto ─────────────────────────────────────────────
export type BotMsg = { id: string; remoteJid: string; texto: string; autor: string | null; midiaUrl: string | null; mime: string | null };
export type BotCtx = {
  numeroId: string; waId: string; ehGrupo: boolean;
  rid: string; projetoId: string | null; modo: string;
  responsavelPessoaId: string | null; responsavelWhatsapp: string | null;
  grupoNome: string; chamado: boolean;
  config: Record<string, unknown>; msg: BotMsg;
};
export type BotSkill = { id: string; match: (ctx: BotCtx) => boolean; handle: (ctx: BotCtx) => Promise<void> };

// Cadastra o pagador na lista do módulo (idempotente por nome). "Quem pagou"
// vira opção fixa no select de Novos Investimentos.
function slug(s: string): string { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40); }
async function registrarPagador(rid: string, nome: string): Promise<void> {
  const n = (nome || "").trim();
  if (!n) return;
  const id = `pag_${rid}_${slug(n)}`;
  await firestoreCriarSeAusente("investPagadores", id, { id, restaurantId: rid, nome: n, criadoEm: new Date().toISOString() }).catch(() => {});
}

// Resolve a categoria: reusa uma existente (por nome, case-insensitive) ou cria
// uma nova marcada como sugerida pela IA (criadaPorIa + confirmada:false).
// `catalogo` = lista já carregada de investCategorias (evita 2ª leitura).
async function resolverCategoria(rid: string, nome: string, catalogo: Record<string, unknown>[]): Promise<{ id: string; nome: string } | null> {
  const n = (nome || "").trim();
  if (!n) return null;
  const norm = (s: string) => s.toLowerCase().trim();
  const achada = catalogo.find((c) => c.restaurantId === rid && norm(String(c.nome || "")) === norm(n));
  if (achada) return { id: String(achada.id), nome: String(achada.nome) };
  const id = randomUUID();
  await firestoreCriar("investCategorias", id, { id, restaurantId: rid, nome: n, criadaPorIa: true, confirmada: false, criadoEm: new Date().toISOString() }).catch(() => {});
  return { id, nome: n };
}

// Cria um lançamento-rascunho em Novos Investimentos (origem bot). Devolve o id.
async function criarLancamento(ctx: BotCtx, d: {
  data?: string; estabelecimento?: string; categoriaId?: string | null; categoriaNome?: string | null; valor: number;
  formaPagamento?: string | null; pagoPor?: string | null; pagamentos?: Pagamento[] | null;
  comprovanteUrl?: string | null; descricao?: string;
  parcelado?: boolean; parcelas?: { n: number; data: string; valor: number; pago?: boolean }[]; semComprovante?: boolean;
}): Promise<{ id: string; seq?: number }> {
  const id = randomUUID();
  const nowISO = new Date().toISOString();
  const pagamentos = Array.isArray(d.pagamentos) ? d.pagamentos.filter((p) => p.pagador && Number(p.valor) > 0) : [];
  const rachado = pagamentos.length >= 2;
  const pagoPor = rachado ? null : ((d.pagoPor || ctx.msg.autor || "").trim() || null);   // padrão: quem mandou a mensagem
  const seq = ctx.projetoId ? await proximoSeq(ctx.rid, ctx.projetoId) : undefined;
  const obsPartes = [
    "via Bot · WhatsApp",
    d.descricao ? d.descricao : "",
    d.semComprovante ? "sem comprovante" : "",
  ].filter(Boolean);
  await firestoreCriar("investLancamentos", id, {
    id, restaurantId: ctx.rid, projetoId: ctx.projetoId,
    data: d.data || nowISO.slice(0, 10),
    estabelecimento: d.estabelecimento || d.descricao || "—",
    categoriaId: d.categoriaId || null, categoriaNome: d.categoriaNome || null,
    valor: Number(d.valor),
    formaPagamento: d.formaPagamento || null,
    pagoPor,
    ...(rachado ? { pagamentos } : {}),
    comprovanteUrl: d.comprovanteUrl || null,
    semComprovante: !!d.semComprovante,
    observacao: obsPartes.join(" · "),
    parcelado: !!d.parcelado, parcelas: Array.isArray(d.parcelas) ? d.parcelas : [],
    ...(seq != null ? { seq } : {}),
    origem: "bot", rascunho: true,
    criadoEm: nowISO, criadoPorNome: "Bot Planejamento.app",
  });
  if (rachado) { for (const p of pagamentos) await registrarPagador(ctx.rid, p.pagador); }
  else if (pagoPor) await registrarPagador(ctx.rid, pagoPor);
  return { id, seq };
}

// Próximo número curto por projeto (#NN). Lê o maior seq atual + 1. Volume baixo.
async function proximoSeq(rid: string, projetoId: string): Promise<number> {
  try {
    const todos = await firestoreListar("investLancamentos");
    const max = todos.filter((l) => l.restaurantId === rid && l.projetoId === projetoId)
      .reduce((m, l) => Math.max(m, Number(l.seq) || 0), 0);
    return max + 1;
  } catch { return 0; }
}

// Sócios configurados do projeto (nomes). Vazio se não configurado.
async function sociosDoProjeto(projetoId: string): Promise<string[]> {
  try {
    const p = await firestoreLer("investProjetos", projetoId);
    const socios = Array.isArray(p?.socios) ? p!.socios as Array<{ nome?: string }> : [];
    return socios.map((s) => String(s?.nome || "").trim()).filter(Boolean);
  } catch { return []; }
}

// Monta pagamentos a partir do que a IA extraiu: lista explícita, ou rateio
// igual entre os sócios do projeto. Devolve null = 1 pagador só.
function montarPagamentos(ext: { rateioIgual?: boolean; pagamentos?: Pagamento[] }, valorTotal: number, socios: string[]): Pagamento[] | null {
  const expl = Array.isArray(ext.pagamentos) ? ext.pagamentos.filter((p) => p.pagador && Number(p.valor) > 0) : [];
  if (expl.length >= 2) return expl;
  if (ext.rateioIgual && socios.length >= 2 && valorTotal > 0) {
    const cada = Math.round((valorTotal / socios.length) * 100) / 100;
    return socios.map((nome, i) => ({ pagador: nome, valor: i === socios.length - 1 ? Math.round((valorTotal - cada * (socios.length - 1)) * 100) / 100 : cada }));
  }
  return null;
}

// Confirmação curta no grupo, só se o modo pedir (silencioso = só a reação).
const fmtV = (n: number) => Number(n).toFixed(2).replace(".", ",");
async function confirmarNoGrupo(ctx: BotCtx, d: { estabelecimento?: string; valor: number; pagoPor?: string; pagamentos?: Pagamento[] | null; seq?: number; semComprovante?: boolean }): Promise<void> {
  if (ctx.modo === "silencioso") return;
  const quem = d.pagamentos && d.pagamentos.length >= 2
    ? ` · rachado: ${d.pagamentos.map((p) => `${p.pagador} R$ ${fmtV(p.valor)}`).join(", ")}`
    : (d.pagoPor ? ` · pago por ${d.pagoPor}` : "");
  const linha = `✅ Lancei${d.seq != null ? ` #${d.seq}` : ""}: ${d.estabelecimento || "gasto"} — R$ ${fmtV(d.valor)}${quem} (rascunho${d.semComprovante ? ", sem comprovante" : ""}).`;
  await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, linha, { quotedId: ctx.msg.id });
}

// ── Pendências (F2): dúvida/divergência → privado do responsável + Central ───
async function abrirPendencia(ctx: BotCtx, p: {
  campo: string; pergunta: string; tipo: "criar" | "corrigir"; lancamentoId?: string;
  dadosParciais?: Record<string, unknown>;
}): Promise<void> {
  const respDig = normalizarFone(ctx.responsavelWhatsapp || "");
  const id = randomUUID();
  const nowISO = new Date().toISOString();
  await firestoreCriar("botPendencias", id, {
    id, numeroId: ctx.numeroId, grupoWaId: ctx.waId, grupoNome: ctx.grupoNome,
    rid: ctx.rid, projetoId: ctx.projetoId,
    responsavelNumero: respDig, respKey: respDig ? respDig.slice(-8) : "",
    responsavelPessoaId: ctx.responsavelPessoaId || null,
    campo: p.campo, pergunta: p.pergunta, tipo: p.tipo,
    lancamentoId: p.lancamentoId || null, dadosParciais: p.dadosParciais || {},
    status: "aberta", criadoEm: nowISO,
  }).catch((e) => console.log("[bot] abrirPendencia:", (e as Error)?.message));

  // Mensagem no PRIVADO do responsável técnico (não polui o grupo).
  if (respDig) {
    const txt = `🤖 *Bot Planejamento.app*\nDúvida sobre o grupo "${ctx.grupoNome}":\n${p.pergunta}\n\n_Responda aqui mesmo que eu completo o lançamento._`;
    await enviarTexto(ctx.numeroId, respDig, txt);
  }
  // Aviso na Central (fonte da verdade / auditoria), se houver pessoa responsável.
  if (ctx.responsavelPessoaId) {
    await firestoreCriar("avisosDirecionados", randomUUID(), {
      restaurantId: ctx.rid, destinatarioIds: [ctx.responsavelPessoaId],
      titulo: `Bot: dúvida no grupo "${ctx.grupoNome}"`,
      texto: p.pergunta, icone: "bot", categoria: "Bot Planejamento.app",
      origem: "bot-monitor", criadoPorNome: "Bot Planejamento.app", criadoEm: nowISO,
    }).catch((e) => console.log("[bot] aviso:", (e as Error)?.message));
  }
}

// Chamado no webhook pra TODA msg privada recebida. Se bater com uma pendência
// aberta daquele número, interpreta a resposta e completa/corrige o lançamento.
export async function responderPendencia(numeroId: string, waId: string, msgId: string, texto: string): Promise<boolean> {
  const respKey = soDig(waId).slice(-8);
  if (!respKey) return false;
  let pend: Record<string, unknown> | null;
  try { pend = await firestoreConsultarUm("botPendencias", "respKey", respKey); } catch { return false; }
  if (!pend || pend.status !== "aberta" || pend.numeroId !== numeroId) return false;

  const campo = String(pend.campo || "valor");
  const dados = (pend.dadosParciais || {}) as Record<string, unknown>;
  const remoteJid = waId;   // privado: o próprio número

  if (campo === "valor") {
    const v = parseValor(texto);
    if (!(v > 0)) { await enviarTexto(numeroId, remoteJid, "Não entendi o valor. Pode mandar só o número? Ex.: 350"); return true; }
    dados.valor = v;
  } else {
    dados[campo] = texto.trim();
  }

  const pendId = String(pend.id || "");
  const ctxFake: BotCtx = {
    numeroId, waId: String(pend.grupoWaId || ""), ehGrupo: true,
    rid: String(pend.rid || ""), projetoId: pend.projetoId ? String(pend.projetoId) : null,
    modo: "silencioso", responsavelPessoaId: null, responsavelWhatsapp: null,
    grupoNome: String(pend.grupoNome || ""), chamado: false,
    config: {}, msg: { id: msgId, remoteJid, texto, autor: null, midiaUrl: null, mime: null },
  };

  if (pend.tipo === "corrigir" && pend.lancamentoId) {
    const patch: Record<string, unknown> = {};
    if (campo === "valor") patch.valor = dados.valor;
    else patch[campo] = dados[campo];
    await firestorePatchCampos("investLancamentos", String(pend.lancamentoId), patch).catch(() => {});
    await firestorePatchCampos("botPendencias", pendId, { status: "respondida", respKey: "", respondidoEm: new Date().toISOString() }).catch(() => {});
    await reagir(numeroId, remoteJid, msgId, "✅");
    await enviarTexto(numeroId, remoteJid, "Corrigido no lançamento. 👍");
    return true;
  }

  // tipo "criar": agora que temos o que faltava, cria o lançamento.
  if (!(Number(dados.valor) > 0)) {
    await firestorePatchCampos("botPendencias", pendId, { dadosParciais: dados }).catch(() => {});
    return true;
  }
  const catalogo = await firestoreListar("investCategorias").catch(() => [] as Record<string, unknown>[]);
  const cat = await resolverCategoria(ctxFake.rid, String(dados.categoriaNome || ""), catalogo);
  const { id: lancId } = await criarLancamento(ctxFake, {
    data: dados.data as string | undefined,
    estabelecimento: (dados.estabelecimento as string) || (dados.descricao as string) || undefined,
    categoriaId: cat?.id, categoriaNome: cat?.nome,
    valor: Number(dados.valor),
    formaPagamento: (dados.formaPagamento as string) || null,
    pagoPor: (dados.pagoPor as string) || null,
    comprovanteUrl: (dados.comprovanteUrl as string) || null,
    descricao: dados.descricao as string | undefined,
    semComprovante: !dados.comprovanteUrl,
  });
  await firestorePatchCampos("botPendencias", pendId, { status: "respondida", respKey: "", lancamentoId: lancId, respondidoEm: new Date().toISOString() }).catch(() => {});
  await reagir(numeroId, remoteJid, msgId, "✅");
  await enviarTexto(numeroId, remoteJid, `Lancei como rascunho: ${(dados.estabelecimento as string) || (dados.descricao as string) || "gasto"} — R$ ${Number(dados.valor).toFixed(2).replace(".", ",")}. Confira em Novos Investimentos.`);
  return true;
}

// ── Skill #1: lançar comprovante / custo em Novos Investimentos ──────────────
const skillInvestimentos: BotSkill = {
  id: "investimentos",
  match: (ctx) => {
    const temMidia = !!ctx.msg.midiaUrl && (/^image\//.test(ctx.msg.mime || "") || (ctx.msg.mime || "").includes("pdf"));
    return temMidia || pareceCusto(ctx.msg.texto);
  },
  handle: async (ctx) => {
    const docKey = `${ctx.numeroId}_${ctx.msg.id}`;
    const jaMsg = await firestoreLer("whatsappMensagens", docKey).catch(() => null);
    if (jaMsg?.botProcessado) return;                           // dedup: reentrega do webhook
    if (!ctx.rid || !ctx.projetoId) { await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "⚠️"); return; }

    const todas = await firestoreListar("investCategorias").catch(() => [] as Record<string, unknown>[]);
    const cats = todas.filter((c) => c.restaurantId === ctx.rid).map((c) => String(c.nome || "")).filter(Boolean);
    const socios = await sociosDoProjeto(ctx.projetoId);

    const temMidia = !!ctx.msg.midiaUrl && (/^image\//.test(ctx.msg.mime || "") || (ctx.msg.mime || "").includes("pdf"));

    // ── Caminho A: comprovante (imagem/PDF) ──
    if (temMidia) {
      const b64 = await urlParaBase64(ctx.msg.midiaUrl!);
      if (!b64) { await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "⚠️"); return; }
      const ext = await extrairComprovante(ctx.msg.mime!, b64, cats);
      // Imagem/PDF que claramente NÃO é comprovante (foto de obra, meme, print) →
      // ignora em silêncio, sem reação e sem incomodar o responsável.
      if (ext && ext.ehComprovante === false) {
        await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true }).catch(() => {});
        return;
      }
      if (!ext || !(Number(ext.valor) > 0)) {
        // Parece comprovante mas não leu o valor → ⚠️ + pergunta no privado (se houver).
        await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true, botFalhou: true }).catch(() => {});
        await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "⚠️");
        if (ctx.responsavelWhatsapp) {
          await abrirPendencia(ctx, {
            campo: "valor", tipo: "criar",
            pergunta: `Chegou um comprovante${ext?.estabelecimento ? ` de "${ext.estabelecimento}"` : ""} mas não consegui ler o valor. Qual é o valor em reais?`,
            dadosParciais: { estabelecimento: ext?.estabelecimento || "", categoriaNome: ext?.categoriaExistente || ext?.categoriaSugerida || "", formaPagamento: ext?.formaPagamento || "", data: ext?.data || "", comprovanteUrl: ctx.msg.midiaUrl, pagoPor: (ext?.pagador || ctx.msg.autor || "") },
          });
        }
        return;
      }
      // Coincidir: esse pagamento bate com uma parcela em aberto? Pergunta antes de duplicar.
      const casar = await acharParcelaParaCasar(ctx.rid, ctx.projetoId, Number(ext.valor));
      if (casar) {
        await firestoreCriar("botComandos", `${ctx.numeroId}__${ctx.waId}`, {
          numeroId: ctx.numeroId, waId: ctx.waId, tipo: "coincidir",
          lancamentoId: casar.lancId, seq: casar.seq, parcelaN: casar.parcelaN,
          dadosNovo: { data: ext.data || "", estabelecimento: ext.estabelecimento || "", categoriaNome: ext.categoriaExistente || ext.categoriaSugerida || "", valor: Number(ext.valor), formaPagamento: ext.formaPagamento || "", pagoPor: (ext.pagador || ctx.msg.autor || ""), comprovanteUrl: ctx.msg.midiaUrl || "" },
          status: "aberto", criadoEm: new Date().toISOString(),
        }).catch(() => {});
        await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true }).catch(() => {});
        await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "👀");
        await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Esse pagamento de R$ ${fmtV(Number(ext.valor))} é da parcela ${casar.parcelaN} do #${casar.seq} (${casar.estab})? Responda "sim" que eu quito, ou "não" que eu lanço como novo.`, { quotedId: ctx.msg.id });
        return;
      }
      const cat = await resolverCategoria(ctx.rid, ext.categoriaExistente || ext.categoriaSugerida || "", todas);
      const pagamentos = montarPagamentos(ext, Number(ext.valor), socios);
      const pagoPor = pagamentos ? undefined : ((ext.pagador || ctx.msg.autor || "").trim() || undefined);
      const parcelas = (ext.parcelas || []).map((p, i) => ({ n: i + 1, data: p.data, valor: Number(p.valor), pago: false }));
      const { id, seq } = await criarLancamento(ctx, {
        data: ext.data, estabelecimento: ext.estabelecimento,
        categoriaId: cat?.id, categoriaNome: cat?.nome,
        valor: Number(ext.valor), formaPagamento: ext.formaPagamento, pagoPor, pagamentos,
        comprovanteUrl: ctx.msg.midiaUrl, parcelado: ext.parcelado, parcelas: parcelas.length ? parcelas : undefined,
      });
      await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true, botLancamentoId: id }).catch(() => {});
      await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "✅");
      await confirmarNoGrupo(ctx, { estabelecimento: ext.estabelecimento, valor: Number(ext.valor), pagoPor, pagamentos, seq });
      return;
    }

    // ── Caminho B: custo em texto ("paguei 300 de areia") ──
    const ct = await extrairCustoTexto(ctx.msg.texto, cats);
    if (!ct || !ct.ehCusto) return;                             // conversa comum → ignora em silêncio
    await firestorePatchCampos("whatsappMensagens", docKey, { botProcessado: true }).catch(() => {});
    if (!(Number(ct.valor) > 0)) {
      // Parece gasto mas sem valor → pergunta (privado) ou no grupo se modo=pergunta.
      const pergunta = `Vi "${ct.descricao || "um gasto"}"${ct.estabelecimento ? ` (${ct.estabelecimento})` : ""} no grupo "${ctx.grupoNome}", mas sem o valor. Quanto foi?`;
      if (ctx.responsavelWhatsapp) {
        await abrirPendencia(ctx, { campo: "valor", tipo: "criar", pergunta, dadosParciais: { descricao: ct.descricao || "", estabelecimento: ct.estabelecimento || "", categoriaNome: ct.categoriaExistente || ct.categoriaSugerida || "", formaPagamento: ct.formaPagamento || "", data: ct.data || "", pagoPor: (ct.pagador || ctx.msg.autor || "") } });
        await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "👀");
      } else if (ctx.modo === "pergunta") {
        await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Anotei "${ct.descricao || "o gasto"}" — qual foi o valor?`, { quotedId: ctx.msg.id });
      }
      return;
    }
    const cat = await resolverCategoria(ctx.rid, ct.categoriaExistente || ct.categoriaSugerida || "", todas);
    const pagamentos = montarPagamentos(ct, Number(ct.valor), socios);
    const pagoPor = pagamentos ? undefined : ((ct.pagador || ctx.msg.autor || "").trim() || undefined);
    const { id, seq } = await criarLancamento(ctx, {
      data: ct.data, estabelecimento: ct.estabelecimento || ct.descricao,
      categoriaId: cat?.id, categoriaNome: cat?.nome,
      valor: Number(ct.valor), formaPagamento: ct.formaPagamento, pagoPor, pagamentos,
      descricao: ct.descricao, semComprovante: true,
    });
    await firestorePatchCampos("whatsappMensagens", docKey, { botLancamentoId: id }).catch(() => {});
    await reagir(ctx.numeroId, ctx.msg.remoteJid, ctx.msg.id, "✅");
    await confirmarNoGrupo(ctx, { estabelecimento: ct.estabelecimento || ct.descricao, valor: Number(ct.valor), pagoPor, pagamentos, seq, semComprovante: true });
  },
};

const REGISTRY: Record<string, BotSkill> = { investimentos: skillInvestimentos };

// ── F3: o bot RESPONDE no grupo quando é CHAMADO (menção/reply) ──────────────
async function responderNoGrupo(ctx: BotCtx): Promise<void> {
  const docKey = `${ctx.numeroId}_${ctx.msg.id}`;
  const jaMsg = await firestoreLer("whatsappMensagens", docKey).catch(() => null);
  if (jaMsg?.botRespondido) return;                             // dedup

  // Contexto: últimos lançamentos que o bot fez nesse projeto.
  let resumo = "(ainda sem lançamentos)";
  try {
    const todos = await firestoreListar("investLancamentos");
    const meus = todos
      .filter((l) => l.restaurantId === ctx.rid && l.projetoId === ctx.projetoId && l.origem === "bot")
      .sort((a, b) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
      .slice(0, 8);
    if (meus.length) {
      const total = meus.reduce((s, l) => s + (Number(l.valor) || 0), 0);
      resumo = meus.map((l) => `• ${fmtBR(String(l.data || l.criadoEm))} — ${l.estabelecimento || "—"} — R$ ${(Number(l.valor) || 0).toFixed(2).replace(".", ",")}${l.rascunho ? " (rascunho)" : ""}`).join("\n")
        + `\n(soma destes: R$ ${total.toFixed(2).replace(".", ",")})`;
    }
  } catch { /* segue sem resumo */ }

  const system = `Você é o "Bot Planejamento.app", um assistente dentro de um grupo de WhatsApp de sócios de um restaurante. Sua função nesse grupo "${ctx.grupoNome}": ler comprovantes e gastos e lançá-los em Novos Investimentos (como rascunho). Alguém te chamou (marcou ou respondeu sua mensagem). Responda em português do Brasil, curto e direto (1-3 frases), tom humano e prestativo, SEM formalidade excessiva, sem emoji em excesso. Se perguntarem algo fora do seu escopo (que não seja sobre os gastos/lançamentos desse projeto), diga com gentileza que aqui você só cuida dos lançamentos de investimento. Não invente números — use só o que está no resumo.
Últimos lançamentos deste projeto:
${resumo}`;
  const resp = await claudeTexto(system, ctx.msg.texto || "(me chamaram)", 400);
  if (!resp) return;
  await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, resp, { quotedId: ctx.msg.id });
  await firestorePatchCampos("whatsappMensagens", docKey, { botRespondido: true }).catch(() => {});
}

// ── Comandos no grupo (excluir / quitar parcela / coincidir pagamento) ───────
const CMD_TTL_MS = 15 * 60 * 1000;
const cmdExpirado = (iso?: string) => !iso || (Date.now() - new Date(String(iso)).getTime()) > CMD_TTL_MS;
async function acharPorSeq(rid: string, projetoId: string | null, seq: number): Promise<Record<string, unknown> | null> {
  try {
    const todos = await firestoreListar("investLancamentos");
    return todos.find((l) => l.restaurantId === rid && l.projetoId === projetoId && Number(l.seq) === seq && !l.excluido) || null;
  } catch { return null; }
}
async function quitarParcelaN(lancId: string, n: number): Promise<void> {
  const l = await firestoreLer("investLancamentos", lancId).catch(() => null);
  if (!l) return;
  const parc = Array.isArray(l.parcelas) ? l.parcelas as Array<Record<string, unknown>> : [];
  const nova = parc.map((p) => Number(p.n) === n ? { ...p, pago: true, pagoEm: new Date().toISOString() } : p);
  await firestorePatchCampos("investLancamentos", lancId, { parcelas: nova }).catch(() => {});
}
// Procura 1 parcela em aberto que case com o valor de um pagamento recém-recebido.
async function acharParcelaParaCasar(rid: string, projetoId: string | null, valor: number): Promise<{ lancId: string; seq: number; parcelaN: number; estab: string } | null> {
  if (!(valor > 0)) return null;
  const hoje = new Date(); const limInf = new Date(hoje); limInf.setDate(limInf.getDate() - 30); const limSup = new Date(hoje); limSup.setDate(limSup.getDate() + 15);
  const tol = Math.max(1, valor * 0.01);
  try {
    const todos = await firestoreListar("investLancamentos");
    const cand: { lancId: string; seq: number; parcelaN: number; estab: string }[] = [];
    for (const l of todos) {
      if (l.restaurantId !== rid || l.projetoId !== projetoId || l.excluido || !l.parcelado) continue;
      const parc = Array.isArray(l.parcelas) ? l.parcelas as Array<Record<string, unknown>> : [];
      for (const p of parc) {
        if (p.pago) continue;
        const d = new Date(String(p.data) + "T00:00:00");
        if (Math.abs(Number(p.valor) - valor) <= tol && d >= limInf && d <= limSup) {
          cand.push({ lancId: String(l.id), seq: Number(l.seq) || 0, parcelaN: Number(p.n) || 0, estab: String(l.estabelecimento || "—") });
        }
      }
    }
    return cand.length === 1 ? cand[0] : null;   // só casa se não houver ambiguidade
  } catch { return null; }
}
async function limparComando(numeroId: string, waId: string): Promise<void> {
  await firestorePatchCampos("botComandos", `${numeroId}__${waId}`, { status: "fechado", fechadoEm: new Date().toISOString() }).catch(() => {});
}
async function tratarComandoGrupo(ctx: BotCtx): Promise<boolean> {
  if (!ctx.ehGrupo) return false;
  const texto = (ctx.msg.texto || "").trim();
  const cmdDoc = `${ctx.numeroId}__${ctx.waId}`;
  const afirm = /^\s*(sim|confirmar?|confirmo|ok|isso|pode|manda|claro|aham|quito|é|eh)\b/i.test(texto);
  const neg = /^\s*(n[aã]o|nao|cancela\w*|deixa|esquece)\b/i.test(texto);

  // 1) Resolver uma confirmação pendente
  const pend = await firestoreLer("botComandos", cmdDoc).catch(() => null);
  if (pend && pend.status === "aberto" && !cmdExpirado(String(pend.criadoEm))) {
    if (afirm) {
      if (pend.tipo === "excluir" && pend.lancamentoId) {
        await firestorePatchCampos("investLancamentos", String(pend.lancamentoId), { excluido: true, excluidoEm: new Date().toISOString() }).catch(() => {});
        await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Excluído #${pend.seq}. ✅`, { quotedId: ctx.msg.id });
      } else if ((pend.tipo === "quitar" || pend.tipo === "coincidir") && pend.lancamentoId) {
        await quitarParcelaN(String(pend.lancamentoId), Number(pend.parcelaN));
        await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Parcela ${pend.parcelaN} do #${pend.seq} quitada. ✅`, { quotedId: ctx.msg.id });
      }
      await limparComando(ctx.numeroId, ctx.waId);
      return true;
    }
    if (neg) {
      if (pend.tipo === "coincidir" && pend.dadosNovo) {
        const d = pend.dadosNovo as Record<string, unknown>;
        await criarLancamento(ctx, { data: d.data as string, estabelecimento: d.estabelecimento as string, categoriaNome: (d.categoriaNome as string) || null, valor: Number(d.valor), formaPagamento: (d.formaPagamento as string) || null, pagoPor: (d.pagoPor as string) || null, comprovanteUrl: (d.comprovanteUrl as string) || null });
        await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, "Ok, lancei como novo. ✅", { quotedId: ctx.msg.id });
      } else {
        await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, "Ok, cancelei.", { quotedId: ctx.msg.id });
      }
      await limparComando(ctx.numeroId, ctx.waId);
      return true;
    }
    // outra coisa → deixa a pendência expirar sozinha, segue o fluxo normal
  }

  // 2) Novo comando de EXCLUSÃO
  const mEx = texto.match(/(?:excluir|apagar|remover|deletar)\s+(?:o\s+)?(?:lan[çc]amento\s*)?#?\s*(\d{1,6})/i);
  if (mEx) {
    const seq = Number(mEx[1]);
    const alvo = await acharPorSeq(ctx.rid, ctx.projetoId, seq);
    if (!alvo) { await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Não achei o lançamento #${seq} nesse projeto.`, { quotedId: ctx.msg.id }); return true; }
    await firestoreCriar("botComandos", cmdDoc, { numeroId: ctx.numeroId, waId: ctx.waId, tipo: "excluir", lancamentoId: String(alvo.id), seq, status: "aberto", criadoEm: new Date().toISOString() });
    await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Vou excluir #${seq}: ${alvo.estabelecimento || "—"} — R$ ${fmtV(Number(alvo.valor))}. Confirmar? (responda "sim")`, { quotedId: ctx.msg.id });
    return true;
  }

  // 3) Novo comando de QUITAR PARCELA ("quitar parcela 2 do #42")
  const mQ = texto.match(/quitar\s+(?:a\s+)?parcela\s*(\d{1,3})\b.*?#?\s*(\d{1,6})/i);
  if (mQ) {
    const parcelaN = Number(mQ[1]); const seq = Number(mQ[2]);
    const alvo = await acharPorSeq(ctx.rid, ctx.projetoId, seq);
    if (!alvo) { await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Não achei o lançamento #${seq}.`, { quotedId: ctx.msg.id }); return true; }
    const parc = Array.isArray(alvo.parcelas) ? alvo.parcelas as Array<Record<string, unknown>> : [];
    const alvoP = parc.find((p) => Number(p.n) === parcelaN);
    if (!alvoP) { await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `O #${seq} não tem parcela ${parcelaN}.`, { quotedId: ctx.msg.id }); return true; }
    await firestoreCriar("botComandos", cmdDoc, { numeroId: ctx.numeroId, waId: ctx.waId, tipo: "quitar", lancamentoId: String(alvo.id), seq, parcelaN, status: "aberto", criadoEm: new Date().toISOString() });
    await enviarTexto(ctx.numeroId, ctx.msg.remoteJid, `Quitar parcela ${parcelaN}/${parc.length} do #${seq} (R$ ${fmtV(Number(alvoP.valor))})? Confirmar? (responda "sim")`, { quotedId: ctx.msg.id });
    return true;
  }
  return false;
}

// ── Entrada: roda o monitor (se houver) pra uma conversa/grupo ───────────────
// Retorna true se a conversa é monitorada (o webhook NÃO roda atendimento humano).
export async function rodarMonitor(opts: {
  numeroId: string; waId: string; remoteJid: string; msgId: string; texto: string;
  midia: { url: string; mime: string } | null; autor: string | null;
  fromMe: boolean; quotedId?: string | null; mentionedJids?: string[] | null;
}): Promise<boolean> {
  const { numeroId, waId, remoteJid, msgId, texto, midia, autor, fromMe } = opts;
  const monId = `${numeroId}__${waId}`;
  let config: Record<string, unknown> | null;
  try { config = await firestoreLer("whatsappMonitores", monId); } catch { return false; }
  if (!config || config.ativo === false) return false;         // não monitorado → fluxo normal
  if (fromMe) return true;                                      // anti-loop: ignora o que o próprio número manda

  const skillsIds = Array.isArray(config.skills) ? config.skills.map(String)
    : (config.finalidade ? [String(config.finalidade)] : []);
  const ehGrupo = waId.startsWith("g:") || remoteJid.endsWith("@g.us");

  // CHAMADO? menção @ (mentionedJids inclui o número próprio) ou reply à msg do bot.
  let chamado = false;
  try {
    const own = await numeroProprioDigits(numeroId);
    const menc = (opts.mentionedJids || []).map((j) => soDig(String(j).split("@")[0]));
    if (own && menc.some((m) => m && (m === own || m.slice(-8) === own.slice(-8)))) chamado = true;
    if (!chamado && opts.quotedId) {
      const q = await firestoreLer("whatsappMensagens", `${numeroId}_${opts.quotedId}`).catch(() => null);
      if (q && q.direcao === "out") chamado = true;            // respondeu uma mensagem do bot
    }
  } catch { /* ignora */ }

  const ctx: BotCtx = {
    numeroId, waId, ehGrupo,
    rid: String(config.restaurantId || ""),
    projetoId: config.projetoId ? String(config.projetoId) : null,
    modo: String(config.modo || "silencioso"),
    responsavelPessoaId: config.responsavelPessoaId ? String(config.responsavelPessoaId) : null,
    responsavelWhatsapp: config.responsavelWhatsapp ? String(config.responsavelWhatsapp) : null,
    grupoNome: String(config.nome || "grupo"), chamado,
    config,
    msg: { id: msgId, remoteJid, texto, autor, midiaUrl: midia?.url || null, mime: midia?.mime || null },
  };

  // Comandos no grupo (excluir / quitar / confirmar coincidência) têm prioridade.
  if (ehGrupo) {
    try { if (await tratarComandoGrupo(ctx)) return true; }
    catch (e) { console.log("[bot] comando:", (e as Error)?.message); }
  }

  for (const sid of skillsIds) {
    const skill = REGISTRY[sid];
    if (!skill) continue;
    try { if (skill.match(ctx)) await skill.handle(ctx); }
    catch (e) { console.log(`[bot] skill ${sid}:`, (e as Error)?.message); }
  }
  if (chamado && ehGrupo) {
    try { await responderNoGrupo(ctx); }
    catch (e) { console.log("[bot] responderNoGrupo:", (e as Error)?.message); }
  }
  return true;   // conversa é do bot → não cair no atendimento humano
}

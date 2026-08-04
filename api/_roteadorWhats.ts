// ════════════════════════════════════════════════════════════════════════════
//  Roteador do WhatsApp (número da API) → Agentes de IA.
//
//  Quando chega mensagem no número oficial (Cloud API), decide qual agente
//  responde e devolve a resposta pelo mesmo número:
//   - agentes DISPONÍVEIS pro remetente = ativos cujo `numerosWhatsapp` inclui
//     o número (autorização por número).
//   - 0 disponíveis → ignora (não responde).
//   - 1 disponível → fala direto com ele.
//   - >1 → mostra um menu ("1) DP  2) Financeiro …") e memoriza a escolha.
//  Sessão por remetente em `whatsappAgenteSessoes/{numero}`. Contexto entre
//  turnos em `agenteMensagens` (conversaId = `${agenteId}__wa_${numero}`).
// ════════════════════════════════════════════════════════════════════════════
import { firestoreListar, firestoreLer, firestoreCriar, firestoreAtualizar } from "./_firestoreRest.js";
import { runAgenteCore } from "./agente.js";

type Doc = Record<string, unknown>;
const soDig = (s?: string) => (s || "").replace(/\D/g, "");
// Chave BR: ignora DDI 55 e o 9º dígito de celular → casa formatos diferentes.
function chaveBR(raw?: string): string {
  let d = soDig(raw);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : d;
}
const numeroBate = (autorizado: string, from: string) => chaveBR(autorizado) === chaveBR(from);
const rid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// Devolve null em caso de sucesso, ou uma string com o motivo da falha (pra
// registrar/diagnosticar — ex.: número não autorizado na Meta em modo teste).
async function enviarWhats(to: string, texto: string): Promise<string | null> {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  const versao = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneId) return "credenciais do WhatsApp ausentes";
  if (!texto.trim()) return "texto vazio";
  try {
    const r = await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: soDig(to), type: "text", text: { preview_url: true, body: texto.slice(0, 4000) } }),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); return `HTTP ${r.status}: ${t.slice(0, 300)}`; }
    return null;
  } catch (e) { return e instanceof Error ? e.message : "erro de rede"; }
}

// Marca a mensagem recebida como LIDA (✓✓ azul) e liga o indicador "digitando…".
// O "digitando" some sozinho em ~25s ou quando a gente responde.
async function marcarLidoDigitando(messageId: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  const versao = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneId || !messageId) return;
  try {
    await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
    });
  } catch { /* best-effort */ }
}

async function enviarWhatsDoc(to: string, link: string, filename: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  const versao = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneId || !link) return;
  try {
    await fetch(`https://graph.facebook.com/${versao}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: soDig(to), type: "document", document: { link, filename } }),
    });
  } catch { /* best-effort */ }
}

const menuTexto = (agentes: Doc[]) =>
  "Com qual assistente você quer falar? Responde só o número:\n" +
  agentes.map((a, i) => `${i + 1}) ${a.nome as string}`).join("\n");

// ── Áudio (nota de voz): baixa a mídia da Meta e transcreve (Gemini) ─────────
function mimeAudio(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("audio/")) {
    if (m.includes("ogg") || m.includes("opus")) return "audio/ogg";
    if (m.includes("mpeg") || m.includes("mp3")) return "audio/mp3";
    if (m.includes("wav")) return "audio/wav";
    if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "audio/mp4";
    if (m.includes("webm")) return "audio/webm";
    return m;
  }
  return "audio/ogg";
}
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-1.5-flash"];
async function baixarMidiaWhats(mediaId: string): Promise<{ base64: string; mime: string } | null> {
  const token = process.env.WHATSAPP_TOKEN;
  const versao = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !mediaId) return null;
  try {
    const r1 = await fetch(`https://graph.facebook.com/${versao}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
    const j1 = (await r1.json()) as { url?: string; mime_type?: string };
    if (!j1.url) return null;
    const r2 = await fetch(j1.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r2.ok) return null;
    const buf = Buffer.from(await r2.arrayBuffer());
    return { base64: buf.toString("base64"), mime: j1.mime_type || "audio/ogg" };
  } catch { return null; }
}
async function transcreverAudio(base64: string, mime: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !base64) return "";
  const payload = { contents: [{ parts: [
    { text: "Transcreva EXATAMENTE o que é falado neste áudio, em português do Brasil. Responda SOMENTE a transcrição, sem comentários, sem aspas, sem rótulos." },
    { inline_data: { mime_type: mimeAudio(mime), data: base64 } },
  ] }], generationConfig: { temperature: 0 } };
  for (const m of GEMINI_MODELS) {
    try {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const txt = await resp.text();
      if (resp.ok) {
        const j = JSON.parse(txt) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join(" ").replace(/\s+/g, " ").trim();
      }
      if (resp.status !== 404) break; // 429/403/500 → trocar de modelo não ajuda
    } catch { break; }
  }
  return "";
}
// Nota de voz recebida: transcreve e trata como se fosse texto.
export async function atenderWhatsAudio(from: string, mediaId: string, nome?: string | null, messageId?: string): Promise<void> {
  if (!from || !mediaId) return;
  const todos = await firestoreListar("agentesIA");
  const autorizado = todos.some(a => a.ativo !== false && Array.isArray(a.numerosWhatsapp) && (a.numerosWhatsapp as string[]).some(n => numeroBate(n, from)));
  if (!autorizado) return;
  if (messageId) await marcarLidoDigitando(messageId);
  const audio = await baixarMidiaWhats(mediaId);
  if (!audio) { await enviarWhats(from, "Recebi seu áudio, mas não consegui baixar 🙏 Consegue me mandar por escrito?"); return; }
  const texto = await transcreverAudio(audio.base64, audio.mime);
  if (!texto) { await enviarWhats(from, "Recebi seu áudio, mas não consegui transcrever agora 🙏 Consegue me mandar por escrito?"); return; }
  await atenderWhatsAgente(from, texto, nome, messageId);
}

export async function atenderWhatsAgente(from: string, textoIn: string, nome?: string | null, messageId?: string): Promise<void> {
  const texto = (textoIn || "").trim();
  if (!from || !texto) return;

  const todos = await firestoreListar("agentesIA");
  const agentes = todos.filter(a =>
    a.ativo !== false && Array.isArray(a.numerosWhatsapp) &&
    (a.numerosWhatsapp as string[]).some(n => numeroBate(n, from)),
  );
  if (!agentes.length) return; // ninguém liberado pra este número → ignora silenciosamente

  const sid = chaveBR(from);
  const sessao = (await firestoreLer("whatsappAgenteSessoes", sid)) as Doc | null;
  const low = texto.toLowerCase();
  const now = () => new Date().toISOString();
  // PATCH (upsert) — NÃO firestoreCriar, que é create-only e não atualiza um doc
  // de sessão já existente (deixaria aguardandoEscolha/agenteId travados).
  const salvarSessao = (agenteId: string | null, aguardando: boolean) =>
    firestoreAtualizar("whatsappAgenteSessoes", sid, { waId: from, agenteId, aguardandoEscolha: aguardando, atualizadoEm: now() }).catch(() => {});

  // Troca por NOME: acha um agente cujo nome distintivo aparece na mensagem
  // (ex.: "conecta no Sororoca"). Ignora palavras genéricas do nome.
  const GENERICOS = ["agente", "cardápio", "cardapio", "assistente", "dos", "das", "com", "site", "novo"];
  const achaPorNome = (): Doc | null => {
    for (const a of agentes) {
      const palavras = ((a.nome as string) || "").toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !GENERICOS.includes(w));
      if (palavras.some(w => low.includes(w))) return a;
    }
    return null;
  };
  const nomeAlvo = achaPorNome();
  // Intenção de trocar de agente (linguagem natural), sem confundir com "trocar o preço".
  const menuIntent = /(menu|lista de agentes|outro agente|outro assistente|trocar de agente|trocar agente|mud[ae]r? de agente|desconect)/i.test(low)
    || ["menu", "agentes", "assistentes", "trocar", "voltar"].includes(low);
  const switchVerbo = /(fala[r]? com|conect|troc|mud[ao]|quero (o |a )?outro|passa (pro|para)|abre a|abrir a|vai (pro|para))/i.test(low);
  const querTrocar = menuIntent || (!!nomeAlvo && switchVerbo);

  // Resolve o agente a usar.
  let agente: Doc | null = (!querTrocar && sessao?.agenteId && !sessao?.aguardandoEscolha)
    ? (agentes.find(a => a.id === sessao.agenteId) || null) : null;

  if (!agente) {
    if (agentes.length === 1) {
      agente = agentes[0];
      await salvarSessao(agente.id as string, false);
    } else if (querTrocar || sessao?.aguardandoEscolha) {
      // Escolha por número, ou por nome ("Sororoca") — troca direto.
      const idx = parseInt(low, 10);
      const escolhido = (Number.isFinite(idx) && idx >= 1 && idx <= agentes.length) ? agentes[idx - 1] : nomeAlvo;
      if (escolhido) {
        await salvarSessao(escolhido.id as string, false);
        await enviarWhats(from, `Pronto, falando com *${escolhido.nome}* agora 👍 Manda sua pergunta.`);
        return;
      }
      await salvarSessao((sessao?.agenteId as string) || null, true);
      await enviarWhats(from, "Qual assistente? " + menuTexto(agentes));
      return;
    } else {
      // Sem sessão e sem intenção clara → mostra o menu.
      await salvarSessao((sessao?.agenteId as string) || null, true);
      await enviarWhats(from, menuTexto(agentes));
      return;
    }
  }

  // Sinal de que recebeu e está trabalhando: ✓✓ azul + "digitando…".
  if (messageId) await marcarLidoDigitando(messageId);

  // Roda o agente resolvido com o histórico da conversa.
  const conversaId = `${agente.id}__wa_${sid}`;
  const hist = (await firestoreListar("agenteMensagens"))
    .filter(m => m.conversaId === conversaId)
    .sort((a, b) => String(a.criadoEm || "").localeCompare(String(b.criadoEm || "")))
    .slice(-12)
    .map(m => ({ role: m.role as string, texto: m.texto as string }));

  await firestoreCriar("agenteMensagens", `am_${rid()}`, {
    agenteId: agente.id, conversaId, restaurantId: null, role: "user", texto, pessoaId: null, pessoaNome: nome || null, canal: "whatsapp", criadoEm: now(),
  }).catch(() => {});

  let out;
  try {
    out = await runAgenteCore(agente, { mensagem: texto, historico: hist, pessoaNome: nome || from, pessoaId: `wa_${sid}`, canal: "whatsapp" });
  } catch {
    await enviarWhats(from, "Tive um problema pra responder agora. Tenta de novo daqui a pouco 🙏");
    return;
  }
  const resposta = (out.resposta || "").trim() || "(sem resposta)";
  await firestoreCriar("agenteMensagens", `am_${rid()}`, {
    agenteId: agente.id, conversaId, restaurantId: null, role: "assistant", texto: resposta, pessoaId: null, canal: "whatsapp", pdfUrl: out.pdfUrl || null, previaUrl: out.previaUrl || null, criadoEm: now(),
  }).catch(() => {});
  // Texto (+ link de prévia HTML pra aprovar). O PDF vai como DOCUMENTO de verdade.
  const linhas = [resposta];
  if (out.previaUrl) linhas.push(`🔗 Prévia pra conferir/aprovar:\n${out.previaUrl}`);
  const errEnvio = await enviarWhats(from, linhas.join("\n\n"));
  if (errEnvio) {
    // A resposta ficou registrada mas NÃO chegou no WhatsApp — deixa o motivo
    // visível no app pra diagnosticar (comum: número não é destinatário
    // autorizado na Meta enquanto o app está em modo teste/desenvolvimento).
    await firestoreCriar("agenteMensagens", `am_${rid()}`, {
      agenteId: agente.id, conversaId, restaurantId: null, role: "assistant",
      texto: `⚠️ A resposta acima NÃO foi entregue no WhatsApp. Motivo: ${errEnvio}\n\nSe for "não autorizado"/#131030, adicione o número como destinatário de teste no painel da Meta (ou coloque o app em produção).`,
      pessoaId: null, canal: "sistema", criadoEm: now(),
    }).catch(() => {});
  }
  if (out.pdfUrl) await enviarWhatsDoc(from, out.pdfUrl, "cardapio-puba.pdf");
}

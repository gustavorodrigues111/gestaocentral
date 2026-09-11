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

// Foto (ex.: rótulo de vinho): baixa e manda pro agente como ANEXO (o agente lê
// a imagem). A legenda vira o texto. Sem legenda, o agente age só pela imagem.
export async function atenderWhatsImagem(from: string, mediaId: string, caption?: string, nome?: string | null, messageId?: string): Promise<void> {
  if (!from || !mediaId) return;
  const todos = await firestoreListar("agentesIA");
  const autorizado = todos.some(a => a.ativo !== false && Array.isArray(a.numerosWhatsapp) && (a.numerosWhatsapp as string[]).some(n => numeroBate(n, from)));
  if (!autorizado) return;
  if (messageId) await marcarLidoDigitando(messageId);
  const img = await baixarMidiaWhats(mediaId);
  if (!img) { await enviarWhats(from, "Recebi sua foto, mas não consegui baixar 🙏 Tenta mandar de novo?"); return; }
  await atenderWhatsAgente(from, caption || "", nome, messageId, { base64: img.base64, mediaType: img.mime });
}

export async function atenderWhatsAgente(from: string, textoIn: string, nome?: string | null, messageId?: string, anexo?: { base64: string; mediaType: string }): Promise<void> {
  const texto = (textoIn || "").trim();
  if (!from || (!texto && !anexo)) return;

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
    firestoreAtualizar("whatsappAgenteSessoes", sid, { waId: from, agenteId, aguardandoEscolha: aguardando, aguardandoRetomada: false, atualizadoEm: now() }).catch(() => {});
  // Ociosidade: > 2h desde a última mensagem → "desconecta" do último agente e
  // re-roteia pela mensagem NOVA (sem perguntar continuar/nova).
  const MS_INATIVO = 2 * 60 * 60 * 1000;
  const ultimaAtiv = sessao?.atualizadoEm ? Date.parse(sessao.atualizadoEm as string) : 0;
  const inativoOcioso = ultimaAtiv > 0 && (Date.now() - ultimaAtiv) > MS_INATIVO;

  // ── Reconhecimento do agente por LINGUAGEM NATURAL (sem exigir verbo) ──────
  // Pontua cada agente pelas palavras da mensagem: palavras distintivas do NOME
  // (puba, sororoca, altec, lobozó…) + sinônimos do TIPO (cardápio→menu,
  // vendas→altec/faturamento…). Vence quem tiver mais acertos, sem empate.
  const lowN = low.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const temToken = (t: string) => new RegExp(`\\b${esc(t)}\\b`).test(lowN);
  const DROP = new Set(["agente", "assistente", "dos", "das", "com", "novo", "the", "bar", "restaurante"]);
  const TIPO_SYN: Record<string, string[]> = {
    cardapio: ["cardapio", "menu", "filipeta", "pdf"],
    vendas: ["vendas", "venda", "faturamento", "altec", "pdv", "produto", "produtos", "relatorio"],
    dp: ["dp", "ponto", "folha", "rh"],
    financeiro: ["financeiro", "caixa", "fechamento", "contas", "conta"],
  };
  const tokensAgente = (a: Doc): string[] => {
    const nm = String(a.nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const ws = nm.split(/\s+/).filter(w => w.length >= 3 && !DROP.has(w));
    return [...new Set([...ws, ...(TIPO_SYN[String(a.tipo)] || [])])];
  };
  const score = (a: Doc) => tokensAgente(a).filter(temToken).length;
  const ranked = agentes.map(a => ({ a, s: score(a) })).sort((x, y) => y.s - x.s);
  const clearAlvo: Doc | null = (ranked[0] && ranked[0].s >= 1 && (!ranked[1] || ranked[1].s < ranked[0].s)) ? ranked[0].a : null;

  // Sobrou pergunta de verdade (além de só nomear o agente / cumprimentar)?
  const limpaGenerico = (s: string) => s
    .replace(/\b(fala[r]?|com|conect\w*|troc\w*|mud\w*|abre|abrir|vai|pro|para|quero|no|na|do|da|de|o|a|agente|assistente|oi|ola|opa|eai|eae|bom|boa|dia|tarde|noite|tudo|bem|blz|beleza|obrigad\w*|valeu|por favor|pf)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  const temPergunta = (a: Doc): boolean => {
    let resto = lowN;
    for (const t of tokensAgente(a)) resto = resto.replace(new RegExp(`\\b${esc(t)}\\b`, "g"), " ");
    return limpaGenerico(resto).length >= 3;
  };
  const temSubstancia = limpaGenerico(lowN).length >= 3;

  // Pedido explícito da LISTA de agentes.
  const querMenu = /^\s*(menu|agentes|assistentes|lista)\s*[?.!]?\s*$/.test(lowN)
    || /\b(quais|que|lista de|mostr\w*|quero ver|op[cç]\w*)\b[^]*\b(agente|agentes|assistente|assistentes)\b/.test(lowN)
    || /\b(outro|outra|trocar de|mudar de|muda de)\b[^]*\b(agente|assistente)\b/.test(lowN)
    || /\bdesconect\w*/.test(lowN);

  const atual = agentes.find(a => a.id === sessao?.agenteId) || null;
  const apresenta = (a: Doc) => `👋 Aqui é o *${a.nome}*. Pode mandar sua pergunta!`;

  // ── Decisão de roteamento ──────────────────────────────────────────────────
  if (querMenu) {
    await salvarSessao((sessao?.agenteId as string) || null, true);
    await enviarWhats(from, menuTexto(agentes));
    return;
  }

  let agente: Doc | null = null;
  let prefixo = "";   // frase de reconhecimento colada antes da resposta

  if (sessao?.aguardandoEscolha) {
    // Já mostramos o menu: aceita número OU nome.
    const idx = parseInt(lowN, 10);
    const escolhido = (Number.isFinite(idx) && idx >= 1 && idx <= agentes.length) ? agentes[idx - 1] : clearAlvo;
    if (!escolhido) {
      await salvarSessao((sessao?.agenteId as string) || null, true);
      await enviarWhats(from, "Não entendi qual 🙏 " + menuTexto(agentes));
      return;
    }
    agente = escolhido;
    if (!temPergunta(escolhido)) { await salvarSessao(escolhido.id as string, false); await enviarWhats(from, apresenta(escolhido)); return; }
  } else if (agentes.length === 1) {
    agente = agentes[0];
  } else if (clearAlvo) {
    // Nome citado → vai direto pra ele (mesmo sem verbo de troca).
    agente = clearAlvo;
    const trocou = clearAlvo.id !== atual?.id;
    if (!temPergunta(clearAlvo)) { await salvarSessao(clearAlvo.id as string, false); await enviarWhats(from, apresenta(clearAlvo)); return; }
    if (trocou) prefixo = inativoOcioso ? `Opa, entendi que você quer falar com *${clearAlvo.nome}* 👇` : `*${clearAlvo.nome}* na área 👋`;
  } else if (atual) {
    // Sem nome citado → segue no agente atual. Se ficou 2h ocioso e a mensagem
    // é só um "oi", ele se reapresenta; senão responde direto (conversa fluida).
    agente = atual;
    if (inativoOcioso && !temSubstancia) { await salvarSessao(atual.id as string, false); await enviarWhats(from, `Oi! 👋 Seguimos com *${atual.nome}*. Como posso ajudar?`); return; }
  } else {
    // Primeiro contato, multi-agente e sem pista → menu.
    await salvarSessao(null, true);
    await enviarWhats(from, menuTexto(agentes));
    return;
  }

  if (!agente) return;
  await salvarSessao(agente.id as string, false);

  // ── MODO TESTE (só master, só agente do Puba por ora) ──────────────────────
  // Sandbox: cardápio vai pra doc "puba__teste"; o real fica intocado. Toda
  // resposta vem com 🧪 no topo enquanto durar. Sair = volta ao normal;
  // "aplicar de verdade" = copia o sandbox pro cardápio real.
  const MASTER = process.env.MASTER_WHATSAPP || "5511985499821";
  const ehMaster = chaveBR(from) === chaveBR(MASTER);
  const ehPuba = String(agente.tipo) === "cardapio";
  const setModoTeste = (v: boolean) => firestoreAtualizar("whatsappAgenteSessoes", sid, { waId: from, modoTeste: v, atualizadoEm: now() }).catch(() => {});
  if (ehMaster) {
    const querEntrar = /\bmodo (de )?teste\b/.test(low) && !/\bsair\b|\baplicar\b|\bgravar\b|\bpublicar\b/.test(low);
    const querSair = /(sair|encerrar|desligar|fechar|parar)\b[^]*teste|sair do teste/.test(low);
    const querAplicar = /(aplicar|gravar|publicar|salvar)\b[^]*(de verdade|no real|pra valer|real)/.test(low);
    if (querSair && sessao?.modoTeste) {
      await setModoTeste(false);
      await enviarWhats(from, "Saí do *modo teste* 👍 As alterações agora valem de verdade de novo.");
      return;
    }
    if (querAplicar && sessao?.modoTeste && ehPuba) {
      const t = (await firestoreLer("cardapioEstado", "puba__teste")) as Doc | null;
      if (t && (t as { comidas?: unknown }).comidas) {
        await firestoreAtualizar("cardapioEstado", "puba", { comidas: t.comidas, bebidas: t.bebidas, vendinha: t.vendinha, especiais: (t.especiais as unknown[]) || [], vinhos: (t.vinhos as unknown[]) || [], versao: (t.versao as number) || 0, atualizadoEm: now(), atualizadoPor: nome || "master" }).catch(() => {});
      }
      await setModoTeste(false);
      await enviarWhats(from, "✅ Apliquei o que você testou no cardápio *real* e saí do modo teste.");
      return;
    }
    if (querEntrar && !sessao?.modoTeste) {
      if (!ehPuba) { await enviarWhats(from, "Por ora o *modo teste* está só no agente do Puba — no Sororoca eu ligo em breve 🙏"); return; }
      const real = (await firestoreLer("cardapioEstado", "puba")) as Doc | null;   // semeia o sandbox do real (fresco)
      if (real && (real as { comidas?: unknown }).comidas) {
        await firestoreAtualizar("cardapioEstado", "puba__teste", { comidas: real.comidas, bebidas: real.bebidas, vendinha: real.vendinha, especiais: (real.especiais as unknown[]) || [], vinhos: (real.vinhos as unknown[]) || [], versao: (real.versao as number) || 0, atualizadoEm: now(), atualizadoPor: "teste" }).catch(() => {});
      }
      await setModoTeste(true);
      await enviarWhats(from, "🧪 *MODO TESTE ligado.* Pode alterar à vontade — nada aqui muda o cardápio real. Minhas respostas vêm com 🧪 no topo enquanto durar.\n\nPra sair: *sair do teste*. Pra valer de verdade: *aplicar de verdade*.");
      return;
    }
  }
  const modoTeste = !!sessao?.modoTeste && ehPuba;

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
    agenteId: agente.id, conversaId, restaurantId: null, role: "user", texto: texto || "[foto]", pessoaId: null, pessoaNome: nome || null, canal: "whatsapp", criadoEm: now(),
  }).catch(() => {});

  let out;
  try {
    out = await runAgenteCore(agente, { mensagem: texto, historico: hist, pessoaNome: nome || from, pessoaId: `wa_${sid}`, canal: "whatsapp", anexo, modoTeste, onProgress: async (m) => { await enviarWhats(from, modoTeste ? `🧪 ${m}` : m); } });
  } catch {
    await enviarWhats(from, "Tive um problema pra responder agora. Tenta de novo daqui a pouco 🙏");
    return;
  }
  const resposta = ((modoTeste ? "🧪 *MODO TESTE*\n\n" : "") + (prefixo ? prefixo + "\n\n" : "") + ((out.resposta || "").trim() || "(sem resposta)"));
  await firestoreCriar("agenteMensagens", `am_${rid()}`, {
    agenteId: agente.id, conversaId, restaurantId: null, role: "assistant", texto: resposta, pessoaId: null, canal: "whatsapp", pdfUrl: out.pdfUrl || null, previaUrl: out.previaUrl || null, criadoEm: now(),
  }).catch(() => {});
  // Texto (+ link de prévia HTML pra aprovar). O PDF vai como DOCUMENTO de verdade.
  const linhas = [resposta];
  // Só anexa o link se o agente NÃO já colou ele no texto (evita link duplicado).
  if (out.previaUrl && !resposta.includes(out.previaUrl)) linhas.push(`🔗 Prévia pra conferir/aprovar:\n${out.previaUrl}`);
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
  if (out.pdfUrl) {
    // Nome do arquivo derivado do AGENTE (não fixo "puba", que confundia quem
    // usa o agente de outro restaurante, ex.: Sororoca).
    const slug = String(agente.nome || "")
      .toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !["agente", "cardapio", "assistente", "dos", "das", "com", "site", "novo"].includes(w))
      .join("-").replace(/[^a-z0-9-]/g, "") || "cardapio";
    await enviarWhatsDoc(from, out.pdfUrl, `cardapio-${slug}.pdf`);
  }
}

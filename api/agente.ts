// ════════════════════════════════════════════════════════════════════════════
//  /api/agente — motor dos Agentes de IA (F1b). Loop de tool-use do Claude com
//  ferramentas de LEITURA (consulta a coleções do Firestore, filtradas pelo
//  escopo de entidades do agente). Cada chamada de ferramenta vira log em
//  `agenteLogs`. Escrita ainda não: as tools de escrita virão em modo confirmação.
//  Exige usuário logado (Firebase ID token). Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";
import { firestoreListar, firestoreCriar, firestoreLer, firestoreAtualizar, subirStorage } from "./_firestoreRest.js";
import { CARDAPIO_SEED, type CardapioEstado, type CardapioSecao, type CardapioItem } from "./_cardapioSeed.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL_PADRAO = "claude-opus-4-8";
const MAX_LOOPS = 6;          // rodadas de tool-use por mensagem
const MAX_LINHAS = 40;        // linhas por consulta devolvidas ao modelo
const MAX_RESULT_CHARS = 12000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };
type Escopo = "todas" | string[];
type Doc = Record<string, unknown>;

// Ferramentas de LEITURA implementadas no F1b. `cols` = coleções que ela lê.
// `permissao` = módulo que a pessoa precisaria ter (intersecção fina fica p/ F2;
// hoje o módulo é só-master). O texto vira a description do tool no Claude.
const READ_TOOLS: Record<string, { desc: string; cols: string[] }> = {
  ler_contas_fixas:     { desc: "Consulta contas fixas: fornecedor, valor estimado, dia de vencimento e status de pagamento por competência.", cols: ["contasFixas"] },
  ler_gorjetas:         { desc: "Consulta gorjetas registradas (valores por dia/período).", cols: ["gorjetas"] },
  ler_fechamento_caixa: { desc: "Consulta fechamentos de caixa por dia/turno.", cols: ["fechamentosCaixa"] },
  ler_vendas:           { desc: "Consulta vendas registradas (fora do fiscal) e permutas.", cols: ["vendas"] },
  ler_recebimentos:     { desc: "Consulta recebimentos de produtos / notas fiscais conferidas.", cols: ["recebimentos"] },
  ler_faturas:          { desc: "Consulta faturas de cartão e seus lançamentos (valor, destino, reembolso).", cols: ["cartaoFaturas", "cartaoLancamentos"] },
  ler_escala:           { desc: "Consulta escalas planejadas (por mês/entidade).", cols: ["escalas"] },
  ler_admissoes:        { desc: "Consulta processos de admissão em andamento.", cols: ["admissoes"] },
  ler_proc_seletivo:    { desc: "Consulta vagas abertas e candidaturas do processo seletivo.", cols: ["vagas", "candidaturasTrabalhe"] },
  ler_prazos_trab:      { desc: "Consulta dados de prazos trabalhistas: empregados (datas de admissão p/ experiência), exames e entregas de uniforme.", cols: ["empregados", "examesEmpregado", "entregasUniforme"] },
};

// ── SKILL TOOLS ─────────────────────────────────────────────────────────────
// Tools "de tarefa" (não são consulta genérica a coleção). Cada uma tem schema
// próprio e função de execução. A 1ª skill é o Cardápio do Puba.
type SkillTool = {
  desc: string; tipo: "read" | "write"; schema: Record<string, unknown>;
  exec: (args: Doc, ctx: { pessoaId: string; pessoaNome: string }) => Promise<{ resumo: string; conteudo: string }>;
};

const CARDAPIO_DOC = "puba";
const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

async function lerCardapioEstado(): Promise<CardapioEstado & { versao: number }> {
  const est = await firestoreLer("cardapioEstado", CARDAPIO_DOC);
  if (est && (est as { comidas?: unknown }).comidas) return est as CardapioEstado & { versao: number };
  return { ...CARDAPIO_SEED, versao: 0 };
}

type AltCardapio = { acao?: string; pagina?: string; secao?: string; item?: string; dados?: Record<string, unknown> };
const PAGINAS: (keyof CardapioEstado)[] = ["comidas", "bebidas", "vendinha"];

// Normaliza preços do que o modelo mandar → string | {qual,val} (sem array aninhado).
function normPrecos(raw: unknown): CardapioItem["precos"] {
  const arr = Array.isArray(raw) ? raw : (raw != null && raw !== "" ? [raw] : []);
  return arr.map((p) => {
    if (p && typeof p === "object" && !Array.isArray(p) && "val" in (p as object)) return { qual: String((p as { qual?: unknown }).qual ?? ""), val: String((p as { val: unknown }).val) };
    if (Array.isArray(p) && p.length === 2) return { qual: String(p[0]), val: String(p[1]) };
    return String(p);
  });
}

// Aplica um diff no estado. Defensivo: cada alteração é isolada; erros viram msg.
function aplicaDiffCardapio(est: CardapioEstado, alts: AltCardapio[]): { aplicadas: string[]; erros: string[] } {
  const aplicadas: string[] = [], erros: string[] = [];
  const acha = (pagina: string | undefined, secaoNome: string | undefined, itemNome: string) => {
    const pgs = (pagina && PAGINAS.includes(pagina as keyof CardapioEstado) ? [pagina] : PAGINAS) as (keyof CardapioEstado)[];
    for (const pg of pgs) for (const sec of est[pg] || []) {
      if (secaoNome && nrm(sec.secao) !== nrm(secaoNome)) continue;
      const it = (sec.itens || []).find((i) => nrm(i.nome) === nrm(itemNome)) || (sec.itens || []).find((i) => nrm(i.nome).includes(nrm(itemNome)));
      if (it) return { pg, sec, it };
    }
    return null;
  };
  // Localiza uma SEÇÃO (categoria) inteira pra remover/renomear.
  const achaSecao = (pagina: string | undefined, secaoNome: string | undefined) => {
    const pgs = (pagina && PAGINAS.includes(pagina as keyof CardapioEstado) ? [pagina] : PAGINAS) as (keyof CardapioEstado)[];
    for (const pg of pgs) {
      const arr = (est[pg] || []) as CardapioSecao[];
      let idx = arr.findIndex((s) => nrm(s.secao) === nrm(secaoNome || ""));
      if (idx < 0 && secaoNome) idx = arr.findIndex((s) => nrm(s.secao).includes(nrm(secaoNome)));
      if (idx >= 0) return { pg, arr, idx, sec: arr[idx] };
    }
    return null;
  };
  for (const a of alts) {
    try {
      const acao = nrm(a.acao), d = a.dados || {};
      if (acao === "adicionar") {
        const pg = (a.pagina && PAGINAS.includes(a.pagina as keyof CardapioEstado) ? a.pagina : "comidas") as keyof CardapioEstado;
        let sec = (est[pg] || []).find((s) => nrm(s.secao) === nrm(a.secao));
        if (!sec) { sec = { secao: String(a.secao || "OUTROS").toUpperCase(), itens: [] }; (est[pg] as CardapioSecao[]).push(sec); }
        const precos = normPrecos(d.precos ?? d.preco ?? d.valor);
        sec.itens.push({ nome: String(d.nome || a.item || "NOVO ITEM").toUpperCase(), descricao: String(d.descricao || ""), precos: precos.length ? precos : ["R$ 0"] });
        aplicadas.push(`adicionado ${d.nome || a.item} em ${sec.secao}`);
      } else if (acao === "remover") {
        const f = acha(a.pagina, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}" pra remover`); continue; }
        f.sec.itens = f.sec.itens.filter((i) => i !== f.it); aplicadas.push(`removido ${f.it.nome}`);
      } else if (acao === "alterar_preco") {
        const f = acha(a.pagina, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}" pra alterar preço`); continue; }
        const np = normPrecos(d.precos ?? d.preco ?? d.valor);
        if (np.length) f.it.precos = np;
        aplicadas.push(`preço de ${f.it.nome} → ${JSON.stringify(f.it.precos)}`);
      } else if (acao === "editar_descricao") {
        const f = acha(a.pagina, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}"`); continue; }
        f.it.descricao = String(d.descricao ?? ""); aplicadas.push(`descrição de ${f.it.nome} atualizada`);
      } else if (acao === "renomear") {
        const f = acha(a.pagina, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}"`); continue; }
        const novo = String(d.nome || "").toUpperCase(); if (!novo) { erros.push("renomear sem nome novo"); continue; }
        aplicadas.push(`${f.it.nome} → ${novo}`); f.it.nome = novo;
      } else if (acao === "remover_secao") {
        const f = achaSecao(a.pagina, a.secao); if (!f) { erros.push(`não achei a seção "${a.secao}" pra remover`); continue; }
        const nome = f.sec.secao, qtd = (f.sec.itens || []).length;
        f.arr.splice(f.idx, 1);
        aplicadas.push(`seção "${nome}" removida${qtd ? ` (com ${qtd} item(ns))` : " (estava vazia)"}`);
      } else if (acao === "renomear_secao") {
        const f = achaSecao(a.pagina, a.secao); if (!f) { erros.push(`não achei a seção "${a.secao}" pra renomear`); continue; }
        const novo = String((d.nome ?? d.secao ?? "")).trim(); if (!novo) { erros.push("renomear_secao sem nome novo"); continue; }
        const antigo = f.sec.secao; f.sec.secao = novo.toUpperCase();
        aplicadas.push(`seção "${antigo}" → "${f.sec.secao}"`);
      } else erros.push(`ação desconhecida: ${a.acao}`);
    } catch (e) { erros.push(`erro em ${a.acao}: ${e instanceof Error ? e.message : "?"}`); }
  }
  return { aplicadas, erros };
}

const SKILL_TOOLS: Record<string, SkillTool> = {
  ler_cardapio: {
    desc: "Lê o cardápio atual do Puba Cidade Velha (comidas, bebidas, vendinha) com nomes, descrições e preços. Use SEMPRE antes de propor mudança.",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async () => {
      const est = await lerCardapioEstado();
      const c = JSON.stringify(est);
      return { resumo: `cardápio v${est.versao}`, conteudo: c.length > MAX_RESULT_CHARS ? c.slice(0, MAX_RESULT_CHARS) : c };
    },
  },
  aplicar_cardapio: {
    desc: "APLICA alterações no cardápio. Só chame DEPOIS do usuário confirmar explicitamente ('confirma'/'pode aplicar'). alteracoes = lista de { acao, pagina: 'comidas'|'bebidas'|'vendinha', secao, item (nome atual do item), dados }. Ações de ITEM: 'alterar_preco'|'adicionar'|'remover'|'editar_descricao'|'renomear'. Ações de SEÇÃO/categoria inteira (o título, ex.: 'SANDUBAS'): 'remover_secao' (remove a seção e o que tiver dentro — use pra sumir com título órfão/vazio) e 'renomear_secao' (novo nome em dados.nome). Em dados: preço novo em `precos` (ex.: [\"R$ 64\"]) ou `preco`; item novo em `nome`/`descricao`/`precos`. Bump de versão automático. (O PDF final é gerado numa etapa seguinte.)",
    tipo: "write",
    schema: { type: "object", properties: {
      alteracoes: { type: "array", description: "lista de alterações", items: { type: "object", properties: {
        acao: { type: "string" }, pagina: { type: "string" }, secao: { type: "string" }, item: { type: "string" }, dados: { type: "object" },
      }, required: ["acao"] } },
      resumo_humano: { type: "string", description: "resumo curto do que mudou, pra confirmar/registrar" },
    }, required: ["alteracoes"] },
    exec: async (args, ctx) => {
      const alts = (Array.isArray(args.alteracoes) ? args.alteracoes : []) as AltCardapio[];
      if (!alts.length) return { resumo: "nada a aplicar", conteudo: JSON.stringify({ erro: "Sem alterações." }) };
      const est = await lerCardapioEstado();
      const { aplicadas, erros } = aplicaDiffCardapio(est, alts);
      const novaVersao = (est.versao || 0) + 1;
      const nowIso = new Date().toISOString();
      const salvo = await firestoreAtualizar("cardapioEstado", CARDAPIO_DOC, { comidas: est.comidas, bebidas: est.bebidas, vendinha: est.vendinha, versao: novaVersao, atualizadoEm: nowIso, atualizadoPor: ctx.pessoaNome });
      if (salvo) {
        const vid = `cardv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await firestoreCriar("cardapioVersoes", vid, { id: vid, doc: CARDAPIO_DOC, versao: novaVersao, resumo: String(args.resumo_humano || aplicadas.join("; ")), alteracoes: alts as unknown as Doc[], autorId: ctx.pessoaId, autorNome: ctx.pessoaNome, criadoEm: nowIso } as Doc).catch(() => {});
      }
      return { resumo: `cardápio → v${novaVersao} (${aplicadas.length} alt)`, conteudo: JSON.stringify({ versao: novaVersao, aplicadas, erros, salvo }) };
    },
  },
  gerar_pdf: {
    desc: "Gera o PDF FINAL da filipeta do Puba com o cardápio atual e devolve o link pra download. Use quando o usuário pedir o PDF / a filipeta / o arquivo final.",
    tipo: "write",
    schema: { type: "object", properties: {}, required: [] },
    exec: async () => {
      const est = await lerCardapioEstado();
      const origin = process.env.APP_ORIGIN || "https://admin.planejamento.app";
      let j: { pdfBase64?: string; error?: string };
      try {
        const resp = await fetch(origin + "/api/cardapio-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(est) });
        j = (await resp.json()) as { pdfBase64?: string; error?: string };
        if (!resp.ok || !j.pdfBase64) return { resumo: "falha no PDF", conteudo: JSON.stringify({ erro: j.error || `render HTTP ${resp.status}` }) };
      } catch (e) { return { resumo: "falha no PDF", conteudo: JSON.stringify({ erro: e instanceof Error ? e.message : "render indisponível" }) }; }
      const path = `cardapios/puba/v${est.versao || 0}_${Date.now()}.pdf`;
      const url = await subirStorage(path, j.pdfBase64, "application/pdf");
      if (!url) return { resumo: "falha no upload", conteudo: JSON.stringify({ erro: "PDF gerado mas o upload falhou." }) };
      return { resumo: `PDF v${est.versao || 0} pronto`, conteudo: JSON.stringify({ pdfUrl: url, versao: est.versao || 0 }) };
    },
  },
};

function noEscopo(d: Doc, escopo: Escopo): boolean {
  if (escopo === "todas") return true;
  const rid = (d.restaurantId || d.rid) as string | undefined;
  return !rid || escopo.includes(rid);
}

// Filtro genérico dirigido pelos argumentos que o modelo passa.
function aplicaArgs(rows: Doc[], args: { restaurantId?: string; periodo?: string; busca?: string }): Doc[] {
  let r = rows;
  if (args.restaurantId) r = r.filter(d => (d.restaurantId || d.rid) === args.restaurantId);
  if (args.periodo) { const p = String(args.periodo); r = r.filter(d => Object.values(d).some(v => typeof v === "string" && v.startsWith(p))); }
  if (args.busca) { const q = String(args.busca).toLowerCase(); r = r.filter(d => JSON.stringify(d).toLowerCase().includes(q)); }
  return r;
}

async function execTool(key: string, args: { restaurantId?: string; periodo?: string; busca?: string }, escopo: Escopo): Promise<{ resumo: string; conteudo: string }> {
  const def = READ_TOOLS[key];
  if (!def) return { resumo: "ferramenta indisponível", conteudo: JSON.stringify({ erro: "Ferramenta não disponível nesta versão." }) };
  const blocos: Record<string, { total: number; amostra: Doc[] }> = {};
  let totalGeral = 0;
  for (const col of def.cols) {
    const todos = (await firestoreListar(col)).filter(d => noEscopo(d, escopo));
    const filtrados = aplicaArgs(todos, args);
    totalGeral += filtrados.length;
    blocos[col] = { total: filtrados.length, amostra: filtrados.slice(0, MAX_LINHAS) };
  }
  let conteudo = JSON.stringify(blocos);
  if (conteudo.length > MAX_RESULT_CHARS) conteudo = conteudo.slice(0, MAX_RESULT_CHARS) + '…","_truncado":true}';
  return { resumo: `${totalGeral} registro(s) em ${def.cols.join("+")}`, conteudo };
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  let user;
  try { user = await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as {
    agenteId?: string; mensagem?: string; historico?: { role: string; texto: string }[]; pessoaNome?: string;
    anexo?: { base64?: string; mediaType?: string };
  } | null;
  const agenteId = (body?.agenteId || "").toString();
  const mensagem = (body?.mensagem || "").toString().trim();
  // Anexo: imagem (image/*) vira bloco image; PDF vira bloco document. Opus lê os dois.
  const anexoB64 = (body?.anexo?.base64 || "").toString();
  const anexoMime = (body?.anexo?.mediaType || "").toString();
  const temAnexo = !!anexoB64 && (anexoMime.startsWith("image/") || anexoMime === "application/pdf");
  if (!agenteId || (!mensagem && !temAnexo)) { res.status(400).json({ error: "agenteId e mensagem (ou anexo) são obrigatórios." }); return; }

  // Carrega a config do agente.
  const agentes = await firestoreListar("agentesIA");
  const agente = agentes.find(a => a.id === agenteId) as Doc | undefined;
  if (!agente) { res.status(404).json({ error: "Agente não encontrado." }); return; }
  if (agente.ativo === false) { res.status(400).json({ error: "Agente pausado." }); return; }

  const escopo: Escopo = agente.entidades === "todas" || !Array.isArray(agente.entidades) ? "todas" : (agente.entidades as string[]);
  const toolsLigadas = (agente.tools || {}) as Record<string, boolean>;
  // Expõe as ferramentas de leitura (schema genérico) + as skill tools (schema próprio) ligadas.
  const readDisp = Object.keys(READ_TOOLS).filter(k => toolsLigadas[k]);
  // Agente do tipo "cardapio" expõe as tools da skill mesmo que o mapa `tools`
  // (criado antes de gerar_pdf existir) não as tenha ligadas.
  const ehCardapio = agente.tipo === "cardapio";
  const skillDisp = Object.keys(SKILL_TOOLS).filter(k => ehCardapio || toolsLigadas[k]);
  const temWrite = skillDisp.some(k => SKILL_TOOLS[k].tipo === "write");
  const anthropicTools = [
    ...readDisp.map(k => ({
      name: k,
      description: READ_TOOLS[k].desc + " Filtre por restaurantId (entidade), periodo (prefixo de data YYYY, YYYY-MM ou YYYY-MM-DD) e/ou busca (texto livre) quando fizer sentido.",
      input_schema: { type: "object" as const, properties: {
        restaurantId: { type: "string", description: "id da entidade, se quiser restringir" },
        periodo: { type: "string", description: "prefixo de data: 2026, 2026-07, 2026-07-14" },
        busca: { type: "string", description: "texto livre pra filtrar (nome, fornecedor, descrição)" },
      }, required: [] },
    })),
    ...skillDisp.map(k => ({ name: k, description: SKILL_TOOLS[k].desc, input_schema: SKILL_TOOLS[k].schema })),
  ];

  const sysBase = (agente.systemPrompt as string) || "Você é um assistente do planejamento.app.";
  const regras = temWrite
    ? " Para QUALQUER alteração: primeiro PROPONHA em texto o que vai mudar e peça confirmação explícita; só chame a ferramenta de escrita DEPOIS que o usuário confirmar ('confirma'/'pode aplicar') na mensagem seguinte. Nunca aplique sem confirmação."
    : " Você NÃO pode alterar nada nesta versão (só consulta); se pedirem uma alteração, explique que por ora você só consulta.";
  const temCardapio = skillDisp.includes("ler_cardapio");
  const notaCardapio = temCardapio
    ? " Quando pedirem pra VER/MOSTRAR o cardápio ou a prévia, chame ler_cardapio: a prévia visual (HTML) aparece SOZINHA na tela — não precisa listar item por item, só confirme que está mostrando. Depois de aplicar uma alteração, a prévia atualizada também aparece sozinha. Quando pedirem o PDF / a filipeta / o arquivo final, chame gerar_pdf: o link pra download aparece na conversa."
    : "";
  const system = sysBase + "\n\nVocê só sabe o que suas ferramentas retornam — nunca invente dados; se não achar, diga que não encontrou. Responda em português, direto, com valores em R$ e datas em dd/mm/aaaa." + regras + notaCardapio;

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const h of (Array.isArray(body?.historico) ? body!.historico : []).slice(-10)) {
    if (h && (h.role === "user" || h.role === "assistant") && typeof h.texto === "string") messages.push({ role: h.role, content: h.texto });
  }
  if (temAnexo) {
    // Bloco do anexo + o texto (default se o usuário só mandou o arquivo).
    const bloco = anexoMime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: anexoB64 } }
      : { type: "image", source: { type: "base64", media_type: anexoMime, data: anexoB64 } };
    const txt = mensagem || "Segue um arquivo. Leia com atenção e me ajude com base nele.";
    messages.push({ role: "user", content: [bloco, { type: "text", text: txt }] });
  } else {
    messages.push({ role: "user", content: mensagem });
  }

  const toolCalls: { tool: string; resumo: string }[] = [];
  let tocouCardapio = false;   // pra devolver a prévia HTML quando o cardápio foi lido/alterado
  let pdfUrl: string | null = null;
  try {
    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const payload = { model: (agente.model as string) || MODEL_PADRAO, max_tokens: 2000, system, messages, tools: anthropicTools };
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const raw = await resp.text();
      if (!resp.ok) { res.status(502).json({ error: `Claude HTTP ${resp.status}. ${raw.slice(0, 300)}` }); return; }
      const j = JSON.parse(raw) as { stop_reason?: string; content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> };
      const blocks = j.content || [];

      if (j.stop_reason !== "tool_use") {
        const texto = blocks.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
        const extra: Record<string, unknown> = {};
        if (tocouCardapio) extra.estadoCardapio = await lerCardapioEstado();
        if (pdfUrl) extra.pdfUrl = pdfUrl;
        res.status(200).json({ resposta: texto || "(sem resposta)", toolCalls, ...extra });
        return;
      }

      // Executa cada tool_use e monta os tool_results.
      messages.push({ role: "assistant", content: blocks });
      const results: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const b of blocks) {
        if (b.type !== "tool_use" || !b.name || !b.id) continue;
        const input = (b.input || {}) as Doc;
        const skill = SKILL_TOOLS[b.name];
        if (b.name === "ler_cardapio" || b.name === "aplicar_cardapio") tocouCardapio = true;
        const pessoaNome = (body?.pessoaNome || user.email || "") as string;
        const { resumo, conteudo } = skill
          ? await skill.exec(input, { pessoaId: user.uid, pessoaNome })
          : await execTool(b.name, input as { restaurantId?: string; periodo?: string; busca?: string }, escopo);
        toolCalls.push({ tool: b.name, resumo });
        if (b.name === "gerar_pdf") { try { const p = JSON.parse(conteudo) as { pdfUrl?: string }; if (p.pdfUrl) pdfUrl = p.pdfUrl; } catch { /* ignore */ } }
        results.push({ type: "tool_result", tool_use_id: b.id, content: conteudo });
        // Auditoria (append-only). Não bloqueia a resposta se falhar.
        try {
          const logId = `alog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await firestoreCriar("agenteLogs", logId, {
            id: logId, agenteId, pessoaId: user.uid, pessoaNome,
            tool: b.name, tipo: skill ? skill.tipo : "read", args: input, resumo, canal: "app", criadoEm: new Date().toISOString(),
          });
        } catch { /* log é best-effort */ }
      }
      messages.push({ role: "user", content: results });
    }
    res.status(200).json({ resposta: "Precisei de muitas consultas e parei por segurança. Pode refazer a pergunta de forma mais específica?", toolCalls });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao processar." });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

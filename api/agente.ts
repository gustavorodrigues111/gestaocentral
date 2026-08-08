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

export const config = { maxDuration: 120 };   // 120s: o PDF headless (Puppeteer) pode demorar na 1ª vez

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
  exec: (args: Doc, ctx: { pessoaId: string; pessoaNome: string; restaurantId?: string; onProgress?: (msg: string) => Promise<void> }) => Promise<{ resumo: string; conteudo: string }>;
};

const CARDAPIO_DOC = "puba";
const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

async function lerCardapioEstado(): Promise<CardapioEstado & { versao: number }> {
  const est = await firestoreLer("cardapioEstado", CARDAPIO_DOC);
  if (est && (est as { comidas?: unknown }).comidas) {
    const e = est as CardapioEstado & { versao: number };
    // Backfill de folhas novas ainda ausentes no doc salvo (ex.: Carta de
    // Vinhos): pega do seed até o usuário editar/salvar por ela.
    if (!e.vinhos && CARDAPIO_SEED.vinhos) e.vinhos = CARDAPIO_SEED.vinhos;
    return e;
  }
  return { ...CARDAPIO_SEED, versao: 0 };
}

type AltCardapio = { acao?: string; pagina?: string; secao?: string; item?: string; dados?: Record<string, unknown> };
const PAGINAS: (keyof CardapioEstado)[] = ["comidas", "bebidas", "vendinha", "especiais", "vinhos"];

// ── Lixeira do cardápio (pratos removidos, restauráveis) ────────────────────
// Guarda cada prato removido com os DADOS e a POSIÇÃO original. Vale pros dois
// agentes: chave = "puba" (cardápio do Puba) ou rid (cardápio do site/Sororoca).
type ArquivadoEntry = {
  id: string;
  engine: "site" | "puba";
  cardapio: string;   // nome do menu/página (ex.: "Comidas" | "comidas")
  secao: string;      // nome da seção
  posicao: number;    // índice na seção no momento da remoção
  nome: string;       // título/nome do prato (pra listar e casar)
  raw: Record<string, unknown>;   // objeto do prato como estava
  arquivadoEm: string;
  arquivadoPor: string;
};
const novoArqId = () => `arq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
// Round-trip pra nunca gravar undefined no Firestore.
const limpo = (o: unknown): Record<string, unknown> => JSON.parse(JSON.stringify(o ?? {}));

async function lerArquivados(chave: string): Promise<ArquivadoEntry[]> {
  const d = (await firestoreLer("cardapioArquivados", chave)) as { pratos?: ArquivadoEntry[] } | null;
  return Array.isArray(d?.pratos) ? (d!.pratos as ArquivadoEntry[]) : [];
}
async function arquivarEntradas(chave: string, novas: ArquivadoEntry[], quem: string): Promise<void> {
  if (!novas.length) return;
  const atuais = await lerArquivados(chave);
  const carimbadas = novas.map((n) => ({ ...n, arquivadoPor: quem }));
  await firestoreAtualizar("cardapioArquivados", chave, { pratos: [...carimbadas, ...atuais] as unknown as Doc[], atualizadoEm: new Date().toISOString() }).catch(() => {});
}
async function tirarArquivado(chave: string, id: string, restantes: ArquivadoEntry[]): Promise<void> {
  await firestoreAtualizar("cardapioArquivados", chave, { pratos: restantes.filter((p) => p.id !== id) as unknown as Doc[], atualizadoEm: new Date().toISOString() }).catch(() => {});
}
// Casa um arquivado por nome (opcionalmente filtrando seção/cardápio).
function achaArquivado(arqs: ArquivadoEntry[], nome: string, secao?: string, cardapio?: string): ArquivadoEntry | null {
  const cand = arqs.filter((a) => (!secao || nrm(a.secao) === nrm(secao)) && (!cardapio || nrm(a.cardapio).includes(nrm(cardapio))));
  const pool = cand.length ? cand : arqs;
  return pool.find((a) => nrm(a.nome) === nrm(nome)) || pool.find((a) => nrm(a.nome).includes(nrm(nome))) || null;
}

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
function aplicaDiffCardapio(est: CardapioEstado, alts: AltCardapio[]): { aplicadas: string[]; erros: string[]; arquivar: ArquivadoEntry[] } {
  const aplicadas: string[] = [], erros: string[] = [];
  const arquivar: ArquivadoEntry[] = [];
  const ts = new Date().toISOString();
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
        const pos = f.sec.itens.indexOf(f.it);
        arquivar.push({ id: novoArqId(), engine: "puba", cardapio: f.pg, secao: f.sec.secao || "", posicao: pos < 0 ? f.sec.itens.length : pos, nome: f.it.nome || "", raw: limpo(f.it), arquivadoEm: ts, arquivadoPor: "" });
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
        (f.sec.itens || []).forEach((it, i) => arquivar.push({ id: novoArqId(), engine: "puba", cardapio: f.pg, secao: nome || "", posicao: i, nome: it.nome || "", raw: limpo(it), arquivadoEm: ts, arquivadoPor: "" }));
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
  return { aplicadas, erros, arquivar };
}

// Prévia do cardápio em HTML leve (abre no navegador do celular pra aprovar).
function previaCardapioHtml(est: CardapioEstado & { versao?: number }): string {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
  const precoTxt = (precos: CardapioItem["precos"]) => (precos || []).map((p) => typeof p === "string" ? p : `${p.qual ? esc(p.qual) + " " : ""}${esc(p.val)}`).join("&nbsp;&nbsp;");
  const pagina = (titulo: string, secs?: CardapioSecao[]) => (secs && secs.length)
    ? `<h2>${esc(titulo)}</h2>` + secs.map((sec) => `<div class="sec"><h3>${esc(sec.secao)}</h3>` +
        (sec.itens || []).map((it) => `<div class="item"><div class="l"><b>${esc(it.nome)}</b>${it.descricao ? ` <span class="d">${esc(it.descricao)}</span>` : ""}</div><div class="p">${precoTxt(it.precos)}</div></div>`).join("") +
        `</div>`).join("")
    : "";
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia do cardápio · Puba</title>`
    + `<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;padding:16px;color:#1f2937;background:#faf9f7}`
    + `h1{font-size:20px;margin:0 0 2px}.v{color:#9ca3af;font-size:12px;margin-bottom:16px}`
    + `h2{font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#b45309;border-bottom:2px solid #f0e6d2;padding-bottom:4px;margin:22px 0 8px}`
    + `h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:14px 0 6px}`
    + `.item{display:flex;gap:10px;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ece7dd}`
    + `.l b{font-size:14px}.d{color:#9ca3af;font-size:12px}.p{white-space:nowrap;font-weight:600;font-size:13px}</style></head><body>`
    + `<h1>🍽️ Cardápio do Puba — prévia</h1><div class="v">versão ${est.versao || 0} · confira e aprove</div>`
    + pagina("Comidas", est.comidas) + pagina("Bebidas", est.bebidas) + pagina("Almoço", est.vendinha) + pagina("Especiais do dia", est.especiais) + pagina("Carta de Vinhos", est.vinhos)
    + `</body></html>`;
}

const SKILL_TOOLS: Record<string, SkillTool> = {
  ler_cardapio: {
    desc: "Lê o cardápio atual do Puba Cidade Velha (comidas, bebidas, vendinha=Almoço, especiais=Especiais do dia, vinhos=Carta de Vinhos) com nomes, descrições e preços. Use SEMPRE antes de propor mudança.",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async () => {
      const est = await lerCardapioEstado();
      const c = JSON.stringify(est);
      return { resumo: `cardápio v${est.versao}`, conteudo: c.length > MAX_RESULT_CHARS ? c.slice(0, MAX_RESULT_CHARS) : c };
    },
  },
  aplicar_cardapio: {
    desc: "APLICA alterações no cardápio. Só chame DEPOIS do usuário confirmar explicitamente ('confirma'/'pode aplicar'). alteracoes = lista de { acao, pagina: 'comidas'|'bebidas'|'vendinha' (=Almoço)|'especiais' (=Especiais do dia, folha após o Almoço)|'vinhos' (=Carta de Vinhos), secao, item (nome atual do item), dados }. Nos VINHOS a descrição segue o padrão: 1ª linha 'uva: <uvas> | <região>, <país>', depois uma LINHA EM BRANCO (\\n\\n) e as características (aromas/boca/final). Pra criar uma folha nova basta adicionar itens com a pagina certa (ex.: pagina 'especiais', secao 'ESPECIAIS DO DIA') — a folha/seção é criada automaticamente. Ações de ITEM: 'alterar_preco'|'adicionar'|'remover'|'editar_descricao'|'renomear'. Ações de SEÇÃO/categoria inteira (o título, ex.: 'SANDUBAS'): 'remover_secao' (remove a seção e o que tiver dentro — use pra sumir com título órfão/vazio) e 'renomear_secao' (novo nome em dados.nome). Em dados: preço novo em `precos` (ex.: [\"R$ 64\"]) ou `preco`; item novo em `nome`/`descricao`/`precos`. QUANDO um prato tem VÁRIOS preços com qualificador (ex.: dupla / meia dúzia / dupla com uni), passe `precos` como LISTA DE OBJETOS {qual, val} — cada um sai numa LINHA própria no PDF. Ex.: `precos: [{\"qual\":\"dupla\",\"val\":\"R$ 32\"},{\"qual\":\"meia dúzia\",\"val\":\"R$ 86\"},{\"qual\":\"dupla com uni\",\"val\":\"R$ 60\"}]`. NUNCA coloque preços dentro da `descricao` — sempre em `precos`. Bump de versão automático. (O PDF final é gerado numa etapa seguinte.)",
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
      const { aplicadas, erros, arquivar } = aplicaDiffCardapio(est, alts);
      await arquivarEntradas("puba", arquivar, ctx.pessoaNome);
      const novaVersao = (est.versao || 0) + 1;
      const nowIso = new Date().toISOString();
      const salvo = await firestoreAtualizar("cardapioEstado", CARDAPIO_DOC, { comidas: est.comidas, bebidas: est.bebidas, vendinha: est.vendinha, especiais: est.especiais || [], vinhos: est.vinhos || [], versao: novaVersao, atualizadoEm: nowIso, atualizadoPor: ctx.pessoaNome });
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
  gerar_previa: {
    desc: "Gera uma PRÉVIA em HTML (link) do cardápio atual pra o usuário revisar/APROVAR antes do PDF final. Use quando pedirem 'prévia', 'link pra aprovar', 'como está ficando', 'me mostra antes'. No WhatsApp é assim que se mostra o cardápio.",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async () => {
      const est = await lerCardapioEstado();
      const html = previaCardapioHtml(est);
      const b64 = Buffer.from(html, "utf8").toString("base64");
      const path = `cardapios/puba/previa_v${est.versao || 0}_${Date.now()}.html`;
      const url = await subirStorage(path, b64, "text/html");
      if (!url) return { resumo: "falha na prévia", conteudo: JSON.stringify({ erro: "prévia gerada mas o upload falhou." }) };
      return { resumo: `prévia v${est.versao || 0}`, conteudo: JSON.stringify({ previaUrl: url, versao: est.versao || 0 }) };
    },
  },
  listar_arquivados: {
    desc: "Lista os pratos que foram REMOVIDOS do cardápio do Puba e podem ser restaurados (nome, seção, página, preço que tinha, quando saiu). Use quando perguntarem 'o que já tiramos', 'quais pratos removidos', ou antes de restaurar.",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async () => {
      const arqs = await lerArquivados("puba");
      if (!arqs.length) return { resumo: "lixeira vazia", conteudo: JSON.stringify({ arquivados: [] }) };
      const lista = arqs.map((a) => ({ item: a.nome, pagina: a.cardapio, secao: a.secao, preco: (a.raw as { precos?: unknown }).precos ?? "", removidoEm: (a.arquivadoEm || "").slice(0, 10) }));
      return { resumo: `${arqs.length} arquivado(s)`, conteudo: JSON.stringify({ arquivados: lista }) };
    },
  },
  restaurar_prato: {
    desc: "Restaura um prato REMOVIDO do cardápio do Puba de volta na POSIÇÃO original, com o nome, descrição e preço que tinha. Confirme com o usuário antes. Se não souber o nome exato, use listar_arquivados. Args: item (nome do prato), opcional secao/pagina.",
    tipo: "write",
    schema: { type: "object", properties: { item: { type: "string" }, secao: { type: "string" }, pagina: { type: "string" } }, required: ["item"] },
    exec: async (args, ctx) => {
      const arqs = await lerArquivados("puba");
      const alvo = achaArquivado(arqs, String(args.item || ""), args.secao as string, args.pagina as string);
      if (!alvo) return { resumo: "não achei", conteudo: JSON.stringify({ erro: `nenhum prato arquivado batendo com "${args.item}"`, disponiveis: arqs.map((a) => a.nome) }) };
      const est = await lerCardapioEstado();
      const pg = (PAGINAS.includes(alvo.cardapio as keyof CardapioEstado) ? alvo.cardapio : "comidas") as keyof CardapioEstado;
      let sec = (est[pg] || []).find((s) => nrm(s.secao) === nrm(alvo.secao));
      if (!sec) { sec = { secao: (alvo.secao || "OUTROS").toUpperCase(), itens: [] }; (est[pg] as CardapioSecao[]).push(sec); }
      const idx = Math.max(0, Math.min(alvo.posicao, sec.itens.length));
      sec.itens.splice(idx, 0, alvo.raw as unknown as CardapioItem);
      const novaVersao = (est.versao || 0) + 1;
      const nowIso = new Date().toISOString();
      const salvo = await firestoreAtualizar("cardapioEstado", CARDAPIO_DOC, { comidas: est.comidas, bebidas: est.bebidas, vendinha: est.vendinha, especiais: est.especiais || [], vinhos: est.vinhos || [], versao: novaVersao, atualizadoEm: nowIso, atualizadoPor: ctx.pessoaNome });
      await tirarArquivado("puba", alvo.id, arqs);
      return { resumo: `restaurado ${alvo.nome}`, conteudo: JSON.stringify({ restaurado: alvo.nome, secao: sec.secao, pagina: pg, precoAntigo: (alvo.raw as { precos?: unknown }).precos ?? "", versao: novaVersao, salvo }) };
    },
  },
};

// ── Cardápio do MÓDULO (cardapioEstruturado — reflete no SITE) ───────────────
type PratoS = { id?: string; titulo?: string; subtitulo?: string; preco?: string; [k: string]: unknown };
type SecaoS = { id?: string; nome?: string; pratos?: PratoS[]; [k: string]: unknown };
type MenuS = { id?: string; nome?: string; secoes?: SecaoS[]; [k: string]: unknown };
type AltEstrut = { acao?: string; cardapio?: string; secao?: string; item?: string; dados?: Record<string, unknown> };
const APP_ORIGIN = () => process.env.APP_ORIGIN || "https://admin.planejamento.app";
const novoIdS = (p: string) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

async function lerEstruturado(rid: string): Promise<{ cardapios: MenuS[]; slug: string } | null> {
  if (!rid) return null;
  const d = (await firestoreLer("cardapioEstruturado", rid)) as { cardapios?: MenuS[] } | null;
  if (!d) return null;
  const cfg = (await firestoreLer("sitesConfig", rid)) as { slug?: string } | null;
  return { cardapios: Array.isArray(d.cardapios) ? d.cardapios : [], slug: (cfg?.slug || "").toString() };
}

function aplicaDiffEstruturado(cardapios: MenuS[], alts: AltEstrut[]): { aplicadas: string[]; erros: string[]; arquivar: ArquivadoEntry[] } {
  const aplicadas: string[] = [], erros: string[] = [];
  const arquivar: ArquivadoEntry[] = [];
  const ts = new Date().toISOString();
  const bate = (a: string | undefined, b: string | undefined) => !!b && (nrm(a) === nrm(b) || nrm(a).includes(nrm(b)));
  const acha = (card: string | undefined, sec: string | undefined, item: string) => {
    for (const c of cardapios) {
      if (card && !bate(c.nome, card)) continue;
      for (const s of c.secoes || []) {
        if (sec && !bate(s.nome, sec)) continue;
        const pr = s.pratos || [];
        const it = pr.find(p => nrm(p.titulo) === nrm(item)) || pr.find(p => nrm(p.titulo).includes(nrm(item)));
        if (it) return { c, s, it };
      }
    }
    return null;
  };
  const achaSecao = (card: string | undefined, sec: string | undefined) => {
    for (const c of cardapios) {
      if (card && !bate(c.nome, card)) continue;
      const arr = c.secoes || [];
      let i = arr.findIndex(s => nrm(s.nome) === nrm(sec || ""));
      if (i < 0 && sec) i = arr.findIndex(s => nrm(s.nome).includes(nrm(sec)));
      if (i >= 0) { c.secoes = arr; return { c, arr, i, s: arr[i] }; }
    }
    return null;
  };
  for (const a of alts) {
    try {
      const acao = nrm(a.acao), d = a.dados || {};
      if (acao === "alterar_preco") {
        const f = acha(a.cardapio, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}"`); continue; }
        f.it.preco = String(d.preco ?? d.precos ?? d.valor ?? ""); aplicadas.push(`${f.it.titulo}: preço → ${f.it.preco}`);
      } else if (acao === "editar_descricao") {
        const f = acha(a.cardapio, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}"`); continue; }
        f.it.subtitulo = String(d.descricao ?? d.subtitulo ?? ""); aplicadas.push(`${f.it.titulo}: descrição atualizada`);
      } else if (acao === "renomear") {
        const f = acha(a.cardapio, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}"`); continue; }
        const novo = String(d.titulo ?? d.nome ?? ""); if (!novo) { erros.push("renomear sem nome"); continue; }
        aplicadas.push(`${f.it.titulo} → ${novo}`); f.it.titulo = novo;
      } else if (acao === "remover") {
        const f = acha(a.cardapio, a.secao, String(a.item)); if (!f) { erros.push(`não achei "${a.item}" pra remover`); continue; }
        const pos = (f.s.pratos || []).indexOf(f.it);
        arquivar.push({ id: novoArqId(), engine: "site", cardapio: f.c.nome || "", secao: f.s.nome || "", posicao: pos < 0 ? (f.s.pratos || []).length : pos, nome: f.it.titulo || "", raw: limpo(f.it), arquivadoEm: ts, arquivadoPor: "" });
        f.s.pratos = (f.s.pratos || []).filter(p => p !== f.it); aplicadas.push(`removido ${f.it.titulo}`);
      } else if (acao === "adicionar") {
        const fs = achaSecao(a.cardapio, a.secao); if (!fs) { erros.push(`não achei a seção "${a.secao}"`); continue; }
        const novo: PratoS = { id: novoIdS("prato"), titulo: String(d.titulo ?? d.nome ?? a.item ?? "NOVO"), subtitulo: String(d.descricao ?? d.subtitulo ?? ""), preco: String(d.preco ?? d.precos ?? ""), tipo: "item" };
        fs.s.pratos = [...(fs.s.pratos || []), novo]; aplicadas.push(`adicionado ${novo.titulo} em ${fs.s.nome}`);
      } else if (acao === "renomear_secao") {
        const fs = achaSecao(a.cardapio, a.secao); if (!fs) { erros.push(`não achei a seção "${a.secao}"`); continue; }
        const novo = String(d.nome ?? ""); if (!novo) { erros.push("renomear_secao sem nome"); continue; }
        aplicadas.push(`seção ${fs.s.nome} → ${novo}`); fs.s.nome = novo;
      } else if (acao === "remover_secao") {
        const fs = achaSecao(a.cardapio, a.secao); if (!fs) { erros.push(`não achei a seção "${a.secao}"`); continue; }
        const nome = fs.s.nome;
        (fs.s.pratos || []).forEach((p, i) => arquivar.push({ id: novoArqId(), engine: "site", cardapio: fs.c.nome || "", secao: nome || "", posicao: i, nome: p.titulo || "", raw: limpo(p), arquivadoEm: ts, arquivadoPor: "" }));
        fs.arr.splice(fs.i, 1); aplicadas.push(`seção "${nome}" removida`);
      } else if (acao === "adicionar_secao") {
        const c = cardapios.find(x => bate(x.nome, a.cardapio)) || cardapios[0];
        if (!c) { erros.push("sem cardápio pra adicionar seção"); continue; }
        const nome = String(d.nome ?? a.secao ?? "NOVA SEÇÃO");
        c.secoes = [...(c.secoes || []), { id: novoIdS("sec"), nome, pratos: [] }]; aplicadas.push(`seção "${nome}" criada em ${c.nome}`);
      } else erros.push(`ação desconhecida: ${a.acao}`);
    } catch (e) { erros.push(`erro em ${a.acao}: ${e instanceof Error ? e.message : "?"}`); }
  }
  return { aplicadas, erros, arquivar };
}

// Prévia HTML do cardápio do módulo (igual ao Puba: sobe no Storage, abre no
// celular). Mostra TODOS os cardápios, seções e pratos com preço.
function previaEstruturadoHtml(cardapios: MenuS[], nome: string): string {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
  const precoTxt = (p: PratoS) => {
    const parts: string[] = [];
    if (p.preco) parts.push(`${p.garrafaMl ? `(${esc(p.garrafaMl)}ml) ` : ""}${esc(p.preco)}`);
    if (p.taca && p.precoTaca) parts.push(`taça ${p.tacaMl ? `(${esc(p.tacaMl)}ml) ` : ""}${esc(p.precoTaca)}`);
    return parts.join("&nbsp;·&nbsp;");
  };
  const pag = (c: MenuS) => `<h2>${esc(c.nome)}</h2>` + (c.secoes || []).map((s) => `<div class="sec"><h3>${esc(s.nome)}</h3>` +
    (s.pratos || []).filter((p) => p.tipo !== "imagem").map((p) => `<div class="item"><div class="l"><b>${esc(p.titulo)}</b>${p.subtitulo ? ` <span class="d">${esc(p.subtitulo)}</span>` : ""}</div><div class="p">${precoTxt(p)}</div></div>`).join("") +
    `</div>`).join("");
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Prévia do cardápio · ${esc(nome)}</title>`
    + `<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:680px;margin:0 auto;padding:16px;color:#1f2937;background:#faf9f7}`
    + `h1{font-size:20px;margin:0 0 2px}.v{color:#9ca3af;font-size:12px;margin-bottom:16px}`
    + `h2{font-size:16px;letter-spacing:.08em;text-transform:uppercase;color:#b45309;border-bottom:2px solid #f0e6d2;padding-bottom:4px;margin:24px 0 8px}`
    + `h3{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:14px 0 6px}`
    + `.item{display:flex;gap:10px;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #ece7dd}`
    + `.l b{font-size:14px}.d{color:#9ca3af;font-size:12px}.p{white-space:nowrap;font-weight:600;font-size:13px}</style></head><body>`
    + `<h1>🍽️ ${esc(nome) || "Cardápio"} — prévia</h1><div class="v">confira e aprove</div>`
    + cardapios.map(pag).join("")
    + `</body></html>`;
}

const SKILL_TOOLS_SITE: Record<string, SkillTool> = {
  ler_cardapio_site: {
    desc: "Lê o cardápio ATUAL do restaurante no módulo (o mesmo do site): cardápios (Comidas/Bebidas/Vinhos), seções e pratos (titulo, descricao=subtítulo, preco). Use SEMPRE antes de propor mudança.",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async (_args, ctx) => {
      const est = await lerEstruturado(ctx.restaurantId || "");
      if (!est) return { resumo: "sem cardápio", conteudo: JSON.stringify({ erro: "cardápio não encontrado para este restaurante" }) };
      const compact = est.cardapios.map(c => ({ cardapio: c.nome, secoes: (c.secoes || []).map(s => ({ secao: s.nome, pratos: (s.pratos || []).map(p => ({ titulo: p.titulo, descricao: p.subtitulo || "", preco: p.preco || "" })) })) }));
      const j = JSON.stringify(compact);
      return { resumo: "cardápio do site", conteudo: j.length > MAX_RESULT_CHARS ? j.slice(0, MAX_RESULT_CHARS) : j };
    },
  },
  aplicar_cardapio_site: {
    desc: "APLICA alterações no cardápio do módulo (reflete no SITE na hora). Só DEPOIS de confirmação explícita. alteracoes = lista de { acao, cardapio ('Comidas'|'Bebidas'|'Vinhos'), secao, item (titulo atual do prato), dados }. Ações: 'alterar_preco' (dados.preco), 'adicionar' (dados.titulo/descricao/preco), 'remover', 'editar_descricao' (dados.descricao), 'renomear' (dados.titulo), 'adicionar_secao'/'renomear_secao' (dados.nome), 'remover_secao'. Preço é texto livre (ex.: '64', 'consulte').",
    tipo: "write",
    schema: { type: "object", properties: {
      alteracoes: { type: "array", items: { type: "object", properties: {
        acao: { type: "string" }, cardapio: { type: "string" }, secao: { type: "string" }, item: { type: "string" }, dados: { type: "object" },
      }, required: ["acao"] } },
      resumo_humano: { type: "string" },
    }, required: ["alteracoes"] },
    exec: async (args, ctx) => {
      const rid = ctx.restaurantId || "";
      const est = await lerEstruturado(rid);
      if (!est) return { resumo: "sem cardápio", conteudo: JSON.stringify({ erro: "cardápio não encontrado" }) };
      const alts = (Array.isArray(args.alteracoes) ? args.alteracoes : []) as AltEstrut[];
      if (!alts.length) return { resumo: "nada a aplicar", conteudo: JSON.stringify({ erro: "sem alterações" }) };
      const { aplicadas, erros, arquivar } = aplicaDiffEstruturado(est.cardapios, alts);
      const salvo = await firestoreAtualizar("cardapioEstruturado", rid, { cardapios: est.cardapios as unknown as Doc[], atualizadoEm: new Date().toISOString(), atualizadoPor: ctx.pessoaNome });
      await arquivarEntradas(rid, arquivar, ctx.pessoaNome);
      return { resumo: `${aplicadas.length} alteração(ões) no site`, conteudo: JSON.stringify({ aplicadas, erros, salvo }) };
    },
  },
  gerar_previa_site: {
    desc: "Gera uma PRÉVIA em HTML (link) do cardápio atual — igual à do Puba: mostra todos os cardápios, seções e pratos com preço. Use pra o usuário conferir/APROVAR (inclusive após uma alteração).",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async (_args, ctx) => {
      const rid = ctx.restaurantId || "";
      const est = await lerEstruturado(rid);
      if (!est) return { resumo: "sem cardápio", conteudo: JSON.stringify({ erro: "cardápio não encontrado" }) };
      const rest = (await firestoreLer("restaurants", rid)) as { nome?: string } | null;
      const html = previaEstruturadoHtml(est.cardapios, rest?.nome || "Cardápio");
      const b64 = Buffer.from(html, "utf8").toString("base64");
      const url = await subirStorage(`cardapios/${rid}/previa_${Date.now()}.html`, b64, "text/html");
      if (!url) return { resumo: "falha na prévia", conteudo: JSON.stringify({ erro: "prévia gerada mas o upload falhou." }) };
      return { resumo: "prévia", conteudo: JSON.stringify({ previaUrl: url }) };
    },
  },
  gerar_pdf_site: {
    desc: "Gera o PDF DESENHADO (layout do módulo, igual ao 'Baixar PDF' do módulo) de UM cardápio e devolve o link. Passe `cardapio` = 'Comidas' | 'Bebidas' | 'Vinhos'. Use quando pedirem o PDF/arquivo final. Demora alguns segundos.",
    tipo: "read",
    schema: { type: "object", properties: { cardapio: { type: "string", description: "qual cardápio: Comidas, Bebidas ou Vinhos" } }, required: [] },
    exec: async (args, ctx) => {
      const rid = ctx.restaurantId || "";
      if (!rid) return { resumo: "sem restaurante", conteudo: JSON.stringify({ erro: "agente sem restaurante no escopo" }) };
      await ctx.onProgress?.(`⏳ Gerando o PDF de ${args.cardapio || "cardápio"} — leva uns 30-40s (o navegador precisa desenhar o layout). Já te mando aqui.`);
      try {
        const r = await fetch(APP_ORIGIN() + "/api/cardapio-site-pdf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rid, menu: String(args.cardapio || "") }) });
        const j = (await r.json()) as { pdfUrl?: string; error?: string };
        if (!r.ok || !j.pdfUrl) return { resumo: "falha no PDF", conteudo: JSON.stringify({ erro: j.error || `HTTP ${r.status}` }) };
        return { resumo: "PDF pronto", conteudo: JSON.stringify({ pdfUrl: j.pdfUrl }) };
      } catch (e) { return { resumo: "falha no PDF", conteudo: JSON.stringify({ erro: e instanceof Error ? e.message : "indisponível" }) }; }
    },
  },
  listar_arquivados_site: {
    desc: "Lista os pratos REMOVIDOS do cardápio do site que podem ser restaurados (título, cardápio, seção, preço que tinha, quando saiu). Use quando perguntarem 'o que já tiramos', 'quais pratos removidos', ou antes de restaurar.",
    tipo: "read",
    schema: { type: "object", properties: {}, required: [] },
    exec: async (_args, ctx) => {
      const arqs = await lerArquivados(ctx.restaurantId || "");
      if (!arqs.length) return { resumo: "lixeira vazia", conteudo: JSON.stringify({ arquivados: [] }) };
      const lista = arqs.map((a) => ({ item: a.nome, cardapio: a.cardapio, secao: a.secao, preco: (a.raw as { preco?: unknown }).preco ?? "", removidoEm: (a.arquivadoEm || "").slice(0, 10) }));
      return { resumo: `${arqs.length} arquivado(s)`, conteudo: JSON.stringify({ arquivados: lista }) };
    },
  },
  restaurar_prato_site: {
    desc: "Restaura um prato REMOVIDO do cardápio do site de volta na POSIÇÃO original, com o título, descrição e preço que tinha (reflete no site na hora). Confirme com o usuário antes. Se não souber o nome exato, use listar_arquivados_site. Args: item (título do prato), opcional cardapio/secao.",
    tipo: "write",
    schema: { type: "object", properties: { item: { type: "string" }, cardapio: { type: "string" }, secao: { type: "string" } }, required: ["item"] },
    exec: async (args, ctx) => {
      const rid = ctx.restaurantId || "";
      const arqs = await lerArquivados(rid);
      const alvo = achaArquivado(arqs, String(args.item || ""), args.secao as string, args.cardapio as string);
      if (!alvo) return { resumo: "não achei", conteudo: JSON.stringify({ erro: `nenhum prato arquivado batendo com "${args.item}"`, disponiveis: arqs.map((a) => a.nome) }) };
      const est = await lerEstruturado(rid);
      if (!est) return { resumo: "sem cardápio", conteudo: JSON.stringify({ erro: "cardápio não encontrado" }) };
      let c = est.cardapios.find((x) => nrm(x.nome) === nrm(alvo.cardapio)) || est.cardapios[0];
      if (!c) return { resumo: "sem cardápio", conteudo: JSON.stringify({ erro: "cardápio vazio" }) };
      let s = (c.secoes || []).find((x) => nrm(x.nome) === nrm(alvo.secao));
      if (!s) { s = { id: novoIdS("sec"), nome: alvo.secao, pratos: [] }; c.secoes = [...(c.secoes || []), s]; }
      s.pratos = s.pratos || [];
      const idx = Math.max(0, Math.min(alvo.posicao, s.pratos.length));
      s.pratos.splice(idx, 0, alvo.raw as unknown as PratoS);
      const salvo = await firestoreAtualizar("cardapioEstruturado", rid, { cardapios: est.cardapios as unknown as Doc[], atualizadoEm: new Date().toISOString(), atualizadoPor: ctx.pessoaNome });
      await tirarArquivado(rid, alvo.id, arqs);
      return { resumo: `restaurado ${alvo.nome}`, conteudo: JSON.stringify({ restaurado: alvo.nome, cardapio: c.nome, secao: s.nome, precoAntigo: (alvo.raw as { preco?: unknown }).preco ?? "", salvo }) };
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

  const anexo = temAnexo ? { base64: anexoB64, mediaType: anexoMime } : undefined;
  try {
    const out = await runAgenteCore(agente, {
      mensagem, historico: Array.isArray(body?.historico) ? body!.historico : [],
      pessoaNome: (body?.pessoaNome || user.email || "") as string, pessoaId: user.uid, anexo, canal: "app",
    });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao processar." });
  }
}

// ── Núcleo reusável do agente ────────────────────────────────────────────────
// Monta ferramentas/persona, roda o loop de tool-use no Claude e devolve a
// resposta. Usado pelo handler (chat do app) E pelo webhook do WhatsApp.
export type AgenteResultado = { resposta: string; toolCalls: { tool: string; resumo: string }[]; estadoCardapio?: unknown; pdfUrl?: string; previaUrl?: string };
export async function runAgenteCore(
  agente: Doc,
  opts: { mensagem: string; historico?: { role: string; texto: string }[]; pessoaNome: string; pessoaId: string; anexo?: { base64?: string; mediaType?: string }; canal?: string; onProgress?: (msg: string) => Promise<void> },
): Promise<AgenteResultado> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const agenteId = String(agente.id);
  const canal = opts.canal || "app";
  const mensagem = (opts.mensagem || "").toString().trim();
  const anexoB64 = (opts.anexo?.base64 || "").toString();
  const anexoMime = (opts.anexo?.mediaType || "").toString();
  const temAnexo = !!anexoB64 && (anexoMime.startsWith("image/") || anexoMime === "application/pdf");

  const escopo: Escopo = agente.entidades === "todas" || !Array.isArray(agente.entidades) ? "todas" : (agente.entidades as string[]);
  const toolsLigadas = (agente.tools || {}) as Record<string, boolean>;
  const readDisp = Object.keys(READ_TOOLS).filter(k => toolsLigadas[k]);
  const ehCardapio = agente.tipo === "cardapio";
  const ehCardapioSite = agente.tipo === "cardapio_site";
  const SKILLS = ehCardapioSite ? SKILL_TOOLS_SITE : SKILL_TOOLS;
  const agenteRid = Array.isArray(agente.entidades) && agente.entidades.length ? String(agente.entidades[0]) : "";
  const skillDisp = Object.keys(SKILLS).filter(k => ehCardapio || ehCardapioSite || toolsLigadas[k]);
  const temWrite = skillDisp.some(k => SKILLS[k].tipo === "write");
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
    ...skillDisp.map(k => ({ name: k, description: SKILLS[k].desc, input_schema: SKILLS[k].schema })),
  ];

  const sysBase = (agente.systemPrompt as string) || "Você é um assistente do planejamento.app.";
  const regras = temWrite
    ? " Para QUALQUER alteração: primeiro PROPONHA em texto o que vai mudar e peça confirmação explícita; só chame a ferramenta de escrita DEPOIS que o usuário confirmar ('confirma'/'pode aplicar') na mensagem seguinte. Nunca aplique sem confirmação."
    : " Você NÃO pode alterar nada nesta versão (só consulta); se pedirem uma alteração, explique que por ora você só consulta.";
  const temCardapio = skillDisp.includes("ler_cardapio") || skillDisp.includes("ler_cardapio_site");
  // No WhatsApp não há prévia HTML na tela — o agente descreve em texto e manda o link do PDF.
  const notaCardapio = !temCardapio ? ""
    : ehCardapioSite
      ? " Pra MOSTRAR/ver o cardápio (ex.: 'como está o cardápio'), chame gerar_previa_site — o link é ANEXADO AUTOMÁTICO na conversa, então NÃO cole a URL no seu texto (diga só 'segue a prévia 👇'). A prévia já mostra TUDO. NÃO faça resumo em texto. Só liste em texto se o usuário pedir explicitamente — e aí liste COMPLETO, todas as seções e TODOS os pratos com preço, nunca resumido. Depois de uma alteração, gere a prévia de novo pra conferir. Pra o PDF: são 3 cardápios (Comidas, Bebidas, Vinhos) — se o usuário não disser qual, PERGUNTE antes e gere só UM (o que ele pedir) com gerar_pdf_site. NUNCA gere os três de uma vez, e NÃO cole a URL do PDF (ele vai como arquivo)."
      : (canal === "whatsapp"
          ? " Aqui é WhatsApp: não há prévia visual na tela. Pra o usuário CONFERIR/APROVAR o cardápio (inclusive após uma alteração), chame gerar_previa — ela manda um link HTML que ele abre no celular. Quando pedirem o PDF/filipeta FINAL, chame gerar_pdf. Os links/arquivo aparecem sozinhos na conversa, não precisa colar a URL no texto."
          : " Quando pedirem pra VER/MOSTRAR o cardápio ou a prévia, chame ler_cardapio: a prévia visual (HTML) aparece SOZINHA na tela — não precisa listar item por item, só confirme que está mostrando. Depois de aplicar uma alteração, a prévia atualizada também aparece sozinha. Quando pedirem o PDF / a filipeta / o arquivo final, chame gerar_pdf: o link pra download aparece na conversa.");
  const notaRestaurar = !temCardapio ? ""
    : ehCardapioSite
      ? " Pratos removidos NÃO se perdem — vão pra uma lixeira. Se perguntarem 'o que já tiramos'/'quais pratos removidos', use listar_arquivados_site. Pra trazer um prato de volta (com título, descrição, preço e posição originais), use restaurar_prato_site (confirme antes)."
      : " Pratos removidos NÃO se perdem — vão pra uma lixeira. Se perguntarem 'o que já tiramos'/'quais pratos removidos', use listar_arquivados. Pra trazer um prato de volta (com nome, descrição, preço e posição originais), use restaurar_prato (confirme antes).";
  const notaCanal = canal === "whatsapp" ? " Você está respondendo pelo WhatsApp: seja conciso, sem markdown pesado (nada de tabelas), use quebras de linha curtas." : "";
  const system = sysBase + "\n\nVocê só sabe o que suas ferramentas retornam — nunca invente dados; se não achar, diga que não encontrou. Responda em português, direto, com valores em R$ e datas em dd/mm/aaaa." + regras + notaCardapio + notaRestaurar + notaCanal;

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const h of (opts.historico || []).slice(-10)) {
    // Pula mensagens VAZIAS — o Claude rejeita conteúdo vazio (HTTP 400).
    if (h && (h.role === "user" || h.role === "assistant") && typeof h.texto === "string" && h.texto.trim()) messages.push({ role: h.role, content: h.texto.trim() });
  }
  if (temAnexo) {
    const bloco = anexoMime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: anexoB64 } }
      : { type: "image", source: { type: "base64", media_type: anexoMime, data: anexoB64 } };
    messages.push({ role: "user", content: [bloco, { type: "text", text: mensagem || "Segue um arquivo. Leia com atenção e me ajude com base nele." }] });
  } else {
    messages.push({ role: "user", content: mensagem });
  }

  const toolCalls: { tool: string; resumo: string }[] = [];
  let tocouCardapio = false;
  let pdfUrl: string | null = null;
  let previaUrl: string | null = null;
  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const payload = { model: (agente.model as string) || MODEL_PADRAO, max_tokens: 2000, system, messages, tools: anthropicTools };
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await resp.text();
    if (!resp.ok) throw new Error(`Claude HTTP ${resp.status}. ${raw.slice(0, 300)}`);
    const j = JSON.parse(raw) as { stop_reason?: string; content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> };
    const blocks = j.content || [];

    if (j.stop_reason !== "tool_use") {
      const texto = blocks.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
      const out: AgenteResultado = { resposta: texto || "(sem resposta)", toolCalls };
      if (tocouCardapio) out.estadoCardapio = await lerCardapioEstado();
      if (pdfUrl) out.pdfUrl = pdfUrl;
      if (previaUrl) out.previaUrl = previaUrl;
      return out;
    }

    messages.push({ role: "assistant", content: blocks });
    const results: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
    for (const b of blocks) {
      if (b.type !== "tool_use" || !b.name || !b.id) continue;
      const input = (b.input || {}) as Doc;
      const skill = SKILLS[b.name];
      if (b.name === "ler_cardapio" || b.name === "aplicar_cardapio") tocouCardapio = true;
      const { resumo, conteudo } = skill
        ? await skill.exec(input, { pessoaId: opts.pessoaId, pessoaNome: opts.pessoaNome, restaurantId: agenteRid, onProgress: opts.onProgress })
        : await execTool(b.name, input as { restaurantId?: string; periodo?: string; busca?: string }, escopo);
      toolCalls.push({ tool: b.name, resumo });
      if (b.name === "gerar_pdf" || b.name === "gerar_pdf_site") { try { const p = JSON.parse(conteudo) as { pdfUrl?: string }; if (p.pdfUrl) pdfUrl = p.pdfUrl; } catch { /* ignore */ } }
      if (b.name === "gerar_previa" || b.name === "gerar_previa_site") { try { const p = JSON.parse(conteudo) as { previaUrl?: string }; if (p.previaUrl) previaUrl = p.previaUrl; } catch { /* ignore */ } }
      results.push({ type: "tool_result", tool_use_id: b.id, content: conteudo });
      try {
        const logId = `alog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await firestoreCriar("agenteLogs", logId, {
          id: logId, agenteId, pessoaId: opts.pessoaId, pessoaNome: opts.pessoaNome,
          tool: b.name, tipo: skill ? skill.tipo : "read", args: input, resumo, canal, criadoEm: new Date().toISOString(),
        });
      } catch { /* log é best-effort */ }
    }
    messages.push({ role: "user", content: results });
  }
  return { resposta: "Precisei de muitas consultas e parei por segurança. Pode refazer a pergunta de forma mais específica?", toolCalls };
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

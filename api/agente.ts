// ════════════════════════════════════════════════════════════════════════════
//  /api/agente — motor dos Agentes de IA (F1b). Loop de tool-use do Claude com
//  ferramentas de LEITURA (consulta a coleções do Firestore, filtradas pelo
//  escopo de entidades do agente). Cada chamada de ferramenta vira log em
//  `agenteLogs`. Escrita ainda não: as tools de escrita virão em modo confirmação.
//  Exige usuário logado (Firebase ID token). Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";
import { firestoreListar, firestoreCriar } from "./_firestoreRest.js";

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
  } | null;
  const agenteId = (body?.agenteId || "").toString();
  const mensagem = (body?.mensagem || "").toString().trim();
  if (!agenteId || !mensagem) { res.status(400).json({ error: "agenteId e mensagem são obrigatórios." }); return; }

  // Carrega a config do agente.
  const agentes = await firestoreListar("agentesIA");
  const agente = agentes.find(a => a.id === agenteId) as Doc | undefined;
  if (!agente) { res.status(404).json({ error: "Agente não encontrado." }); return; }
  if (agente.ativo === false) { res.status(400).json({ error: "Agente pausado." }); return; }

  const escopo: Escopo = agente.entidades === "todas" || !Array.isArray(agente.entidades) ? "todas" : (agente.entidades as string[]);
  const toolsLigadas = (agente.tools || {}) as Record<string, boolean>;
  // Só expõe ferramentas de leitura implementadas E ligadas no agente.
  const toolsDisp = Object.keys(READ_TOOLS).filter(k => toolsLigadas[k]);
  const anthropicTools = toolsDisp.map(k => ({
    name: k,
    description: READ_TOOLS[k].desc + " Filtre por restaurantId (entidade), periodo (prefixo de data YYYY, YYYY-MM ou YYYY-MM-DD) e/ou busca (texto livre) quando fizer sentido.",
    input_schema: { type: "object" as const, properties: {
      restaurantId: { type: "string", description: "id da entidade, se quiser restringir" },
      periodo: { type: "string", description: "prefixo de data: 2026, 2026-07, 2026-07-14" },
      busca: { type: "string", description: "texto livre pra filtrar (nome, fornecedor, descrição)" },
    }, required: [] },
  }));

  const sysBase = (agente.systemPrompt as string) || "Você é um assistente do planejamento.app.";
  const system = sysBase + "\n\nVocê só sabe o que suas ferramentas retornam — nunca invente dados; se não achar, diga que não encontrou. Responda em português, direto, com valores em R$ e datas em dd/mm/aaaa. Você NÃO pode alterar nada nesta versão (só consulta); se pedirem uma alteração, explique que a edição chega numa próxima etapa e que por ora você só consulta.";

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const h of (Array.isArray(body?.historico) ? body!.historico : []).slice(-10)) {
    if (h && (h.role === "user" || h.role === "assistant") && typeof h.texto === "string") messages.push({ role: h.role, content: h.texto });
  }
  messages.push({ role: "user", content: mensagem });

  const toolCalls: { tool: string; resumo: string }[] = [];
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
        res.status(200).json({ resposta: texto || "(sem resposta)", toolCalls });
        return;
      }

      // Executa cada tool_use e monta os tool_results.
      messages.push({ role: "assistant", content: blocks });
      const results: Array<{ type: "tool_result"; tool_use_id: string; content: string }> = [];
      for (const b of blocks) {
        if (b.type !== "tool_use" || !b.name || !b.id) continue;
        const args = (b.input || {}) as { restaurantId?: string; periodo?: string; busca?: string };
        const { resumo, conteudo } = await execTool(b.name, args, escopo);
        toolCalls.push({ tool: b.name, resumo });
        results.push({ type: "tool_result", tool_use_id: b.id, content: conteudo });
        // Auditoria (append-only). Não bloqueia a resposta se falhar.
        try {
          const logId = `alog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await firestoreCriar("agenteLogs", logId, {
            id: logId, agenteId, pessoaId: user.uid, pessoaNome: (body?.pessoaNome || user.email || "") as string,
            tool: b.name, tipo: "read", args, resumo, canal: "app", criadoEm: new Date().toISOString(),
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

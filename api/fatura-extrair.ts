// ════════════════════════════════════════════════════════════════════════════
//  /api/fatura-extrair — lê uma FATURA de cartão em PDF e devolve os lançamentos
//  estruturados (data, descrição, valor, parcela) + vencimento + total da
//  fatura. NÃO grava nada; a classificação/gravação é no cliente. Exige Firebase
//  ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 300 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const DOWNLOAD_TIMEOUT_MS = 30_000;   // baixar o PDF do Storage — se travar aqui, é rede, não a IA
const IA_TIMEOUT_MS = 140_000;        // por chamada — cabe 2 (leitura + reconciliação) dentro do maxDuration de 300s

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

type HistItem = { descricao: string; destino?: string | null; categoria?: string | null };
function montarPrompt(cartoes: string[], empresaPropria: string, empresas: string[], categorias: string[], historico: HistItem[]): string {
  const blocoHistorico = historico.length
    ? "\nREFERÊNCIA DE CLASSIFICAÇÕES ANTERIORES (como lançamentos semelhantes já foram classificados neste cartão/conta — use como BASE FORTE pra decidir destino e categoria, casando pelo nome do estabelecimento; mesma loja → mesmo destino/categoria de antes): " +
      JSON.stringify(historico.slice(0, 200)) + "\n"
    : "";
  const listaCartoes = cartoes.length
    ? "8) cartao = identifique de QUAL cartão é esta fatura, escolhendo EXATAMENTE UM desta lista cadastrada: " + JSON.stringify(cartoes) +
      ". Use a bandeira (Mastercard/Visa/Elo), o banco/emissor e os 4 últimos dígitos que aparecem no PDF pra casar. Retorne a string idêntica à da lista. Se nenhum casar com confiança, retorne null.\n"
    : "8) cartao = null (nenhum cartão cadastrado pra casar).\n";
  const propria = empresaPropria || "a própria entidade";
  const destinoRegra =
    "9) destino = pra quem é o gasto. Use \"propria\" quando for gasto da própria entidade (" + propria + "). " +
    (empresas.length ? "Use o NOME EXATO de uma destas outras empresas quando o gasto for claramente dela (ex: compra pra loja X): " + JSON.stringify(empresas) + ". Na dúvida, \"propria\"." : "Sempre \"propria\" (não há outras empresas cadastradas).") + "\n";
  const categoriaRegra = categorias.length
    ? "10) categoria = classifique cada lançamento em UMA destas categorias, retornando o NOME EXATO (ou null se nenhuma servir): " + JSON.stringify(categorias) +
      ". Use o nome do estabelecimento pra inferir com bom senso (ex: SUPERMERCADO/HORTIFRUTI→mercado/insumos, PAPELARIA→material de escritório, POSTO/ipiranga/shell→combustível, UBER/99/pedágio/tag→transporte, farmácia→saúde, restaurante/ifood→alimentação). Seja consistente: mesmo estabelecimento → mesma categoria.\n"
    : "10) categoria = null (nenhuma categoria cadastrada).\n";
  return "Você recebe o PDF de uma FATURA de cartão de crédito (Itaú, Santander, etc). Extraia TODOS os lançamentos, classifique-os e devolva os dados da fatura. Aja como um analista financeiro classificando os gastos numa conversa. Regras:\n" +
  "1) Para CADA lançamento (compra, estorno, encargo, anuidade, IOF): data ('DD/MM'), descricao (nome do estabelecimento, SEM o código de parcela grudado), valor (número), parcela.\n" +
  "1b) MÚLTIPLOS CARTÕES: a fatura pode ter mais de um cartão (titular + adicionais), cada um com 'final XXXX'. Extraia os lançamentos DO MÊS de todos os cartões — mas SEMPRE só da seção 'Lançamentos'/'compras e saques' de cada um. NUNCA pegue nada da seção 'Compras parceladas - próximas faturas' / demonstrativo de parcelamento (regra 4c). Na dúvida entre incluir uma linha suspeita de ser futura ou deixá-la de fora, DEIXE DE FORA — melhor faltar (o humano completa) do que sobrar.\n" +
  "2) valor = número em reais. Use ponto decimal. ESTORNOS/CRÉDITOS/PAGAMENTOS a favor do cliente = valor NEGATIVO. Ex: '1.977,50' → 1977.50 ; '-30,98' → -30.98.\n" +
  "3) parcela = se a descrição tiver marca de parcela (ex: 'MURR CADEIRAS LTDA03/03', 'AGP*BARFACIL*T08/12'), extraia como '03/03' / '08/12' e TIRE ela da descricao. Se não for parcelado, parcela = null.\n" +
  "1d) IOF DE COMPRAS INTERNACIONAIS (IMPORTANTE — costuma ficar de fora): cada seção de 'Lançamentos internacionais' (uma por cartão) termina com uma linha 'Repasse de IOF em R$ <valor>'. Esse IOF É COBRADO nesta fatura (ele compõe o 'Total lançamentos inter.') — ele só não vem como transação com data. INCLUA cada 'Repasse de IOF' como um lançamento próprio: descricao = 'Repasse de IOF (compras internacionais)', valor = o número, data = null, parcela = null. Se houver mais de um cartão com compras internacionais, haverá mais de um 'Repasse de IOF' — inclua TODOS (um por cartão). Este é uma exceção deliberada à regra 4: apesar de parecer subtotal, é um encargo real. (NÃO inclua 'Total transações inter.' nem 'Total lançamentos inter.' — esses sim são subtotais.)\n" +
  "4) NÃO inclua linhas de resumo/subtotal ('Total desta fatura', 'Lançamentos atuais', 'Total da fatura anterior', 'Total transações inter.', 'Total lançamentos inter.', 'Total lançamentos atuais'), nem textos legais/instruções. SÓ os lançamentos reais. (Exceção: 'Repasse de IOF', que É um encargo — ver regra 1d.)\n" +
  "4b) NÃO inclua o PAGAMENTO DA PRÓPRIA FATURA (quitação da fatura anterior). Costuma aparecer como valor negativo grande com descrição tipo 'PAGAMENTO DE FATURA', 'PAGTO FATURA', 'PAGAMENTO ONLINE', 'PAGAMENTO EFETUADO', 'PAGAMENTO RECEBIDO', 'PGTO DEBITO CONTA'. ISSO NÃO É GASTO — descarte. (ATENÇÃO: estorno/crédito de uma COMPRA específica de estabelecimento, esse SIM mantém, negativo.)\n" +
  "4c) REGRA MAIS IMPORTANTE (acima de fechar qualquer soma) — parcelamentos: extraia SÓ os lançamentos cobrados NESTA fatura. Cada compra parcelada aparece UMA única vez, com a parcela do mês (ex: 'RBAIAO 03/18'). O que se IGNORA é o CRONOGRAMA FUTURO: seções rotuladas EXPLICITAMENTE 'Próximas faturas' / 'Compras parceladas — próximas faturas' / 'Demonstrativo de parcelas' / 'Lançamentos futuros' / 'obrigações futuras', OU a MESMA compra (mesma loja E MESMO VALOR) repetida em parcelas sequenciais (01/10 R$100 · 02/10 R$100 · 03/10 R$100...) — aí pegue no máximo a do mês. Descarte também 'saldo financiado', 'total parcelado' ou linha que zere/balanceie o cronograma.\n" +
  "4d) NÃO CONFUNDA (causa nº1 de faltar dinheiro): em faturas SANTANDER e afins, as seções 'Parcelamentos' e 'Despesas' dentro do 'Detalhamento da Fatura' SÃO os gastos cobrados NESTE mês — cada linha é uma compra DIFERENTE (lojas e valores distintos), mostrando a parcela atual (ex: '04/05'). INCLUA TODAS. NÃO ignore uma seção só porque o título diz 'Parcelamentos'. Só é futuro pelos critérios da 4c. Leia AMBAS as seções ('Parcelamentos' E 'Despesas'/'à vista') — elas costumam continuar na PÁGINA SEGUINTE, não pare na primeira. A mesma loja pode aparecer VÁRIAS vezes com valores diferentes (compras distintas) — inclua cada uma.\n" +
  "5) vencimento = data de vencimento da fatura no formato 'YYYY-MM-DD'.\n" +
  "6) totalFatura = o valor do 'Total desta fatura' (número, ponto decimal).\n" +
  "7) NÃO invente nada. Se um campo não existir, use null.\n" +
  listaCartoes + destinoRegra + categoriaRegra +
  "11) duvida = true quando você NÃO tem certeza deste lançamento: valor pouco legível, descrição ilegível/ambígua, linha de grade multi-coluna de cartão adicional sem nome de loja, ou qualquer leitura que você teve que chutar. duvidaMotivo = frase curta dizendo o motivo (ex: 'valor pouco legível', 'sem nome de estabelecimento', 'grade de cartão adicional'). Se tiver certeza, duvida = false e duvidaMotivo = null. Prefira marcar duvida=true a esconder um lançamento — é melhor o humano conferir do que sumir com o valor.\n" +
  "12) CONFERÊNCIA OBRIGATÓRIA antes de responder: some TODOS os lançamentos que você extraiu (sem os pagamentos/estornos negativos). Esse total tem que se APROXIMAR do 'Total de Despesas/Débitos' ou 'Total desta fatura' (o mesmo totalFatura). Se a sua soma ficar bem ABAIXO do total, você PULOU alguma seção (tipicamente 'Despesas'/'à vista', a continuação na página seguinte, ou um cartão adicional) — VOLTE, releia o PDF inteiro e inclua o que faltou. Não responda com a soma furada.\n" +
  blocoHistorico +
  "\nResponda SOMENTE um objeto JSON (sem texto antes/depois): { \"cartao\": \"...\"|null, \"vencimento\": \"YYYY-MM-DD\"|null, \"totalFatura\": number|null, \"lancamentos\": [ { \"data\": \"DD/MM\", \"descricao\": \"...\", \"valor\": number, \"parcela\": \"XX/YY\"|null, \"destino\": \"propria\"|\"<nome empresa>\", \"categoria\": \"<nome>\"|null, \"duvida\": true|false, \"duvidaMotivo\": \"<motivo>\"|null } ] }";
}

// Prompt da 2ª passada: a soma ficou abaixo do total → a IA pulou lançamentos.
// Manda o que já achou (pra não repetir) e pede SÓ o que faltou.
function montarPromptReconc(jaTem: Array<{ data: string; descricao: string; valor?: number }>, total: number, gap: number, empresaPropria: string, empresas: string[], categorias: string[]): string {
  const propria = empresaPropria || "a própria entidade";
  return "Esta é a MESMA fatura de cartão que você acabou de ler. Você JÁ extraiu estes lançamentos (NÃO repita NENHUM deles): " + JSON.stringify(jaTem.slice(0, 400)) +
  ".\nA soma deles dá R$ " + (total - gap).toFixed(2) + ", mas o TOTAL de despesas da fatura é R$ " + total.toFixed(2) + " — ou seja, FALTAM R$ " + gap.toFixed(2) + ". Você PULOU lançamentos. Quase sempre é: a seção 'Despesas'/'à vista' (compras não parceladas); a CONTINUAÇÃO de uma seção na PÁGINA SEGUINTE; um cartão adicional numa grade compacta; ou COMPRAS INTERNACIONAIS (seção 'Lançamentos internacionais', valores em dólar com 'Dólar de Conversão' — pegue o valor JÁ CONVERTIDO em R$ de cada linha; pode haver mais de uma seção dessas, uma por cartão — leia TODAS; e inclua o 'Repasse de IOF em R$' de cada uma, regra 1d).\n" +
  "Releia o PDF INTEIRO, com atenção redobrada às seções que você pode ter pulado, e devolva SOMENTE os lançamentos que FALTARAM (os que NÃO estão na lista acima). Mesmas regras: data 'DD/MM'; descricao (nome da loja, SEM a parcela grudada); valor (número, ponto decimal; estorno/crédito NEGATIVO); parcela ('XX/YY'|null); destino ('propria' pra " + propria + (empresas.length ? "', ou o nome exato de: " + JSON.stringify(empresas) : "'") + "); categoria (" + (categorias.length ? "uma de " + JSON.stringify(categorias) + " ou null" : "null") + "); duvida. NÃO inclua subtotais ('VALOR TOTAL', 'Total desta fatura', 'Total Despesas/Débitos'), nem o pagamento da própria fatura. Se REALMENTE não faltar nada, devolva lancamentos vazio.\n" +
  "Responda SOMENTE JSON: { \"lancamentos\": [ { \"data\": \"DD/MM\", \"descricao\": \"...\", \"valor\": number, \"parcela\": \"XX/YY\"|null, \"destino\": \"propria\"|\"<empresa>\", \"categoria\": \"<nome>\"|null, \"duvida\": true|false, \"duvidaMotivo\": \"<motivo>\"|null } ] }";
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { pdfUrl?: string; cartoes?: string[]; empresaPropria?: string; empresas?: string[]; categorias?: string[]; historico?: HistItem[] } | null;
  const pdfUrl = (body?.pdfUrl || "").toString();
  if (!/^https?:\/\//.test(pdfUrl)) { res.status(400).json({ error: "pdfUrl inválida." }); return; }
  const strArr = (v: unknown, n: number) => Array.isArray(v) ? v.filter((c) => typeof c === "string" && c.trim()).map((c) => (c as string).trim()).slice(0, n) : [];
  const cartoes = strArr(body?.cartoes, 20);
  const empresaPropria = (body?.empresaPropria || "").toString().slice(0, 80);
  const empresas = strArr(body?.empresas, 30);
  const categorias = strArr(body?.categorias, 60);
  const historico = (Array.isArray(body?.historico) ? body!.historico : [])
    .filter((h): h is HistItem => !!h && typeof h.descricao === "string")
    .map((h) => ({ descricao: String(h.descricao).slice(0, 80), destino: h.destino ? String(h.destino).slice(0, 60) : null, categoria: h.categoria ? String(h.categoria).slice(0, 60) : null }))
    .slice(0, 200);

  // Download do PDF: teto curto próprio (se travar aqui é rede/Storage, não a IA).
  const dlCtrl = new AbortController();
  const dlTimer = setTimeout(() => dlCtrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let b64: string;
  try {
    const pr = await fetch(pdfUrl, { signal: dlCtrl.signal });
    if (!pr.ok) { res.status(502).json({ error: `Não consegui baixar o PDF (HTTP ${pr.status}).` }); return; }
    const buf = Buffer.from(await pr.arrayBuffer());
    if (buf.length > 25 * 1024 * 1024) { res.status(413).json({ error: "PDF muito grande (máx 25MB)." }); return; }
    b64 = buf.toString("base64");
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${DOWNLOAD_TIMEOUT_MS / 1000}s) ao baixar o PDF do Storage.` : (e instanceof Error ? e.message : "Falha ao baixar o PDF.");
    res.status(502).json({ error: msg }); return;
  } finally { clearTimeout(dlTimer); }

  // Uma chamada à IA (PDF + prompt) → JSON cru. Timeout próprio por chamada.
  type LancRaw = { data?: string; descricao?: string; valor?: number; parcela?: string | null; destino?: string | null; categoria?: string | null; duvida?: boolean; duvidaMotivo?: string | null };
  async function chamarIA(promptText: string): Promise<{ cartao?: string | null; vencimento?: string | null; totalFatura?: number | null; lancamentos?: LancRaw[] }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), IA_TIMEOUT_MS);
    try {
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 16000, messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: promptText },
        ] }] }),
        signal: ctrl.signal,
      });
      const txt = await resp.text();
      if (!resp.ok) throw new Error(`Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}`);
      const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
      const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
      const m = textOut.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("A IA não retornou JSON.");
      return JSON.parse(m[0]);
    } finally { clearTimeout(timer); }
  }
  const chaveLanc = (l: LancRaw) => `${String(l.descricao || "").toLowerCase().trim()}|${Number(l.valor)}|${String(l.data || "")}`;

  try {
    const parsed = await chamarIA(montarPrompt(cartoes, empresaPropria, empresas, categorias, historico));
    const lancRaw: LancRaw[] = Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [];
    const total = typeof parsed.totalFatura === "number" ? parsed.totalFatura : null;

    // 2ª passada — RECONCILIAÇÃO: se a soma dos gastos ficou bem abaixo do total,
    // a IA pulou alguma seção (quase sempre 'Despesas'/'à vista' ou continuação de
    // página). Pede SÓ o que faltou, sem repetir. Best-effort (se falhar, segue).
    if (total && total > 0) {
      const somaPos = lancRaw.filter((l) => typeof l.valor === "number" && (l.valor as number) > 0).reduce((s, l) => s + (l.valor as number), 0);
      const gap = total - somaPos;
      if (gap > 50 && gap > total * 0.05) {
        try {
          const jaTem = lancRaw.filter((l) => l && l.descricao).map((l) => ({ data: l.data || "", descricao: String(l.descricao), valor: l.valor }));
          const parsed2 = await chamarIA(montarPromptReconc(jaTem, total, gap, empresaPropria, empresas, categorias));
          const novos: LancRaw[] = Array.isArray(parsed2.lancamentos) ? parsed2.lancamentos : [];
          const existentes = new Set(lancRaw.map(chaveLanc));
          for (const n of novos) { if (n && n.descricao && typeof n.valor === "number" && !existentes.has(chaveLanc(n))) { lancRaw.push(n); existentes.add(chaveLanc(n)); } }
        } catch { /* reconciliação é best-effort */ }
      }
    }
    parsed.lancamentos = lancRaw;
    // Resolve destino/categoria sugeridos contra as listas cadastradas (case-insensitive).
    const acharEmpresa = (nome?: string | null) => (nome && nome.toLowerCase() !== "propria" && nome.toLowerCase() !== "minha") ? (empresas.find((e) => e.toLowerCase() === String(nome).toLowerCase().trim()) || null) : null;
    const acharCategoria = (nome?: string | null) => nome ? (categorias.find((c) => c.toLowerCase() === String(nome).toLowerCase().trim()) || null) : null;
    const lancamentos = (Array.isArray(parsed.lancamentos) ? parsed.lancamentos : [])
      .filter((l) => l && typeof l.descricao === "string" && l.descricao.trim() && typeof l.valor === "number")
      .map((l) => ({
        data: String(l.data || "").trim(), descricao: String(l.descricao).trim(), valor: Number(l.valor), parcela: l.parcela ? String(l.parcela).trim() : null,
        destinoEmpresa: acharEmpresa(l.destino), categoriaSugerida: acharCategoria(l.categoria),
        duvida: l.duvida === true, duvidaMotivo: l.duvida === true && l.duvidaMotivo ? String(l.duvidaMotivo).slice(0, 120) : null,
      }));
    // Só aceita cartão se casar (case-insensitive) com um dos cadastrados.
    const cartaoDetectado = typeof parsed.cartao === "string"
      ? (cartoes.find((c) => c.toLowerCase() === parsed.cartao!.toLowerCase().trim()) || null)
      : null;
    res.status(200).json({ cartao: cartaoDetectado, vencimento: parsed.vencimento || null, totalFatura: typeof parsed.totalFatura === "number" ? parsed.totalFatura : null, lancamentos });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${IA_TIMEOUT_MS / 1000}s) na leitura do PDF.` : (e instanceof Error ? e.message : "Falha ao processar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

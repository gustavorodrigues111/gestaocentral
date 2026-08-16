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
const IA_TIMEOUT_MS = 285_000;        // leitura+classificação pela IA (fatura grande com vários cartões pode passar de 1min)

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
  "4c) REGRA MAIS IMPORTANTE (acima de fechar qualquer soma) — parcelamentos: extraia SÓ os lançamentos cobrados NESTA fatura (a seção 'Lançamentos'/'Compras' do mês). Cada compra parcelada aparece UMA única vez aqui, com a parcela do mês (ex: 'RBAIAO 03/18'). NÃO leia as seções de PARCELAMENTO / 'Compras parceladas — detalhamento' / 'Próximas faturas' / 'Demonstrativo de parcelas' / 'Lançamentos futuros', que listam TODAS as parcelas de uma compra (01/10, 02/10, ...) — essas NÃO são cobradas agora. Se você vir a mesma compra repetida em várias parcelas sequenciais (01/10, 02/10, 03/10...), é o cronograma futuro: IGNORE, pegue no máximo a parcela do mês. Também descarte qualquer 'saldo financiado', 'total parcelado' ou linha que zere/balanceie o cronograma.\n" +
  "5) vencimento = data de vencimento da fatura no formato 'YYYY-MM-DD'.\n" +
  "6) totalFatura = o valor do 'Total desta fatura' (número, ponto decimal).\n" +
  "7) NÃO invente nada. Se um campo não existir, use null.\n" +
  listaCartoes + destinoRegra + categoriaRegra +
  "11) duvida = true quando você NÃO tem certeza deste lançamento: valor pouco legível, descrição ilegível/ambígua, linha de grade multi-coluna de cartão adicional sem nome de loja, ou qualquer leitura que você teve que chutar. duvidaMotivo = frase curta dizendo o motivo (ex: 'valor pouco legível', 'sem nome de estabelecimento', 'grade de cartão adicional'). Se tiver certeza, duvida = false e duvidaMotivo = null. Prefira marcar duvida=true a esconder um lançamento — é melhor o humano conferir do que sumir com o valor.\n" +
  blocoHistorico +
  "\nResponda SOMENTE um objeto JSON (sem texto antes/depois): { \"cartao\": \"...\"|null, \"vencimento\": \"YYYY-MM-DD\"|null, \"totalFatura\": number|null, \"lancamentos\": [ { \"data\": \"DD/MM\", \"descricao\": \"...\", \"valor\": number, \"parcela\": \"XX/YY\"|null, \"destino\": \"propria\"|\"<nome empresa>\", \"categoria\": \"<nome>\"|null, \"duvida\": true|false, \"duvidaMotivo\": \"<motivo>\"|null } ] }";
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

  // Leitura+classificação pela IA: teto longo (fatura grande com vários cartões pode passar de 1min).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IA_TIMEOUT_MS);
  try {
    const payload = {
      model: MODEL,
      max_tokens: 16000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        { type: "text", text: montarPrompt(cartoes, empresaPropria, empresas, categorias, historico) },
      ] }],
    };
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
    const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) { res.status(502).json({ error: "A IA não retornou JSON." }); return; }
    const parsed = JSON.parse(m[0]) as { cartao?: string | null; vencimento?: string | null; totalFatura?: number | null; lancamentos?: Array<{ data?: string; descricao?: string; valor?: number; parcela?: string | null; destino?: string | null; categoria?: string | null; duvida?: boolean; duvidaMotivo?: string | null }> };
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

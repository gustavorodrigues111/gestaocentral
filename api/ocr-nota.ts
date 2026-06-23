// ════════════════════════════════════════════════════════════════════════════
//  /api/ocr-nota — extrai dados de uma nota fiscal (imagem ou PDF) via Claude
//  vision (Haiku, barato). Devolve { emissor, valorTotal, dataEmissao } pra
//  PRÉ-PREENCHER o form — o usuário confere e corrige antes de salvar.
//
//  POST body: { data: <base64 sem prefixo>, mediaType: "image/jpeg"|"image/png"|
//               "image/webp"|"application/pdf" }
//  Exige Firebase ID token. Chave Anthropic em env var ANTHROPIC_API_KEY.
//
//  Segue o padrão das outras functions deste projeto (fetch cru; a pasta /api
//  roda num runtime próprio fora do tsconfig).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6"; // lê nota fiscal melhor que o Haiku; ~3x o custo (ainda centavos/nota)
const REQ_TIMEOUT_MS = 30_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const REGRA_DATA =
  "DATAS: documentos brasileiros usam DD/MM/AAAA (o DIA vem primeiro). Ao converter para YYYY-MM-DD, " +
  "o 1º número é o DIA e o 2º é o MÊS. Ex: 06/07/2026 = 2026-07-06 (seis de julho), NUNCA 2026-06-07. " +
  "Nunca trate como data americana (MM/DD).\n";

const PROMPT =
  "Você recebe uma ou mais páginas (imagens/PDF) de UMA MESMA nota fiscal brasileira. " +
  "Junte as páginas: o cabeçalho costuma estar na 1ª e os itens continuam nas seguintes. " +
  "Liste TODOS os itens de TODAS as páginas (não pare na primeira). Extraia os campos abaixo e responda " +
  "SOMENTE um objeto JSON (sem texto antes ou depois). Números em reais como NÚMERO (ex 1234.56), " +
  'sem "R$" e sem separador de milhar. Se não tiver certeza de um campo, use null. NÃO invente valores.\n' +
  REGRA_DATA +
  "{\n" +
  '  "emissor": <razão social/nome do fornecedor que EMITIU a nota, ou null>,\n' +
  '  "cnpjEmissor": <CNPJ do emissor só com dígitos, ou null>,\n' +
  '  "numeroNota": <número da NF, ou null>,\n' +
  '  "serieNota": <série da NF, ou null>,\n' +
  '  "chaveAcesso": <chave de acesso de 44 dígitos, só números, ou null>,\n' +
  '  "valorProdutos": <subtotal dos produtos antes de frete/desconto, ou null>,\n' +
  '  "valorTotal": <valor TOTAL da nota, ou null>,\n' +
  '  "valorImpostos": <total de tributos/impostos, ou null>,\n' +
  '  "dataEmissao": <data de emissão em YYYY-MM-DD, ou null>,\n' +
  '  "itens": [<{"descricao": str, "quantidade": num, "unidade": str, "valorUnitario": num, "valorTotal": num}>, ...] ou [],\n' +
  '  "duplicatas": [<{"numero": str, "valor": num, "vencimento": "YYYY-MM-DD"}>, ...] ou []  (faturas/parcelas da cobrança)\n' +
  "}";

const PROMPT_BOLETO =
  "Você recebe a imagem/PDF de um BOLETO bancário brasileiro. Extraia os campos abaixo e responda " +
  "SOMENTE um objeto JSON (sem texto antes ou depois). Números em reais como NÚMERO (ex 1234.56), " +
  'sem "R$" e sem separador de milhar. Se não tiver certeza de um campo, use null. NÃO invente valores.\n' +
  REGRA_DATA +
  "{\n" +
  '  "emissor": <beneficiário/cedente do boleto (quem recebe), ou null>,\n' +
  '  "duplicatas": [<{"numero": <número do documento/parcela ou null>, "valor": <valor do boleto>, "vencimento": "YYYY-MM-DD"}>, ...]  (uma entrada por boleto/parcela; normalmente 1)\n' +
  "}";

const PROMPT_FECHAMENTO =
  "Você recebe uma ou mais imagens/PDF do fechamento de caixa de um restaurante: o COMPROVANTE de fechamento " +
  "(sistema Altec/PDV, com os totais consolidados) e as FILIPETAS de fechamento de cada maquininha de cartão " +
  "(podem estar todas numa mesma foto). Junte tudo e responda SOMENTE um objeto JSON (sem texto antes ou depois). " +
  'Números em reais como NÚMERO (ex 1234.56), sem "R$" e sem separador de milhar. null/[] se não achar. NÃO invente.\n' +
  REGRA_DATA +
  "{\n" +
  '  "data": <data do fechamento em YYYY-MM-DD (use a data inicial/de abertura do caixa), ou null>,\n' +
  '  "turno": <"almoco" se o caixa foi do período de dia/tarde (abertura por volta de 11h-13h), "jantar" se da noite (abertura por volta de 18h-20h); ou null>,\n' +
  '  "totalVendas": <valor TOTAL de vendas do turno, ou null>,\n' +
  '  "dinheiro": <total recebido em DINHEIRO, ou null>,\n' +
  '  "pix": <total recebido em PIX, ou null>,\n' +
  '  "credito": <total em cartão de CRÉDITO somando todas as maquininhas, ou null>,\n' +
  '  "debito": <total em cartão de DÉBITO somando todas as maquininhas, ou null>,\n' +
  '  "maquininhas": [<{"identificador": <nome/bandeira da maquininha, ex "Stone","Cielo","TON","Rede", ou null>, "credito": <num ou null>, "debito": <num ou null>, "total": <num ou null>}>, ...]  (uma por filipeta; [] se não houver)\n' +
  "}";

const PROMPT_COMANDA =
  "Você recebe a imagem/PDF com UMA OU VÁRIAS COMANDAS de consumo de restaurante (impressas pelo PDV; " +
  "pode haver várias comandas espalhadas na mesma foto). Identifique o NÚMERO de CADA comanda/mesa " +
  "(geralmente em destaque, como 'Mesa 99', 'Comanda 12'). " +
  'Responda SOMENTE um objeto JSON (sem texto antes ou depois).\n' +
  "{\n" +
  '  "numeros": [<número de cada comanda/mesa visível, só dígitos, como string>, ...]  (todas que aparecem; [] se nenhuma)\n' +
  "}";

function parseNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
    const n = parseFloat(t);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function digits(v: unknown): string | null {
  const s = typeof v === "string" ? v.replace(/\D/g, "") : (typeof v === "number" ? String(v) : "");
  return s || null;
}
function parseItens(v: unknown): ItemNotaOut[] {
  if (!Array.isArray(v)) return [];
  const out: ItemNotaOut[] = [];
  for (const it of v.slice(0, 200)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const item: ItemNotaOut = {};
    const d = str(o.descricao); if (d) item.descricao = d;
    const q = parseNum(o.quantidade); if (q != null) item.quantidade = q;
    const u = str(o.unidade); if (u) item.unidade = u;
    const vu = parseNum(o.valorUnitario); if (vu != null) item.valorUnitario = vu;
    const vt = parseNum(o.valorTotal); if (vt != null) item.valorTotal = vt;
    if (Object.keys(item).length) out.push(item);
  }
  return out;
}
type ItemNotaOut = { descricao?: string; quantidade?: number; unidade?: string; valorUnitario?: number; valorTotal?: number };
type DuplicataOut = { numero?: string; valor?: number; vencimento?: string };
function parseDuplicatas(v: unknown): DuplicataOut[] {
  if (!Array.isArray(v)) return [];
  const out: DuplicataOut[] = [];
  for (const it of v.slice(0, 100)) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const d: DuplicataOut = {};
    const num = str(o.numero); if (num) d.numero = num;
    const val = parseNum(o.valor); if (val != null) d.valor = val;
    const venc = typeof o.vencimento === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.vencimento) ? o.vencimento : null;
    if (venc) d.vencimento = venc;
    if (Object.keys(d).length) out.push(d);
  }
  return out;
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if ((req.method || "GET") !== "POST") { res.status(405).json({ error: "Use POST." }); return; }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (req.body || {}) as {
    data?: string; mediaType?: string; tipo?: string;
    files?: Array<{ data?: string; mediaType?: string }>;
  };
  const isBoleto = body.tipo === "boleto";
  const isFechamento = body.tipo === "fechamento";
  const isComanda = body.tipo === "comanda";

  // Aceita 1 arquivo (data/mediaType) OU vários (files[]) — notas de várias páginas.
  const arquivos: Array<{ data: string; mediaType: string }> = [];
  if (Array.isArray(body.files) && body.files.length) {
    for (const f of body.files) {
      if (f && typeof f.data === "string" && f.data) arquivos.push({ data: f.data, mediaType: String(f.mediaType || "image/jpeg") });
    }
  } else if (typeof body.data === "string" && body.data) {
    arquivos.push({ data: body.data, mediaType: String(body.mediaType || "image/jpeg") });
  }
  if (!arquivos.length) { res.status(400).json({ error: "Falta o arquivo (data base64)." }); return; }

  const blocks = arquivos.map((a) => a.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
    : { type: "image", source: { type: "base64", media_type: a.mediaType || "image/jpeg", data: a.data } });

  const payload = {
    model: MODEL,
    max_tokens: 8000, // notas grandes (ex: Heineken, 6 páginas) têm muitos itens
    messages: [{ role: "user", content: [...blocks, { type: "text", text: isComanda ? PROMPT_COMANDA : isFechamento ? PROMPT_FECHAMENTO : isBoleto ? PROMPT_BOLETO : PROMPT }] }],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
    const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) { res.status(200).json({ emissor: null, valorTotal: null, dataEmissao: null, itens: [], duplicatas: [], _raw: textOut.slice(0, 200) }); return; }
    let p: Record<string, unknown> = {};
    try { p = JSON.parse(m[0]) as Record<string, unknown>; } catch { /* devolve vazio abaixo */ }
    if (isComanda) {
      const numeros = Array.isArray(p.numeros) ? p.numeros.map((x) => digits(x)).filter((x): x is string => !!x).slice(0, 50) : [];
      res.status(200).json({ numeros });
      return;
    }
    if (isFechamento) {
      const maquininhas = Array.isArray(p.maquininhas) ? p.maquininhas.slice(0, 30).map((m) => {
        if (!m || typeof m !== "object") return null;
        const o = m as Record<string, unknown>;
        const out: { identificador?: string; credito?: number; debito?: number; total?: number } = {};
        const id = str(o.identificador); if (id) out.identificador = id;
        const cr = parseNum(o.credito); if (cr != null) out.credito = cr;
        const de = parseNum(o.debito); if (de != null) out.debito = de;
        const to = parseNum(o.total); if (to != null) out.total = to;
        return Object.keys(out).length ? out : null;
      }).filter(Boolean) : [];
      const turno = p.turno === "almoco" || p.turno === "jantar" ? p.turno : null;
      res.status(200).json({
        data: typeof p.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.data) ? p.data : null,
        turno,
        totalVendas: parseNum(p.totalVendas) ?? null,
        dinheiro: parseNum(p.dinheiro) ?? null,
        pix: parseNum(p.pix) ?? null,
        credito: parseNum(p.credito) ?? null,
        debito: parseNum(p.debito) ?? null,
        maquininhas,
      });
      return;
    }
    if (isBoleto) {
      res.status(200).json({ emissor: str(p.emissor), duplicatas: parseDuplicatas(p.duplicatas) });
      return;
    }
    res.status(200).json({
      emissor: str(p.emissor),
      cnpjEmissor: digits(p.cnpjEmissor),
      numeroNota: str(p.numeroNota) ?? (parseNum(p.numeroNota) != null ? String(parseNum(p.numeroNota)) : null),
      serieNota: str(p.serieNota) ?? (parseNum(p.serieNota) != null ? String(parseNum(p.serieNota)) : null),
      chaveAcesso: digits(p.chaveAcesso),
      valorProdutos: parseNum(p.valorProdutos) ?? null,
      valorTotal: parseNum(p.valorTotal) ?? null,
      valorImpostos: parseNum(p.valorImpostos) ?? null,
      dataEmissao: typeof p.dataEmissao === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.dataEmissao) ? p.dataEmissao : null,
      itens: parseItens(p.itens),
      duplicatas: parseDuplicatas(p.duplicatas),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") { res.status(504).json({ error: "Timeout lendo a nota." }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : "Erro ao ler a nota." });
  } finally {
    clearTimeout(timer);
  }
}

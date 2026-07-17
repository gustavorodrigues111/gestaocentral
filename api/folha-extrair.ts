// ════════════════════════════════════════════════════════════════════════════
//  /api/folha-extrair — lê um ESPELHO de folha/adiantamento (SCI/Senador) em PDF
//  e devolve JSON estruturado por colaborador. NÃO confere nada e NÃO grava — o
//  motor de regras (código puro no cliente) faz a conferência. Exige Firebase
//  ID token. Chave em ANTHROPIC_API_KEY.
//
//  POST { pdfUrl, tipo?: "folha"|"adiantamento" } → { espelho: FolhaEspelho }
//
//  IMPORTANTE: o cliente DEVE validar Σ líquidos contra o RESUMO GERAL antes de
//  confiar — o parser pode errar em layout atípico (Bloco A cobre isso).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 120 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 115_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const PROMPT =
  "Você recebe o ESPELHO de folha de pagamento (ou de adiantamento salarial) de um restaurante, emitido pelo sistema SCI/Senador (SENADOR ORGANIZAÇÃO CONTÁBIL). " +
  "Extraia os dados de forma FIEL, sem recalcular nada. NÃO some, NÃO confira — só transcreva o que está impresso.\n\n" +
  "LAYOUT (importante):\n" +
  "- É um relatório de DUAS COLUNAS: PROVENTOS à ESQUERDA, DESCONTOS à DIREITA. Uma mesma linha de texto pode conter UM provento (esquerda) E UM desconto (direita) ao mesmo tempo — separe pela coluna. Ex.: 'Adiantamento salarial com IR' (20504) é PROVENTO; 'Ad. sal. Créd. Trabalhador com IR' (20904), 'IR adiantamento' (91555) são DESCONTOS.\n" +
  "- Em cada verba, o VALOR vem ANTES da descrição e o CÓDIGO vem DEPOIS (ex.: '1.040,00Adiantamento salarial com IR20504'). A descrição pode QUEBRAR em várias linhas antes do código (ex.: 'Arredondamento provento adiant.' / 'salarial' / '90011'). Reagrupe por CÓDIGO, não por linha.\n" +
  "- O NOME do colaborador pode quebrar em 2 linhas — junte.\n" +
  "- Cada colaborador imprime 'Total de proventos ->', 'Total de descontos ->' e 'Líquido ->'. EXTRAIA esses três como totalProventos, totalDescontos e liquido (são a verdade impressa).\n" +
  "- O RESUMO GERAL / 'Total Geral' fica na ÚLTIMA página, com Quantidade, Proventos, Descontos, Líquido totais e o bloco Previdenciários (GPS).\n\n" +
  "Para CADA colaborador, extraia: matricula (número antes do nome), nome, cpf (só dígitos), ctps, cbo, funcao, admissao (YYYY-MM-DD), salarioBase (número), horasMensais, temSalarioFamilia (bool), temIR (bool), " +
  "situacao ({tipo: 'normal'|'ferias'|'demitido'|'afastado', inicio?, fim?} — 'demitido' se houver bloco de rescisão, 'ferias' se houver bloco/demonstrativo de férias, 'afastado' se acidente/auxílio-doença), " +
  "multiplosVinculos (bool — true se marcar 'múltiplos vínculos'), " +
  "proventos e descontos como listas de {codigo, descricao, referencia?, valor} (valor SEMPRE número com ponto decimal; 'referencia' é o número de qtd/% que às vezes aparece, ex.: '27,50' ou '2/36'), " +
  "totalProventos, totalDescontos, liquido (números impressos), bases ({inss, fgts, irrf, salarioFamilia} — números quando impressos).\n\n" +
  "Extraia também no topo: empresa (razão social), competencia ('YYYY-MM'), tipo ('folha' ou 'adiantamento' — o cabeçalho diz 'adiantamento salarial' quando é adiantamento), " +
  "resumoGeral ({liquido, totalProventos, totalDescontos} — da última página), e gps (valor de 'GPS' / 'Total DARF previdenciário', 0 se não houver).\n\n" +
  "Responda SOMENTE um objeto JSON válido (sem texto antes/depois), no formato: " +
  "{ \"empresa\": \"...\", \"competencia\": \"YYYY-MM\", \"tipo\": \"folha\", \"resumoGeral\": {\"liquido\": 0, \"totalProventos\": 0, \"totalDescontos\": 0}, \"gps\": 0, " +
  "\"colaboradores\": [ { \"matricula\": \"\", \"nome\": \"\", \"cpf\": \"\", \"situacao\": {\"tipo\":\"normal\"}, " +
  "\"proventos\": [{\"codigo\":\"\",\"descricao\":\"\",\"valor\":0}], \"descontos\": [{\"codigo\":\"\",\"descricao\":\"\",\"valor\":0}], \"totalProventos\": 0, \"totalDescontos\": 0, \"liquido\": 0, \"bases\": {} } ] }";

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { pdfUrl?: string; tipo?: string } | null;
  const pdfUrl = (body?.pdfUrl || "").toString();
  const tipoHint = (body?.tipo || "").toString();
  if (!/^https?:\/\//.test(pdfUrl)) { res.status(400).json({ error: "pdfUrl inválida." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const fr = await fetch(pdfUrl, { signal: ctrl.signal });
    if (!fr.ok) { res.status(502).json({ error: `Não consegui baixar o PDF (HTTP ${fr.status}).` }); return; }
    const buf = Buffer.from(await fr.arrayBuffer());
    if (buf.length > 30 * 1024 * 1024) { res.status(413).json({ error: "PDF muito grande (máx 30MB)." }); return; }
    const b64 = buf.toString("base64");

    const prompt = tipoHint ? `${PROMPT}\n\nDICA: este arquivo é do tipo "${tipoHint}".` : PROMPT;
    const payload = {
      model: MODEL,
      max_tokens: 32000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
        { type: "text", text: prompt },
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
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;

    // Normalização defensiva: garante arrays e números, CPF só dígitos.
    const cols = Array.isArray(parsed.colaboradores) ? parsed.colaboradores : [];
    const espelho = {
      empresa: str(parsed.empresa),
      competencia: str(parsed.competencia),
      tipo: (tipoHint === "adiantamento" || parsed.tipo === "adiantamento") ? "adiantamento" : "folha",
      resumoGeral: obj(parsed.resumoGeral),
      gps: num(parsed.gps),
      colaboradores: cols.map((c) => normColab(c as Record<string, unknown>)).filter((c) => c.cpf || c.nome),
    };
    res.status(200).json({ espelho });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) na leitura.` : (e instanceof Error ? e.message : "Falha ao processar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function normColab(c: Record<string, unknown>) {
  return {
    matricula: str(c.matricula), nome: str(c.nome), cpf: str(c.cpf).replace(/\D/g, ""),
    ctps: str(c.ctps), cbo: str(c.cbo), funcao: str(c.funcao), admissao: str(c.admissao),
    salarioBase: num(c.salarioBase), horasMensais: num(c.horasMensais),
    temSalarioFamilia: !!c.temSalarioFamilia, temIR: !!c.temIR, multiplosVinculos: !!c.multiplosVinculos,
    situacao: obj(c.situacao),
    proventos: linhas(c.proventos), descontos: linhas(c.descontos),
    totalProventos: num(c.totalProventos), totalDescontos: num(c.totalDescontos),
    liquido: num(c.liquido), bases: obj(c.bases),
  };
}
function linhas(v: unknown): Array<{ codigo: string; descricao: string; referencia?: string; valor: number }> {
  return (Array.isArray(v) ? v : []).map((l) => {
    const o = l as Record<string, unknown>;
    return { codigo: str(o.codigo), descricao: str(o.descricao), referencia: str(o.referencia) || undefined, valor: num(o.valor) };
  });
}
const str = (v: unknown) => (v == null ? "" : String(v)).trim();
const num = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  // "1.234,56" (BR) → 1234.56 ; senão assume decimal com ponto ("1043.48").
  const ehBr = /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s);
  const n = ehBr ? parseFloat(s.replace(/\./g, "").replace(",", ".")) : parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, unknown>) : undefined;
function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

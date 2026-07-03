// ════════════════════════════════════════════════════════════════════════════
//  /api/importar-fichas — lê o texto de uma planilha de fichas técnicas e
//  devolve fichas/subfichas/ingredientes estruturados via Claude. NÃO grava
//  nada; a gravação (e o casamento com insumos existentes) é feita no cliente,
//  na tela de revisão. Exige Firebase ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

const PROMPT =
  "Você recebe uma ou mais FICHAS TÉCNICAS de um restaurante (produção de pratos, drinques e preparos-" +
  "base), em português. A fonte pode ser: o TEXTO de uma planilha (abaixo, células separadas por ' | ' e " +
  "abas marcadas com '=== Aba: NOME ==='), e/ou uma IMAGEM/PDF anexado (foto, print ou até manuscrito). " +
  "Se for imagem/manuscrito, leia com atenção; se um número estiver ilegível, use 0 (não invente).\n\n" +
  "Estruture em JSON. Regras IMPORTANTES:\n" +
  "1) NÚMEROS estão em formato brasileiro: a VÍRGULA é separador DECIMAL (ex: '2,777' = 2.777; " +
  "'0,630' = 0.63; '4,000' = 4). Converta para número com ponto decimal.\n" +
  "2) UNIDADES: normalize para exatamente uma destas: 'kg','g','L','ml','un','porção','fatia','dose'. " +
  "Mapeie KG→kg, G→g, LT/L/LITRO→L, ML→ml, UN/UND/UNID→un, PORÇÃO/PORÇÕES→porção, FATIA→fatia, DOSE→dose. " +
  "Se não reconhecer, use a mais próxima entre kg/g/L/ml/un.\n" +
  "3) ESTRUTURA: a fonte tem BLOCOS. Um bloco começa numa linha 'Preparo' cujo valor ao lado é o NOME do " +
  "preparo, seguida por uma linha 'Rendimento' (quantidade + unidade) e depois uma tabela com colunas " +
  "'Ingrediente | Quantidade | Unidade'.\n" +
  "4) Cada bloco 'Preparo' vira UMA receita (uma 'ficha' na saída), com a lista PLANA de ingredientes dele.\n" +
  "5) 'ehSubficha': marque TRUE se o preparo é uma BASE/componente reutilizável (nome começa com 'Base de', " +
  "'Molho', 'Massa', 'Caldo', 'Recheio', etc, ou a unidade de rendimento é kg/L). Marque FALSE se é um prato/" +
  "drinque final servido (rendimento em porções/un/dose). Na dúvida, use true.\n" +
  "6) 'categoria': se der pra inferir uma categoria do cardápio (ex: 'Molhos', 'Massas', 'Drinks', 'Pratos " +
  "principais', 'Entradas'), coloque; senão deixe \"\".\n" +
  "7) Ingredientes 'q.b.', 'a gosto', 'quanto baste' → qb:true e qtd:0.\n" +
  "8) NOMES: corrija erros óbvios de digitação e padronize o nome canônico de cada ingrediente e da " +
  "receita (ex: 'paprica pikante' → 'PÁPRICA PICANTE'). Se o MESMO ingrediente aparecer escrito de formas " +
  "ligeiramente diferentes, use a MESMA grafia em todas. Escreva TODOS os nomes (receita e ingredientes) " +
  "100% EM MAIÚSCULAS.\n" +
  "9) INSUMO PRINCIPAL x VARIAÇÃO: quando um ingrediente é uma FORMA PREPARADA de um insumo, separe: " +
  "'insumoPrincipal' = o insumo base (ex: 'PIMENTA DE CHEIRO', 'PIMENTÃO VERDE', 'CEBOLA BRANCA'), e " +
  "'variacao' = a forma de preparo (ex: 'PICADA', 'TOSTADA', 'EM CUBOS', 'ASSADO SEM PELE'). Se o " +
  "ingrediente já é o insumo inteiro/cru, use insumoPrincipal = o próprio nome e variacao = \"\". Agrupe " +
  "sob o MESMO insumoPrincipal todas as formas do mesmo insumo.\n\n" +
  "Responda SOMENTE um objeto JSON (sem texto antes/depois), neste formato:\n" +
  '{ "fichas": [ { "nome": "...", "ehSubficha": true, "categoria": "", ' +
  '"rendimento": { "qtd": 0, "unidade": "kg" }, ' +
  '"ingredientes": [ { "nome": "...", "qtd": 0, "unidade": "g", "qb": false, "insumoPrincipal": "...", "variacao": "" } ] } ] }\n\n' +
  "PLANILHA:\n";

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as
    { planilha?: string; anexos?: Array<{ data?: string; mediaType?: string }> } | null;
  const planilha = (body?.planilha || "").toString().slice(0, 60_000); // corta planilhas gigantes
  const anexos = Array.isArray(body?.anexos)
    ? body!.anexos.filter((a) => a && typeof a.data === "string" && a.data).slice(0, 8)
    : [];
  if (!planilha.trim() && anexos.length === 0) { res.status(400).json({ error: "Nada pra importar (sem planilha nem anexo)." }); return; }

  const blocks = anexos.map((a) => a.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
    : { type: "image", source: { type: "base64", media_type: a.mediaType || "image/jpeg", data: a.data } });
  const textoFinal = planilha.trim() ? planilha : "(a receita está na imagem/PDF anexado acima)";

  const payload = {
    model: MODEL,
    max_tokens: 12000,
    messages: [{ role: "user", content: [...blocks, { type: "text", text: PROMPT + textoFinal }] }],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
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
    const parsed = JSON.parse(m[0]) as { fichas?: unknown };
    const fichas = Array.isArray(parsed.fichas) ? parsed.fichas : [];
    res.status(200).json({ fichas });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) na leitura da planilha.` : (e instanceof Error ? e.message : "Falha ao processar.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

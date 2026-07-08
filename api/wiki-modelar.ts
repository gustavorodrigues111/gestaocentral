// ════════════════════════════════════════════════════════════════════════════
//  /api/wiki-modelar — recebe a TRANSCRIÇÃO de alguém explicando um processo
//  (falado, informal) e o Claude MODELA num rascunho estruturado de processo da
//  Wiki: título, área, resumo, formato (texto/checklist/passos) e o conteúdo.
//  NÃO grava nada — o rascunho volta pro form pra revisão humana. Exige Firebase
//  ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function montarPrompt(transcricao: string, areas: string[], setores: { id: string; label: string }[]): string {
  const listaAreas = areas.length
    ? "Áreas já existentes na wiki (reutilize uma EXATAMENTE se couber, senão proponha uma nova curta): " + JSON.stringify(areas) + ".\n"
    : "Ainda não há áreas cadastradas — proponha uma área curta (ex: Cozinha, Salão, DP, Financeiro, Recebimento).\n";
  const blocoSetores = setores.length
    ? "8) Para CADA passo/item, SUGIRA o(s) setor(es) responsável(is) em `responsaveis` (array de ids), escolhendo desta lista: " + JSON.stringify(setores) + ". Use o id (não o label). Pode ser mais de um. Se não der pra inferir com confiança, deixe [].\n"
    : "8) responsaveis = [] (sem setores cadastrados).\n";
  return (
    "Você recebe a TRANSCRIÇÃO de uma pessoa EXPLICANDO EM VOZ ALTA, de forma informal, um processo interno de um restaurante (a fala foi ditada, pode ter repetição, 'né', 'aí', hesitação, ordem bagunçada). " +
    "Sua tarefa é MODELAR isso num processo bem estruturado pra Wiki de Processos da empresa, pronto pra um humano revisar. Escreva em português do Brasil, claro e prático.\n\n" +
    "REGRAS:\n" +
    "1) titulo = um título curto e objetivo do processo (ex: 'Abertura da casa', 'Fechamento de caixa do turno').\n" +
    "2) area = a área/setor. " + listaAreas +
    "3) resumo = uma frase dizendo do que se trata.\n" +
    "4) formato = escolha o MELHOR entre:\n" +
    "   - \"passos\": quando é uma sequência de etapas a executar em ordem (o mais comum pra 'como fazer'). Cada passo com titulo curto (opcional) + descricao.\n" +
    "   - \"checklist\": quando é uma lista de itens a conferir/marcar, sem ordem obrigatória forte.\n" +
    "   - \"texto\": quando é uma explicação corrida (política, conceito, orientação) que não vira lista.\n" +
    "5) Preencha SÓ o campo do formato escolhido: se \"passos\", preencha passos[]; se \"checklist\", preencha itens[]; se \"texto\", preencha conteudo.\n" +
    "6) Limpe a fala: tire vícios de linguagem, organize na ordem lógica, corrija concordância. NÃO invente etapas que a pessoa não falou, mas pode deixar mais claro o que ela disse.\n" +
    "7) Se a transcrição estiver vazia ou não descrever um processo, retorne titulo curto do que deu pra entender e conteudo com o texto limpo, formato \"texto\".\n" +
    blocoSetores + "\n" +
    "TRANSCRIÇÃO:\n\"\"\"\n" + transcricao + "\n\"\"\"\n\n" +
    "Responda SOMENTE um objeto JSON (sem texto antes/depois): " +
    "{ \"titulo\": \"...\", \"area\": \"...\", \"resumo\": \"...\", \"formato\": \"passos\"|\"checklist\"|\"texto\", " +
    "\"conteudo\": \"<só se texto, senão \\\"\\\">\", " +
    "\"itens\": [ { \"texto\": \"...\", \"responsaveis\": [\"<setorId>\"] } ], " +
    "\"passos\": [ { \"titulo\": \"<curto, pode ser vazio>\", \"descricao\": \"...\", \"responsaveis\": [\"<setorId>\"] } ] }"
  );
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { transcricao?: string; areas?: string[]; setores?: { id?: string; label?: string }[] } | null;
  const transcricao = (body?.transcricao || "").toString().trim().slice(0, 12000);
  if (transcricao.length < 3) { res.status(400).json({ error: "Transcrição vazia." }); return; }
  const areas = Array.isArray(body?.areas) ? body!.areas.filter((a): a is string => typeof a === "string" && !!a.trim()).map((a) => a.trim()).slice(0, 40) : [];
  const setores = Array.isArray(body?.setores) ? body!.setores.filter((s) => s && typeof s.id === "string").map((s) => ({ id: String(s.id).slice(0, 40), label: String(s.label || s.id).slice(0, 60) })).slice(0, 20) : [];
  const setorIds = new Set(setores.map((s) => s.id));
  const limpaResp = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && setorIds.has(x)) : [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = {
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: [{ type: "text", text: montarPrompt(transcricao, areas, setores) }] }],
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
    const parsed = JSON.parse(m[0]) as { titulo?: string; area?: string; resumo?: string; formato?: string; conteudo?: string; itens?: unknown; passos?: unknown };
    const formato = parsed.formato === "checklist" || parsed.formato === "passos" ? parsed.formato : "texto";
    // itens aceita string legado OU objeto {texto, responsaveis}
    const itens = Array.isArray(parsed.itens)
      ? parsed.itens.map((x) => typeof x === "string" ? { texto: x.trim(), responsaveis: [] as string[] } : (x && typeof x === "object" ? { texto: String((x as { texto?: string }).texto || "").trim(), responsaveis: limpaResp((x as { responsaveis?: unknown }).responsaveis) } : null))
          .filter((x): x is { texto: string; responsaveis: string[] } => !!x && !!x.texto).slice(0, 60)
      : [];
    const passos = Array.isArray(parsed.passos)
      ? parsed.passos
          .filter((p): p is { titulo?: string; descricao?: string; responsaveis?: unknown } => !!p && typeof p === "object")
          .map((p) => ({ titulo: String(p.titulo || "").trim(), descricao: String(p.descricao || "").trim(), responsaveis: limpaResp(p.responsaveis) }))
          .filter((p) => p.descricao)
          .slice(0, 60)
      : [];
    res.status(200).json({
      titulo: String(parsed.titulo || "").trim().slice(0, 200),
      area: String(parsed.area || "").trim().slice(0, 80),
      resumo: String(parsed.resumo || "").trim().slice(0, 300),
      formato, conteudo: String(parsed.conteudo || "").trim(), itens, passos,
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao modelar.` : (e instanceof Error ? e.message : "Falha ao modelar o processo.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

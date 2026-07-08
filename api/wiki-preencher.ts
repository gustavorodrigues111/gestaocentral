// ════════════════════════════════════════════════════════════════════════════
//  /api/wiki-preencher — dado o TÍTULO + ÁREA de um processo (tipicamente um
//  rascunho vazio), a IA propõe um RASCUNHO de conteúdo (passo a passo padrão)
//  pra um humano REVISAR. Diferente do modelar (que parte de uma fala): aqui a
//  IA pode propor as etapas típicas do processo. NÃO grava. Firebase ID token.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function montarPrompt(titulo: string, area: string, setores: { id: string; label: string }[]): string {
  const blocoSetores = setores.length
    ? "Para CADA passo/item, sugira o(s) setor(es) responsável(is) em `responsaveis` (array de ids) desta lista: " + JSON.stringify(setores) + ". Use o id. Pode ser mais de um; [] se não der pra inferir.\n"
    : "responsaveis = [] (sem setores cadastrados).\n";
  return (
    "Você é especialista em operação de restaurantes. Monte um RASCUNHO de processo interno pra a Wiki da empresa, a partir do título e da área abaixo. " +
    "É um rascunho pra um humano REVISAR e ajustar — proponha as etapas TÍPICAS e boas práticas desse processo num restaurante, de forma clara e prática, em português do Brasil.\n\n" +
    `TÍTULO: ${titulo}\nÁREA: ${area || "—"}\n\n` +
    "REGRAS:\n" +
    "1) Escolha o melhor formato: \"passos\" (sequência de etapas — o mais comum), \"checklist\" (itens a conferir) ou \"texto\" (explicação corrida).\n" +
    "2) Preencha só o campo do formato escolhido.\n" +
    "3) resumo = 1 frase do que trata.\n" +
    "4) Seja realista e conciso: 4 a 10 passos costuma bastar. Não invente detalhes muito específicos da empresa (nomes, valores) — deixe genérico pra o humano completar.\n" +
    "5) " + blocoSetores + "\n" +
    "Responda SOMENTE JSON: { \"resumo\": \"...\", \"formato\": \"passos\"|\"checklist\"|\"texto\", \"conteudo\": \"<só se texto>\", " +
    "\"itens\": [ { \"texto\": \"...\", \"responsaveis\": [\"<setorId>\"] } ], " +
    "\"passos\": [ { \"titulo\": \"<curto>\", \"descricao\": \"...\", \"responsaveis\": [\"<setorId>\"] } ] }"
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

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { titulo?: string; area?: string; setores?: { id?: string; label?: string }[] } | null;
  const titulo = (body?.titulo || "").toString().trim().slice(0, 200);
  const area = (body?.area || "").toString().trim().slice(0, 80);
  if (titulo.length < 2) { res.status(400).json({ error: "Título vazio." }); return; }
  const setores = Array.isArray(body?.setores) ? body!.setores.filter((s) => s && typeof s.id === "string").map((s) => ({ id: String(s.id).slice(0, 40), label: String(s.label || s.id).slice(0, 60) })).slice(0, 20) : [];
  const setorIds = new Set(setores.map((s) => s.id));
  const limpaResp = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && setorIds.has(x)) : [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = { model: MODEL, max_tokens: 4000, thinking: { type: "adaptive" }, messages: [{ role: "user", content: [{ type: "text", text: montarPrompt(titulo, area, setores) }] }] };
    const resp = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
    const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) { res.status(502).json({ error: "A IA não retornou JSON." }); return; }
    const parsed = JSON.parse(m[0]) as { resumo?: string; formato?: string; conteudo?: string; itens?: unknown; passos?: unknown };
    const formato = parsed.formato === "checklist" || parsed.formato === "passos" ? parsed.formato : "texto";
    const itens = Array.isArray(parsed.itens)
      ? parsed.itens.map((x) => typeof x === "string" ? { texto: x.trim(), responsaveis: [] as string[] } : (x && typeof x === "object" ? { texto: String((x as { texto?: string }).texto || "").trim(), responsaveis: limpaResp((x as { responsaveis?: unknown }).responsaveis) } : null))
          .filter((x): x is { texto: string; responsaveis: string[] } => !!x && !!x.texto).slice(0, 60)
      : [];
    const passos = Array.isArray(parsed.passos)
      ? parsed.passos.filter((p): p is { titulo?: string; descricao?: string; responsaveis?: unknown } => !!p && typeof p === "object")
          .map((p) => ({ titulo: String(p.titulo || "").trim(), descricao: String(p.descricao || "").trim(), responsaveis: limpaResp(p.responsaveis) }))
          .filter((p) => p.descricao).slice(0, 60)
      : [];
    res.status(200).json({ resumo: String(parsed.resumo || "").trim().slice(0, 300), formato, conteudo: String(parsed.conteudo || "").trim(), itens, passos });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao preencher.` : (e instanceof Error ? e.message : "Falha ao preencher o processo.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

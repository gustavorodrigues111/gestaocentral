// ════════════════════════════════════════════════════════════════════════════
//  /api/wiki-editar-voz — edição de um processo EXISTENTE da Wiki por instrução
//  falada. Recebe o processo atual (estruturado) + a instrução ("adiciona um
//  passo…", "tira o item sobre…", "muda o passo 2 pra…") e o Claude devolve o
//  processo ATUALIZADO no mesmo formato + um resumo do que mudou. NÃO grava —
//  o resultado volta pro editor pra revisão humana. Exige Firebase ID token.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

type ProcIn = {
  titulo?: string; area?: string; resumo?: string; formato?: string; conteudo?: string;
  itens?: { id?: string; texto?: string }[]; passos?: { id?: string; titulo?: string; descricao?: string }[];
};

function montarPrompt(instrucao: string, proc: ProcIn): string {
  return (
    "Você mantém a WIKI DE PROCESSOS de um restaurante. Abaixo está UM processo já documentado (em JSON) e uma INSTRUÇÃO falada de alguém pedindo pra editar esse processo. " +
    "Aplique EXATAMENTE o que a instrução pede — pode ser ADICIONAR informação nova, REMOVER algo errado, ALTERAR/CORRIGIR um trecho, reordenar, ou mudar o formato se fizer sentido. Devolva o processo ATUALIZADO no mesmo esquema.\n\n" +
    "REGRAS:\n" +
    "1) Mexa SÓ no que a instrução pede. Todo o resto do processo deve permanecer IDÊNTICO (mesmos textos, mesma ordem, mesmos ids).\n" +
    "2) PRESERVE o campo `id` de cada item/passo que continuar existindo (mesmo que você reordene). Itens/passos NOVOS: deixe `id` vazio (\"\") que o sistema gera.\n" +
    "3) `formato` continua o mesmo, a menos que a instrução peça pra mudar. Se mudar, converta o conteúdo pro novo formato de forma coerente.\n" +
    "4) Preencha só o campo do formato final: `conteudo` se \"texto\"; `itens` se \"checklist\"; `passos` se \"passos\". Os outros vazios.\n" +
    "5) NÃO invente informação que a instrução não deu. Escreva em português do Brasil, claro.\n" +
    "6) Em `resumoMudancas`, liste em 1-4 bullets curtos o que você mudou (ex: '+ passo: fechar o gás', '- item duplicado sobre estoque', '~ corrigido horário no passo 2'). Se a instrução não pedir nada aplicável, devolva o processo inalterado e diga isso em resumoMudancas.\n\n" +
    "PROCESSO ATUAL (JSON):\n" + JSON.stringify({
      titulo: proc.titulo || "", area: proc.area || "", resumo: proc.resumo || "", formato: proc.formato || "texto",
      conteudo: proc.conteudo || "", itens: proc.itens || [], passos: proc.passos || [],
    }) + "\n\n" +
    "INSTRUÇÃO FALADA:\n\"\"\"\n" + instrucao + "\n\"\"\"\n\n" +
    "Responda SOMENTE um objeto JSON (sem texto antes/depois): " +
    "{ \"titulo\": \"...\", \"area\": \"...\", \"resumo\": \"...\", \"formato\": \"passos\"|\"checklist\"|\"texto\", " +
    "\"conteudo\": \"...\", \"itens\": [ { \"id\": \"<id existente ou vazio>\", \"texto\": \"...\" } ], " +
    "\"passos\": [ { \"id\": \"<id existente ou vazio>\", \"titulo\": \"...\", \"descricao\": \"...\" } ], " +
    "\"resumoMudancas\": [ \"...\", ... ] }"
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

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { instrucao?: string; processo?: ProcIn } | null;
  const instrucao = (body?.instrucao || "").toString().trim().slice(0, 4000);
  const proc = body?.processo || {};
  if (instrucao.length < 3) { res.status(400).json({ error: "Instrução vazia." }); return; }
  if (!proc.titulo) { res.status(400).json({ error: "Processo inválido." }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = {
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: [{ type: "text", text: montarPrompt(instrucao, proc) }] }],
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
    const parsed = JSON.parse(m[0]) as ProcIn & { resumoMudancas?: unknown };
    const formato = parsed.formato === "checklist" || parsed.formato === "passos" ? parsed.formato : "texto";
    const itens = Array.isArray(parsed.itens)
      ? parsed.itens.filter((i): i is { id?: string; texto?: string } => !!i && typeof i === "object" && !!String(i.texto || "").trim())
          .map((i) => ({ id: String(i.id || "").trim(), texto: String(i.texto || "").trim() })).slice(0, 80)
      : [];
    const passos = Array.isArray(parsed.passos)
      ? parsed.passos.filter((p): p is { id?: string; titulo?: string; descricao?: string } => !!p && typeof p === "object" && !!String(p.descricao || "").trim())
          .map((p) => ({ id: String(p.id || "").trim(), titulo: String(p.titulo || "").trim(), descricao: String(p.descricao || "").trim() })).slice(0, 80)
      : [];
    const resumoMudancas = Array.isArray(parsed.resumoMudancas)
      ? parsed.resumoMudancas.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, 8)
      : [];
    res.status(200).json({
      titulo: String(parsed.titulo || proc.titulo || "").trim().slice(0, 200),
      area: String(parsed.area || proc.area || "").trim().slice(0, 80),
      resumo: String(parsed.resumo || "").trim().slice(0, 300),
      formato, conteudo: String(parsed.conteudo || "").trim(), itens, passos, resumoMudancas,
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao editar.` : (e instanceof Error ? e.message : "Falha ao editar o processo.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

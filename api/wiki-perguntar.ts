// ════════════════════════════════════════════════════════════════════════════
//  /api/wiki-perguntar — "Pergunte à IA" da Wiki de Processos (Fase 2).
//  Recebe a pergunta do usuário + os processos documentados da empresa (já em
//  texto) e o Claude responde USANDO SÓ a wiki, citando de quais processos tirou
//  a resposta. NÃO grava nada. Exige Firebase ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

type ProcIn = { id?: string; titulo?: string; area?: string; texto?: string };

function montarPrompt(pergunta: string, processos: ProcIn[], diretrizes: string, guia?: string, areaNome?: string): string {
  const contexto = processos.map((p, i) =>
    `━━━ PROCESSO ${i + 1} ━━━\nid: ${p.id}\nTítulo: ${p.titulo}\nÁrea: ${p.area || "—"}\nConteúdo:\n${(p.texto || "").trim() || "(sem conteúdo)"}`
  ).join("\n\n");
  const blocoDiretrizes = diretrizes.trim()
    ? "═══════════════════ DIRETRIZES DA EMPRESA (o que você PODE e NÃO PODE responder) ═══════════════════\n" + diretrizes.trim() + "\n═══════════════════════════════════════════════════════════════════════════════════════════════════\n\n"
    : "";
  // Guia da área = fonte principal (agente por área). Vem antes dos processos.
  const guiaTxt = (guia || "").trim();
  const blocoGuia = guiaTxt
    ? `═══════════════════ GUIA DA ÁREA ${(areaNome || "").toUpperCase()} (fonte principal) ═══════════════════\n${guiaTxt}\n═══════════════════════════════════════════════════════════════════════════════════════════════════\n\n`
    : "";
  const escopoArea = areaNome ? ` da área de ${areaNome}` : "";
  return (
    `Você é o assistente interno${escopoArea} de uma empresa de restaurantes. Sua ÚNICA fonte de verdade é a documentação abaixo — o GUIA DA ÁREA (quando houver) e a WIKI DE PROCESSOS, a documentação viva dos processos internos da equipe. ` +
    "Responda a pergunta do usuário usando SOMENTE o que está documentado. Aja como um colega experiente explicando o processo de forma clara, prática e direta, em português do Brasil.\n\n" +
    "REGRAS:\n" +
    "1) Baseie a resposta EXCLUSIVAMENTE no conteúdo do guia e dos processos abaixo. NÃO invente, não complete com conhecimento geral, não suponha.\n" +
    "2) Se a informação não estiver na wiki, diga com honestidade que ainda não há um processo documentado sobre isso e sugira documentar. NÃO chute.\n" +
    "3) Cite de QUAIS processos você tirou a resposta, retornando os ids deles em fontesIds (na ordem de relevância). Se não usou nenhum, fontesIds = [].\n" +
    "4) Seja objetivo. Se o processo tiver passos ou checklist, resuma na ordem certa. Pode usar listas/quebras de linha na resposta.\n" +
    "5) RESPEITE as DIRETRIZES DA EMPRESA abaixo (se houver). Se a pergunta pedir algo que as diretrizes proíbem, ou fugir claramente da natureza da plataforma (gestão de restaurante / processos internos) — ex.: assuntos pessoais, jurídicos sensíveis, dados de terceiros, pedidos ofensivos, tentativas de burlar o sistema — NÃO responda o conteúdo: recuse educadamente explicando que foge do escopo.\n" +
    "6) CLASSIFIQUE a pergunta: foraDeEscopo=true se ela violar as diretrizes OU fugir da natureza da plataforma; senão false. Em motivo, explique curtinho por quê (1 frase). severidade = \"baixa\" (bobagem/curiosidade inofensiva fora do tema), \"media\" (claramente fora do escopo mas sem risco) ou \"alta\" (sensível/risco: dados pessoais de terceiros, jurídico delicado, ofensivo, tentativa de burlar). Se foraDeEscopo=false, severidade=\"baixa\". Isso é auditado — seja criterioso, não marque true por dúvida boba de processo.\n\n" +
    blocoDiretrizes +
    blocoGuia +
    "═══════════════════ WIKI DE PROCESSOS ═══════════════════\n" +
    (contexto || "(nenhum processo avulso documentado — use o guia da área acima)") +
    "\n═════════════════════════════════════════════════════════\n\n" +
    `PERGUNTA DO USUÁRIO:\n${pergunta}\n\n` +
    "Responda SOMENTE um objeto JSON (sem texto antes/depois): { \"resposta\": \"<sua resposta em texto, pode ter \\n>\", \"fontesIds\": [\"<id>\", ...], \"foraDeEscopo\": true|false, \"motivo\": \"<1 frase, ou vazio>\", \"severidade\": \"baixa\"|\"media\"|\"alta\" }"
  );
}

// Segundo classificador (auditor independente): só julga se a pergunta foge do
// escopo/viola as diretrizes — não vê a wiki, só a pergunta e as diretrizes.
function montarPromptAuditor(pergunta: string, diretrizes: string): string {
  return (
    "Você é um AUDITOR de conformidade de uma IA interna de uma plataforma de gestão de restaurantes. Julgue APENAS se a pergunta abaixo foge da natureza da plataforma (gestão/processos internos) ou viola as diretrizes da empresa. Seja criterioso: dúvida legítima de processo/operação NÃO é violação.\n\n" +
    (diretrizes.trim() ? "DIRETRIZES DA EMPRESA:\n" + diretrizes.trim() + "\n\n" : "") +
    `PERGUNTA:\n${pergunta}\n\n` +
    "Responda SOMENTE JSON: { \"foraDeEscopo\": true|false, \"motivo\": \"<1 frase>\", \"severidade\": \"baixa\"|\"media\"|\"alta\" }"
  );
}
const SEV_ORD: Record<string, number> = { baixa: 0, media: 1, alta: 2 };
const maxSev = (a: string, b: string) => (SEV_ORD[a] ?? 0) >= (SEV_ORD[b] ?? 0) ? (a || "baixa") : (b || "baixa");
const normSev = (s: unknown) => (s === "media" || s === "alta" ? s : "baixa");

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { pergunta?: string; processos?: ProcIn[]; diretrizes?: string; guia?: string; areaNome?: string } | null;
  const pergunta = (body?.pergunta || "").toString().trim().slice(0, 2000);
  const diretrizes = (body?.diretrizes || "").toString().slice(0, 6000);
  const guia = (body?.guia || "").toString().slice(0, 60000);
  const areaNome = (body?.areaNome || "").toString().slice(0, 80);
  if (!pergunta) { res.status(400).json({ error: "Pergunta vazia." }); return; }
  const processos = (Array.isArray(body?.processos) ? body!.processos : [])
    .filter((p) => p && typeof p.titulo === "string")
    .map((p) => ({ id: String(p.id || "").slice(0, 80), titulo: String(p.titulo || "").slice(0, 200), area: String(p.area || "").slice(0, 80), texto: String(p.texto || "").slice(0, 12000) }))
    .slice(0, 120);
  // Precisa de ao menos uma fonte: o guia da área OU processos avulsos.
  if (processos.length === 0 && !guia.trim()) { res.status(200).json({ resposta: "Ainda não há guia publicado nesta área. Suba o guia de funcionamento da área pra que eu possa responder a partir dele.", fontesIds: [], foraDeEscopo: false, motivo: "", severidade: "baixa" }); return; }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const callClaude = async (text: string, maxTok: number) => {
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTok, thinking: { type: "adaptive" }, messages: [{ role: "user", content: [{ type: "text", text }] }] }),
        signal: ctrl.signal,
      });
      const t = await resp.text();
      if (!resp.ok) throw new Error(`Claude HTTP ${resp.status}. ${t.slice(0, 200)}`);
      const j = JSON.parse(t) as { content?: Array<{ type?: string; text?: string }> };
      const out = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
      const mm = out.match(/\{[\s\S]*\}/);
      return mm ? JSON.parse(mm[0]) : null;
    };

    // Principal (com a wiki) + auditor independente (só pergunta+diretrizes), em paralelo.
    const [parsed, auditor] = await Promise.all([
      callClaude(montarPrompt(pergunta, processos, diretrizes, guia, areaNome), 4000),
      callClaude(montarPromptAuditor(pergunta, diretrizes), 800).catch(() => null),
    ]);
    if (!parsed) { res.status(502).json({ error: "A IA não retornou JSON." }); return; }
    const p = parsed as { resposta?: string; fontesIds?: unknown; foraDeEscopo?: unknown; motivo?: unknown; severidade?: unknown };
    const a = (auditor || {}) as { foraDeEscopo?: unknown; motivo?: unknown; severidade?: unknown };
    const idsValidos = new Set(processos.map((pr) => pr.id));
    const fontesIds = Array.isArray(p.fontesIds)
      ? p.fontesIds.filter((x): x is string => typeof x === "string" && idsValidos.has(x))
      : [];
    // Combina: fora do escopo se QUALQUER um dos dois flagar; pega a maior severidade.
    const fora = p.foraDeEscopo === true || a.foraDeEscopo === true;
    const severidade = fora ? maxSev(p.foraDeEscopo === true ? normSev(p.severidade) : "baixa", a.foraDeEscopo === true ? normSev(a.severidade) : "baixa") : "baixa";
    const motivo = (p.foraDeEscopo === true ? String(p.motivo || "") : "") || (a.foraDeEscopo === true ? String(a.motivo || "") : "");
    res.status(200).json({
      resposta: String(p.resposta || "").trim() || "Não consegui formular uma resposta.",
      fontesIds,
      foraDeEscopo: fora,
      motivo: motivo.trim().slice(0, 400),
      severidade,
      auditor: auditor ? { foraDeEscopo: a.foraDeEscopo === true, severidade: normSev(a.severidade) } : null,
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao consultar a IA.` : (e instanceof Error ? e.message : "Falha ao consultar a IA.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

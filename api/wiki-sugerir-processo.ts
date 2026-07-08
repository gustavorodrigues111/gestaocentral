// ════════════════════════════════════════════════════════════════════════════
//  /api/wiki-sugerir-processo — sugere NOVOS processos pra documentar na Wiki,
//  com base no que JÁ existe + nas PERGUNTAS que a equipe fez à IA (sinal de
//  dúvida recorrente / lacuna de documentação). NÃO grava. Firebase ID token.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const REQ_TIMEOUT_MS = 55_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function montarPrompt(existentes: { titulo: string; area: string }[], areas: string[], perguntas: string[]): string {
  const listaProc = existentes.length ? existentes.map((p) => `- ${p.titulo} (${p.area})`).join("\n") : "(nenhum processo documentado ainda)";
  const listaPerg = perguntas.length ? perguntas.map((q) => `- ${q}`).join("\n") : "(sem perguntas registradas ainda)";
  const listaAreas = areas.length ? "Áreas já usadas (reutilize uma se couber): " + JSON.stringify(areas) : "Áreas típicas: Cozinha, Salão, Departamento de Pessoas, Financeiro, Recebimento, Gestão.";
  return (
    "Você ajuda a equipe de um restaurante a decidir QUAIS processos internos ainda faltam documentar na Wiki de Processos. " +
    "Analise o que JÁ está documentado e as PERGUNTAS que a equipe fez à IA interna (cada pergunta é sinal de uma dúvida real; perguntas recorrentes sobre algo não documentado = forte candidato a virar processo).\n\n" +
    "PROCESSOS JÁ DOCUMENTADOS:\n" + listaProc + "\n\n" +
    "PERGUNTAS RECENTES DA EQUIPE À IA:\n" + listaPerg + "\n\n" +
    listaAreas + "\n\n" +
    "Sugira de 3 a 6 NOVOS processos que valem a pena documentar. REGRAS:\n" +
    "1) NÃO repita nada que já está documentado (nem com outro nome).\n" +
    "2) Priorize temas que aparecem nas perguntas da equipe.\n" +
    "3) Se as perguntas não cobrirem, complemente com processos operacionais comuns de restaurante que faltam na lista.\n" +
    "4) titulo curto e objetivo; area = uma das áreas (reutilize as existentes quando fizer sentido); motivo = 1 frase dizendo por que sugeriu (cite se veio de pergunta da equipe).\n\n" +
    "Responda SOMENTE JSON: { \"sugestoes\": [ { \"titulo\": \"...\", \"area\": \"...\", \"motivo\": \"...\" } ] }"
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

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { existentes?: { titulo?: string; area?: string }[]; areas?: string[]; perguntas?: string[] } | null;
  const existentes = (Array.isArray(body?.existentes) ? body!.existentes : []).filter((p) => p && typeof p.titulo === "string").map((p) => ({ titulo: String(p.titulo).slice(0, 160), area: String(p.area || "").slice(0, 80) })).slice(0, 200);
  const areas = (Array.isArray(body?.areas) ? body!.areas : []).filter((a): a is string => typeof a === "string" && !!a.trim()).map((a) => a.trim()).slice(0, 40);
  const perguntas = (Array.isArray(body?.perguntas) ? body!.perguntas : []).filter((q): q is string => typeof q === "string" && !!q.trim()).map((q) => q.trim().slice(0, 300)).slice(0, 120);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const payload = { model: MODEL, max_tokens: 2000, thinking: { type: "adaptive" }, messages: [{ role: "user", content: [{ type: "text", text: montarPrompt(existentes, areas, perguntas) }] }] };
    const resp = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    const txt = await resp.text();
    if (!resp.ok) { res.status(502).json({ error: `Claude retornou HTTP ${resp.status}. ${txt.slice(0, 300)}` }); return; }
    const json = JSON.parse(txt) as { content?: Array<{ type?: string; text?: string }> };
    const textOut = (json.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("");
    const m = textOut.match(/\{[\s\S]*\}/);
    if (!m) { res.status(502).json({ error: "A IA não retornou JSON." }); return; }
    const parsed = JSON.parse(m[0]) as { sugestoes?: Array<{ titulo?: string; area?: string; motivo?: string }> };
    const existSet = new Set(existentes.map((p) => p.titulo.toLowerCase()));
    const sugestoes = (Array.isArray(parsed.sugestoes) ? parsed.sugestoes : [])
      .map((s) => ({ titulo: String(s.titulo || "").trim().slice(0, 160), area: String(s.area || "").trim().slice(0, 80), motivo: String(s.motivo || "").trim().slice(0, 300) }))
      .filter((s) => s.titulo && !existSet.has(s.titulo.toLowerCase()))
      .slice(0, 8);
    res.status(200).json({ sugestoes });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) ao sugerir.` : (e instanceof Error ? e.message : "Falha ao sugerir processos.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

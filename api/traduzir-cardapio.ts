// ════════════════════════════════════════════════════════════════════════════
//  /api/traduzir-cardapio — traduz o cardápio estruturado (PT → EN) via Claude.
//  Recebe { secoes:[{nome,obs?,pratos:[{titulo,subtitulo?}]}] } e devolve a
//  MESMA estrutura/ordem com os campos em inglês (nomeEn, obsEn, tituloEn,
//  subtituloEn). Exige Firebase ID token. Chave em ANTHROPIC_API_KEY.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const REQ_TIMEOUT_MS = 40_000;

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

type PratoIn = { titulo?: string; subtitulo?: string };
type SecaoIn = { nome?: string; obs?: string; pratos?: PratoIn[] };

const PROMPT =
  "Traduza este cardápio de restaurante do português para o INGLÊS (inglês de cardápio: natural, " +
  "conciso e apetitoso, minúsculas como no original). Mantenha SEM traduzir os nomes de ingredientes/" +
  "preparos regionais brasileiros que não têm equivalente direto (ex: tucupi, açaí, cupuaçu, pupunha, " +
  "bacuri, farofa, moqueca, pirão, dorê) — pode manter o termo. Preserve EXATAMENTE a mesma estrutura, " +
  "ordem e quantidade de seções e de pratos. Responda SOMENTE um objeto JSON (sem texto antes ou depois), " +
  "no formato:\n" +
  '{ "secoes": [ { "nomeEn": "...", "obsEn": "...", "pratos": [ { "tituloEn": "...", "subtituloEn": "..." } ] } ] }\n' +
  "Use string vazia quando o campo PT estava vazio. Cardápio (PT):\n";

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  try { await requireUser(req); } catch (e) {
    res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }
  if (req.method !== "POST") { res.status(405).json({ error: "Use POST." }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada nas env vars da Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) as { secoes?: SecaoIn[] } | null;
  const secoes = Array.isArray(body?.secoes) ? body!.secoes : [];
  if (!secoes.length) { res.status(400).json({ error: "Nada pra traduzir (secoes vazio)." }); return; }

  // Só o texto PT (sem ids/preços) pro modelo.
  const ptCompacto = secoes.map((s) => ({
    nome: s.nome || "",
    obs: s.obs || "",
    pratos: (s.pratos || []).map((p) => ({ titulo: p.titulo || "", subtitulo: p.subtitulo || "" })),
  }));

  const payload = {
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: [{ type: "text", text: PROMPT + JSON.stringify(ptCompacto) }] }],
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
    if (!m) { res.status(502).json({ error: "Tradução não retornou JSON." }); return; }
    const parsed = JSON.parse(m[0]) as { secoes?: Array<{ nomeEn?: string; obsEn?: string; pratos?: Array<{ tituloEn?: string; subtituloEn?: string }> }> };
    const out = Array.isArray(parsed.secoes) ? parsed.secoes : [];
    res.status(200).json({ secoes: out });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? `Timeout (${REQ_TIMEOUT_MS / 1000}s) na tradução.` : (e instanceof Error ? e.message : "Falha ao traduzir.");
    res.status(502).json({ error: msg });
  } finally { clearTimeout(timer); }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return null; } }

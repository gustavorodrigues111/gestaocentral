// ════════════════════════════════════════════════════════════════════════════
//  /api/documentos-buscar-ia — assistente de busca da Fábrica de Documentos.
//  Recebe a pergunta do usuário do DP ("quais documentos usar na admissão?",
//  "advertência", "demissão sem justa causa"…) + o catálogo (id, título,
//  categoria, quando_usar, observacoes) e devolve: uma resposta curta + a lista
//  de IDS dos documentos relevantes, pra UI filtrar a lista. Sem estado.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

type DocIn = { id: string; titulo: string; categoria?: string; quando_usar?: string; observacoes?: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    const idToken = String(body.idToken || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
    const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
    if (!idToken || !apiKey) { res.status(401).json({ error: "não autorizado" }); return; }
    const chk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!chk.ok) { res.status(401).json({ error: "sessão inválida" }); return; }

    const pergunta = String(body.pergunta || "").slice(0, 500).trim();
    const docs: DocIn[] = Array.isArray(body.docs) ? body.docs.slice(0, 120) : [];
    if (!pergunta || docs.length === 0) { res.status(200).json({ resposta: "", ids: [] }); return; }

    const system = `Você é assistente do DP (departamento de pessoal) de um grupo de restaurantes. O usuário pergunta em linguagem natural qual documento usar numa situação (admissão, advertência, demissão, férias, benefícios, etc.). Você recebe o CATÁLOGO de documentos disponíveis (id, título, categoria, quando_usar, observacoes) e deve:
1) Selecionar os documentos que se aplicam à situação perguntada — pode ser um ou vários; ordene do mais provável para o menos.
2) Escrever uma "resposta" curta (1 a 3 frases), objetiva, em português do Brasil, explicando o que usar naquele momento. Se a situação envolver uma sequência (ex.: admissão), diga a ordem/lógica em uma frase.
3) Se nada se aplicar, devolva ids vazio e uma resposta dizendo que não encontrou documento para isso.
Responda SÓ com JSON: {"resposta": "...", "ids": ["...","..."]}. Use os ids EXATAMENTE como recebidos; não invente ids nem documentos fora da lista.`;

    const catalogo = docs.map(d => ({ id: d.id, titulo: d.titulo, categoria: d.categoria || "", quando_usar: d.quando_usar || "", observacoes: (d.observacoes || "").slice(0, 300) }));
    const userMsg = `Pergunta do usuário: "${pergunta}"\n\nCatálogo de documentos disponíveis:\n${JSON.stringify(catalogo)}`;

    const payload = {
      model: MODEL, max_tokens: 2000, system,
      messages: [{ role: "user", content: userMsg }],
    };
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
    if (!r.ok) { res.status(502).json({ error: j?.error?.message || "Falha na IA." }); return; }
    const texto = (j.content || []).map((c) => c.text || "").join("");
    const m = texto.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { resposta: "", ids: [] };
    const validos = new Set(docs.map(d => d.id));
    const ids = (Array.isArray(parsed.ids) ? parsed.ids : []).filter((x: unknown) => typeof x === "string" && validos.has(x));
    res.status(200).json({ resposta: typeof parsed.resposta === "string" ? parsed.resposta : "", ids });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };

// ════════════════════════════════════════════════════════════════════════════
//  /api/fornecedores-agrupar — agrupa emissores de nota que são o MESMO
//  fornecedor (mesma empresa com grafias diferentes, abreviações, com/sem
//  LTDA/ME, erro de digitação). Recebe a lista de nomes (com CNPJ quando tem) e
//  devolve grupos, cada um com um nome canônico (o mais limpo/completo).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

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

    const fornecedores: Array<{ nome: string; cnpj?: string }> = Array.isArray(body.fornecedores) ? body.fornecedores.slice(0, 300) : [];
    if (fornecedores.length === 0) { res.status(200).json({ grupos: [] }); return; }

    const system = `Você recebe uma lista de EMISSORES de notas fiscais de um restaurante (nomes crus, alguns com CNPJ). Agrupe os que são a MESMA empresa: mesmo CNPJ, abreviações, com/sem "LTDA/ME/EPP", erro de digitação, ou nome fantasia vs razão social evidentes. Para cada grupo, escolha um "canonico" — o nome mais limpo e reconhecível (prefira o mais completo e correto; Primeira Maiúscula). Nomes que claramente NÃO têm par ficam sozinhos no próprio grupo. NUNCA junte empresas diferentes só por parecerem do mesmo ramo. Responda SÓ com JSON: {"grupos":[{"canonico","membros":[nomes exatos como recebidos]}]}. Use os nomes EXATAMENTE como vieram em "membros".`;
    const userMsg = JSON.stringify({ fornecedores: fornecedores.map((f) => ({ nome: f.nome, cnpj: f.cnpj || "" })) });

    const payload = { model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: `Emissores:\n${userMsg}` }] };
    const r = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json() as { content?: Array<{ text?: string }>; error?: { message?: string } };
    if (!r.ok) { res.status(502).json({ error: j?.error?.message || "Falha na IA." }); return; }
    const texto = (j.content || []).map((c) => c.text || "").join("");
    const m = texto.match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : { grupos: [] };
    res.status(200).json({ grupos: Array.isArray(parsed.grupos) ? parsed.grupos : [] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };

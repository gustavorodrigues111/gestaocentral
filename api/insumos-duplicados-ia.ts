// ════════════════════════════════════════════════════════════════════════════
//  /api/insumos-duplicados-ia — lê a lista de insumos cadastrados e sugere GRUPOS
//  de prováveis duplicados (mesmo produto com grafias/abreviações/variações
//  diferentes). Devolve os ids de cada grupo + qual manter + um motivo curto.
//  O usuário confirma no modal de mesclar (nada é apagado aqui).
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

    const insumos: Array<{ id: string; nome: string; categoria?: string }> = Array.isArray(body.insumos) ? body.insumos.slice(0, 600) : [];
    if (insumos.length < 2) { res.status(200).json({ grupos: [] }); return; }

    const system = `Você audita um cadastro de insumos de restaurante procurando DUPLICATAS: itens diferentes que são o MESMO produto, cadastrados com nomes diferentes (erro de grafia, abreviação, singular/plural, ordem das palavras, marca escrita de formas diferentes, com/sem tamanho). Agrupe SÓ o que é claramente o mesmo produto — na dúvida, NÃO agrupe. NÃO agrupe produtos parecidos mas distintos (ex.: "Coca-Cola 2L" × "Coca-Cola Lata", "Filé Mignon" × "Filé de Frango", "Queijo Mussarela" × "Queijo Prato", tamanhos/sabores/cortes diferentes são produtos DIFERENTES). Para cada grupo de 2+ itens, devolva os ids, o id que deve ser MANTIDO (o de nome mais completo/correto) e um motivo curto. Responda SÓ com JSON: {"grupos":[{"ids":["..."],"manter":"<id>","motivo":"..."}]}. Se não houver duplicatas claras, {"grupos":[]}. Use os ids exatamente como recebidos.`;

    const userMsg = JSON.stringify(insumos.map(i => ({ id: i.id, nome: i.nome, categoria: i.categoria || "" })));
    const payload = { model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: `Insumos cadastrados:\n${userMsg}` }] };
    const r = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
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

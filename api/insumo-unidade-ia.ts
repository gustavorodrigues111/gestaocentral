// ════════════════════════════════════════════════════════════════════════════
//  /api/insumo-unidade-ia — sugere a UNIDADE DE MEDIDA de produtos que estão sem
//  unidade cadastrada, a partir do nome. Ex.: "Leite Longa Vida ... 1L" → L;
//  "Arroz Tipo 1 Camil 5kg" → pac (compra por pacote); "Manteiga sem Sal" → un.
//  Usado pra não travar o pedido quando o produto não tem unidade: o app atribui
//  a sugestão e mostra um banner pra conferência. Sem estado.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const UNIDADES = ["un", "kg", "g", "L", "ml", "cx", "pct", "fardo", "garrafa", "lata"];

type ProdIn = { id: string; nome: string };

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

    const produtos: ProdIn[] = Array.isArray(body.produtos) ? body.produtos.slice(0, 100) : [];
    if (produtos.length === 0) { res.status(200).json({ sugestoes: [] }); return; }

    const system = `Você organiza o cadastro de insumos de um restaurante. Para cada produto (só o nome), diga a UNIDADE DE MEDIDA em que ele normalmente é PEDIDO/COMPRADO. Escolha SOMENTE uma destas: ${UNIDADES.join(", ")}.
Regras:
 • un = unidade avulsa (a maioria: manteiga, azeite em garrafa contável, etc. se não houver embalagem coletiva clara).
 • kg / g = comprado por peso (carnes, frios a granel, hortifruti a peso).
 • L / ml = líquidos vendidos por volume a granel.
 • cx / pct / fardo / garrafa / lata = quando o produto é claramente pedido nessa embalagem.
 • Ignore o peso/volume que aparece no NOME (ex.: "5kg", "1L", "500g") — isso é o tamanho da embalagem, não a unidade de pedido. "Arroz 5kg" normalmente se pede por "pct" (pacote) ou "un"; "Leite 1L" por "un" (caixinha) ou "cx" se vier fechado. Na dúvida entre embalagem e avulso, prefira "un".
Responda SÓ com JSON: {"sugestoes":[{"id","unidade"}]}. Use os ids exatamente como recebidos e unidade sempre dentro da lista.`;

    const userMsg = JSON.stringify({ produtos: produtos.map(p => ({ id: p.id, nome: p.nome })) });

    const payload = {
      model: MODEL, max_tokens: 4000, system,
      messages: [{ role: "user", content: `Produtos sem unidade:\n${userMsg}` }],
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
    const parsed = m ? JSON.parse(m[0]) : { sugestoes: [] };
    const sugestoes = (Array.isArray(parsed.sugestoes) ? parsed.sugestoes : [])
      .filter((s: { id?: string; unidade?: string }) => s && s.id && UNIDADES.includes(String(s.unidade)))
      .map((s: { id: string; unidade: string }) => ({ id: s.id, unidade: s.unidade }));
    res.status(200).json({ sugestoes });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };

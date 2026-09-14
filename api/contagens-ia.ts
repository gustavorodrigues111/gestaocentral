// ════════════════════════════════════════════════════════════════════════════
//  /api/contagens-ia — enriquece as sugestões de insumo (do Recebimento) com IA:
//   • categoria (de uma lista fixa)
//   • unidade de medida revisada
//   • agrupamento de nomes diferentes que são o MESMO produto (grupo)
//   • match com um insumo JÁ cadastrado ("pode ser aquele")
//  Recebe a lista de produtos + os insumos existentes e devolve um array
//  alinhado por `chave`. Sem estado; o cliente cacheia o resultado.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

const CATEGORIAS = ["Carnes", "Aves", "Peixes", "Hortifrúti", "Laticínios", "Bebidas", "Vinhos", "Cervejas", "Destilados", "Mercearia", "Congelados", "Padaria", "Limpeza", "Descartáveis", "Embalagens", "Manutenção", "Outros"];
const UNIDADES = ["un", "kg", "g", "L", "ml", "cx", "pct", "fardo", "garrafa", "lata", "outro"];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "method" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "ANTHROPIC_API_KEY não configurada." }); return; }
  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {};
    // Auth leve: exige um ID token Firebase válido (evita abuso do endpoint que custa IA).
    const idToken = String(body.idToken || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
    const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
    if (!idToken || !apiKey) { res.status(401).json({ error: "não autorizado" }); return; }
    const chk = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!chk.ok) { res.status(401).json({ error: "sessão inválida" }); return; }

    const produtos: Array<{ chave: string; nome: string; unidadeAtual?: string }> = Array.isArray(body.produtos) ? body.produtos.slice(0, 250) : [];
    const jaCadastrados: Array<{ id: string; nome: string; aliases?: string[] }> = Array.isArray(body.jaCadastrados) ? body.jaCadastrados.slice(0, 400) : [];
    if (produtos.length === 0) { res.status(200).json({ itens: [] }); return; }

    const system = `Você organiza um cadastro de insumos de restaurante a partir de nomes de produtos de notas fiscais (texto cru, abreviado, às vezes com marca/peso). Para CADA produto recebido, devolva:
- "categoria": UMA de ${JSON.stringify(CATEGORIAS)}.
- "unidade": a unidade de compra mais provável, UMA de ${JSON.stringify(UNIDADES)} (ex.: carne/hortifruti costuma ser "kg"; bebida em garrafa "garrafa"; refrigerante lata "lata"; caixa "cx"). Se não souber, "un".
- "grupo": um rótulo curto e ESTÁVEL (ex.: "coca-cola-2l") que agrupa nomes DIFERENTES que são o MESMO produto (ex.: "COCA COLA 2L", "REFRI COCA-COLA 2LT" → mesmo grupo). Produtos únicos recebem um grupo próprio.
- "matchInsumoId": se o produto for claramente o MESMO que um insumo já cadastrado (lista fornecida), devolva o id dele; senão null.
Responda SÓ com JSON: {"itens":[{"chave","categoria","unidade","grupo","matchInsumoId"}]}. Use a "chave" exatamente como recebida. Não invente produtos.`;

    const userMsg = JSON.stringify({
      produtos: produtos.map((p) => ({ chave: p.chave, nome: p.nome, unidadeNota: p.unidadeAtual || "" })),
      insumosJaCadastrados: jaCadastrados.map((i) => ({ id: i.id, nome: i.nome, aliases: i.aliases || [] })),
    });

    const payload = {
      model: MODEL, max_tokens: 8000,
      system,
      messages: [{ role: "user", content: `Produtos e cadastro:\n${userMsg}` }],
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
    const parsed = m ? JSON.parse(m[0]) : { itens: [] };
    res.status(200).json({ itens: Array.isArray(parsed.itens) ? parsed.itens : [] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };

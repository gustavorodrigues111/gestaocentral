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
- "nomeLimpo": o nome da UNIDADE INDIVIDUAL, limpo e funcional, Primeira Maiúscula, expandindo abreviações — SEM a quantidade do pacote no nome (o pacote vai em qtdPorPacote). Regras: GFA→"Garrafa", LN/LT/LATA→"Lata", PET→"Pet"; "0,330"/"330"→"330ml", "2,5KG"→"2,5kg"; remova códigos/SKUs e siglas-lixo ("01050004", "DESC"/"DES", "PBR", "4X6UNPBR"). Mantenha MARCA + variação + tamanho + embalagem individual. Ex.: "Cerv Heineken 0,0% 0,330GFA Desc 4X6UNPBR" → "Cerveja Heineken 0,0% 330ml Garrafa" (NÃO inclua "4x6"); "Icycode GELAO45 (pct. com 24 Un.)" → "Gelo Gelão 45".
- "qtdPorPacote": quando o produto é COMPRADO em pacote/fardo/caixa com várias unidades INDIVIDUAIS, o número de unidades por pacote (ex.: "4X6UN"→24; "12UN"→12; "pct com 24 Un"→24; "6 GARRAFAS"→6). TAMBÉM quando o nome traz o peso do pacote E o peso da unidade: DIVIDA (peso do pacote ÷ peso da unidade) — ex.: "Amora Polpa 100G Pct 1.02KG" = 1020g ÷ 100g ≈ 10 → qtdPorPacote 10; "Filé 5KG cx 500g"→10. É esse número que vira o "fator de compra". Só devolva 1 quando for peso a granel puro (ex.: "Picanha kg") ou unidade avulsa de verdade.
- "categoria": UMA de ${JSON.stringify(CATEGORIAS)}.
- "unidade": a unidade da UNIDADE INDIVIDUAL (a de dentro do pacote), UMA de ${JSON.stringify(UNIDADES)}. NUNCA use "pacote"/"caixa"/"fardo" como unidade — isso é o agrupamento de compra (vai em qtdPorPacote), não a unidade de contagem. Ex.: "Amora Polpa 100G Pct 1.02KG" → unidade "un" (a polpa individual), qtdPorPacote 10. IMPORTANTE: a unidade que veio da nota costuma ser um CÓDIGO interno errado ou abreviação (ex.: "FC", "BD", "PC", "CX", "UND") — NÃO confie nela; decida pela NATUREZA do produto. Carnes/aves/peixes/frios (bacon, orelha, pé, linguiça, costela) e hortifrúti a granel são quase sempre "kg". Óleo/azeite em balde/lata → "L" ou "lata". Bebida em garrafa → "garrafa"; refrigerante em lata → "lata". Se realmente não der pra saber, "un".
- "grupo": um rótulo curto e ESTÁVEL (ex.: "coca-cola-2l") que agrupa nomes DIFERENTES que são o MESMO produto (ex.: "COCA COLA 2L", "REFRI COCA-COLA 2LT" → mesmo grupo). Produtos únicos recebem um grupo próprio.
- "matchInsumoId": se o produto for claramente o MESMO que um insumo já cadastrado (lista fornecida), devolva o id dele; senão null.
Responda SÓ com JSON: {"itens":[{"chave","nomeLimpo","qtdPorPacote","categoria","unidade","grupo","matchInsumoId"}]}. Use a "chave" exatamente como recebida. Não invente produtos.`;

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

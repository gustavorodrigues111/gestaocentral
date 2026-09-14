// ════════════════════════════════════════════════════════════════════════════
//  /api/contagens-ia-lote — reavalia TODAS as sugestões de insumo pela IA NO
//  SERVIDOR (segundo plano) e grava o resultado em insumosIaCache/{rid}. O
//  cliente dispara, pode sair da tela, e vê o progresso ao vivo (onSnapshot no
//  cache). Processa o que couber em ~52s; sobrou? o cliente clica de novo.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { firestoreLer, firestoreAtualizar } from "./_firestoreRest.js";

export const config = { maxDuration: 60 };

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";
const CATEGORIAS = ["Carnes", "Aves", "Peixes", "Hortifrúti", "Laticínios", "Bebidas", "Vinhos", "Cervejas", "Destilados", "Mercearia", "Congelados", "Padaria", "Limpeza", "Descartáveis", "Embalagens", "Manutenção", "Outros"];
const UNIDADES = ["un", "kg", "g", "L", "ml", "cx", "pct", "fardo", "garrafa", "lata", "outro"];

const SYSTEM = `Você organiza um cadastro de insumos de restaurante a partir de nomes de produtos de notas fiscais (texto cru, abreviado, às vezes com marca/peso). Para CADA produto recebido, devolva:
- "nomeLimpo": o nome da UNIDADE INDIVIDUAL, limpo e funcional, Primeira Maiúscula, expandindo abreviações — SEM a quantidade do pacote no nome. GFA→"Garrafa", LN/LT/LATA→"Lata", PET→"Pet"; "0,330"/"330"→"330ml", "2,5KG"→"2,5kg"; remova códigos/SKUs e siglas-lixo ("01050004","DESC","DES","PBR","4X6UNPBR"). Mantenha MARCA+variação+tamanho+embalagem individual. Ex.: "Cerv Heineken 0,0% 0,330GFA Desc 4X6UNPBR" → "Cerveja Heineken 0,0% 330ml Garrafa".
- "qtdPorPacote": quando é comprado em pacote/fardo/caixa com várias unidades INDIVIDUAIS, o número de unidades por pacote (ex.: "4X6UN"→24; "12UN"→12; "pct com 24 Un"→24). É o "fator de compra". Se é por PESO (kg) ou avulso, 1.
- "categoria": UMA de ${JSON.stringify(CATEGORIAS)}.
- "unidade": a unidade de compra mais provável, UMA de ${JSON.stringify(UNIDADES)}. NÃO confie no código de unidade da nota (FC, BD, PC…) — decida pela natureza do produto (carne/hortifruti→kg; garrafa→garrafa; lata→lata; caixa→cx). Se não der, "un".
- "grupo": rótulo curto e ESTÁVEL que agrupa nomes DIFERENTES do MESMO produto (ex.: "coca-cola-2l"). Únicos recebem grupo próprio.
- "matchInsumoId": se for claramente o MESMO que um insumo já cadastrado, o id dele; senão null.
Responda SÓ com JSON: {"itens":[{"chave","nomeLimpo","qtdPorPacote","categoria","unidade","grupo","matchInsumoId"}]}. Use a "chave" exatamente como recebida.`;

type Item = { chave: string; nomeLimpo?: string; qtdPorPacote?: number; categoria?: string; unidade?: string; grupo?: string; matchInsumoId?: string | null };

async function analisar(produtos: Array<{ chave: string; nome: string; unidadeAtual?: string }>, jaCadastrados: Array<{ id: string; nome: string; aliases?: string[] }>, key: string): Promise<Item[]> {
  const userMsg = JSON.stringify({ produtos: produtos.map((p) => ({ chave: p.chave, nome: p.nome, unidadeNota: p.unidadeAtual || "" })), insumosJaCadastrados: jaCadastrados.map((i) => ({ id: i.id, nome: i.nome, aliases: i.aliases || [] })) });
  const r = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: SYSTEM, messages: [{ role: "user", content: `Produtos e cadastro:\n${userMsg}` }] }) });
  if (!r.ok) return [];
  const j = await r.json() as { content?: Array<{ text?: string }> };
  const texto = (j.content || []).map((c) => c.text || "").join("");
  const m = texto.match(/\{[\s\S]*\}/);
  const parsed = m ? JSON.parse(m[0]) : { itens: [] };
  return Array.isArray(parsed.itens) ? parsed.itens : [];
}

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

    const rid = String(body.rid || "");
    const produtos: Array<{ chave: string; nome: string; unidadeAtual?: string }> = Array.isArray(body.produtos) ? body.produtos.slice(0, 600) : [];
    const jaCadastrados = Array.isArray(body.jaCadastrados) ? body.jaCadastrados.slice(0, 400) : [];
    if (!rid || produtos.length === 0) { res.status(200).json({ analisados: 0, restantes: 0 }); return; }

    const inicio = Date.now();
    let analisados = 0, idx = 0;
    for (; idx < produtos.length; idx += 40) {
      if (Date.now() - inicio > 50000) break;
      const lote = produtos.slice(idx, idx + 40);
      const itens = await analisar(lote, jaCadastrados, key);
      // Mescla no cache do restaurante (por chave) e grava — o cliente vê ao vivo.
      const atual = await firestoreLer("insumosIaCache", rid) as { itens?: Item[] } | null;
      const mapa = new Map<string, Item>();
      for (const it of (atual?.itens || [])) if (it?.chave) mapa.set(it.chave, it);
      for (const s of lote) if (!mapa.has(s.chave)) mapa.set(s.chave, { chave: s.chave });   // garante entrada mesmo sem resposta
      for (const it of itens) if (it?.chave) mapa.set(it.chave, { chave: it.chave, nomeLimpo: it.nomeLimpo, qtdPorPacote: it.qtdPorPacote, categoria: it.categoria, unidade: it.unidade, grupo: it.grupo, matchInsumoId: it.matchInsumoId ?? null });
      await firestoreAtualizar("insumosIaCache", rid, { restaurantId: rid, itens: [...mapa.values()], atualizadoEm: new Date().toISOString() });
      analisados += lote.length;
    }
    res.status(200).json({ analisados, restantes: Math.max(0, produtos.length - idx) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

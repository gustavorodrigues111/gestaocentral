// ════════════════════════════════════════════════════════════════════════════
//  /api/recebimento-match-ia — CONFERÊNCIA item-a-item de uma NOTA FISCAL contra um
//  PEDIDO de compra. Recebe os itens da NF (grafia crua, qtd, unidade) e os itens
//  do pedido (nome do insumo, qtd pedida, unidade) e devolve, item a item, se veio
//  conforme, com quantidade divergente, faltou (estava no pedido e não veio) ou é
//  extra (veio na NF sem estar no pedido) — casando por SIMILARIDADE de nome, que é
//  onde a IA ganha ("TOMATE ITALIANO CX 20KG" ⇄ "Tomate italiano"). Também sugere o
//  status final (recebido_ok / recebido_div) e um resumo de uma frase.
//  Sem estado — o cliente persiste o resultado (matchIA) no doc da NF (cache).
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

type ItemNfIn = { descricao?: string; quantidade?: number | null; unidade?: string; valorTotal?: number | null };
type ItemPedidoIn = { nome: string; qtdPedida: number; unidade?: string };

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

    const itensNota: ItemNfIn[] = Array.isArray(body.itensNota) ? body.itensNota.slice(0, 300) : [];
    const itensPedido: ItemPedidoIn[] = Array.isArray(body.itensPedido) ? body.itensPedido.slice(0, 300) : [];
    const nota = body.nota || {};      // { emissor, valorTotal, dataEmissao }
    const pedido = body.pedido || {};  // { fornecedor, totalEstimado, enviadoEm }

    if (itensPedido.length === 0) { res.status(200).json({ resumo: "Pedido sem itens.", statusSugerido: "recebido_ok", itens: [] }); return; }

    const system = `Você confere o RECEBIMENTO de mercadorias de um restaurante: compara os itens de uma NOTA FISCAL com os itens de um PEDIDO de compra, pra garantir que chegou tudo o que foi pedido, na quantidade certa.
Case cada item do PEDIDO com o item correspondente da NOTA por SIMILARIDADE de nome (ignore maiúsculas, marcas, embalagem, peso na descrição: "TOMATE ITALIANO CX 20KG" ⇄ "Tomate italiano"). Um item do pedido casa com no máximo um item da nota.
Para cada par/pendência devolva um objeto com:
 • status: "ok" (veio a quantidade pedida, ±5%), "qtd_menor" (veio menos que o pedido), "qtd_maior" (veio mais), "faltou" (item do pedido que NÃO apareceu na nota), "extra" (item da nota que NÃO estava no pedido).
 • insumoNomePedido: o nome do item no pedido (vazio quando for "extra").
 • descricaoNota: a grafia do item na nota (vazio quando for "faltou").
 • qtdPedida, qtdNota, unidade: as quantidades (null quando não se aplica).
 • obs: só quando ajudar (ex.: "unidades diferentes: pedido em cx, nota em kg").
Compare quantidades com bom senso quando as unidades diferem (cx × un, kg × g) — se não der pra comparar com segurança, use status "ok"/"extra"/"faltou" e explique em obs; não invente conversão.
statusSugerido: "recebido_div" se houver qualquer faltou/qtd_menor/qtd_maior (divergência que afeta o pedido); senão "recebido_ok". Itens "extra" sozinhos NÃO forçam divergência, mas cite no resumo.
resumo: UMA frase ("mesmo fornecedor, 7 de 8 itens conferem; faltou cebola; 1 item extra na nota").
Responda SÓ com JSON: {"resumo","statusSugerido","itens":[{"status","insumoNomePedido","descricaoNota","qtdPedida","qtdNota","unidade","obs"}]}.`;

    const userMsg = JSON.stringify({
      nota: { emissor: nota.emissor ?? null, valorTotal: nota.valorTotal ?? null, dataEmissao: nota.dataEmissao ?? null },
      pedido: { fornecedor: pedido.fornecedor ?? null, totalEstimado: pedido.totalEstimado ?? null, enviadoEm: pedido.enviadoEm ?? null },
      itensPedido: itensPedido.map(it => ({ nome: it.nome, qtdPedida: it.qtdPedida, unidade: it.unidade || "un" })),
      itensNota: itensNota.map(it => ({ descricao: it.descricao || "", quantidade: it.quantidade ?? null, unidade: it.unidade || "", valorTotal: it.valorTotal ?? null })),
    });

    const payload = {
      model: MODEL, max_tokens: 8000, system,
      messages: [{ role: "user", content: `Confira este recebimento (nota × pedido):\n${userMsg}` }],
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
    const parsed = m ? JSON.parse(m[0]) : { resumo: "", statusSugerido: "recebido_ok", itens: [] };
    res.status(200).json({
      resumo: typeof parsed.resumo === "string" ? parsed.resumo : "",
      statusSugerido: parsed.statusSugerido === "recebido_div" ? "recebido_div" : "recebido_ok",
      itens: Array.isArray(parsed.itens) ? parsed.itens : [],
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };

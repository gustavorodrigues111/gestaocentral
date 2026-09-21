// ════════════════════════════════════════════════════════════════════════════
//  /api/compras-ia — monta a SUGESTÃO DE PEDIDO por fornecedor a partir da última
//  contagem. Recebe, por fornecedor, os itens com contagem × estoque mínimo, fator
//  de pacote, pedido mínimo por item e preço; e o valor mínimo do pedido do
//  fornecedor. A IA decide QUANTO pedir de cada item respeitando:
//   • repor até o mínimo (necessidade = mínimo − contagem);
//   • múltiplo do pacote (fator de compra);
//   • pedido mínimo por item (qtd mínima aceita);
//   • valor mínimo do pedido (completa o pedido subindo itens que fazem sentido);
//  e devolve um resumo curto por fornecedor. Sem estado — o cliente persiste.
// ════════════════════════════════════════════════════════════════════════════
import type { VercelRequest, VercelResponse } from "@vercel/node";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-8";

type ItemIn = { insumoId: string; nome: string; unidade?: string; contagem: number; temContagem?: boolean; minStock: number; fator: number; minPedido: number; precoUnit?: number; precisaPedido: boolean; sugestaoRegra: number };
type GrupoIn = { fornecedorId: string; fornecedorNome: string; pedidoMinimoValor?: number; itens: ItemIn[] };

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

    const grupos: GrupoIn[] = Array.isArray(body.grupos) ? body.grupos.slice(0, 60) : [];
    if (grupos.length === 0) { res.status(200).json({ grupos: [] }); return; }

    const system = `Você é o comprador de um restaurante. Para CADA fornecedor, decida QUANTO pedir de cada item, com base na contagem atual × estoque mínimo. Regras (nesta ordem de prioridade):
1) Só peça o que está ABAIXO do mínimo (precisaPedido=true). A necessidade base é (minStock − contagem), nunca negativa.
2) A quantidade pedida deve ser MÚLTIPLA do fator de pacote (fator). Ex.: fator 6 e necessidade 8 → peça 12. Se fator=1, qualquer inteiro.
3) Respeite o pedido mínimo por item (minPedido): se for pedir aquele item, a qtd nunca fica abaixo de minPedido (e ainda múltipla do fator).
4) Valor mínimo do pedido (pedidoMinimoValor, em R$): se a soma (qtd × precoUnit) do fornecedor não atingir esse valor, AUMENTE as quantidades pra atingir — priorize itens que já precisam e que estão mais perto do mínimo, subindo de pacote em pacote (múltiplos do fator). Se ainda faltar, pode incluir itens que NÃO estavam abaixo do mínimo (precisaPedido=false), preferindo os de giro. Não estoure muito além do mínimo sem necessidade.
5) Itens que não precisam (precisaPedido=false) ficam com qtd 0, a não ser que ajudem a bater o pedido mínimo (regra 4).
Devolva, por fornecedor, a lista de itens com a qtd final (só os com qtd > 0) e um "resumo" de UMA frase explicando as decisões (quantos abaixo do mínimo, se subiu algo pra fechar pacote ou pra bater o pedido mínimo). Responda SÓ com JSON: {"grupos":[{"fornecedorId","resumo","itens":[{"insumoId","qtd"}]}]}. Use os ids exatamente como recebidos. Não invente itens nem fornecedores.`;

    const userMsg = JSON.stringify({ grupos: grupos.map(g => ({
      fornecedorId: g.fornecedorId,
      fornecedor: g.fornecedorNome,
      pedidoMinimoValor: g.pedidoMinimoValor ?? null,
      itens: (g.itens || []).slice(0, 200).map(it => ({
        insumoId: it.insumoId, nome: it.nome, unidade: it.unidade || "un",
        contagem: it.contagem, minStock: it.minStock, fator: it.fator || 1,
        minPedido: it.minPedido || 0, precoUnit: it.precoUnit ?? null,
        precisaPedido: !!it.precisaPedido, sugestaoRegra: it.sugestaoRegra,
      })),
    })) });

    const payload = {
      model: MODEL, max_tokens: 8000, system,
      messages: [{ role: "user", content: `Fornecedores e itens da última contagem:\n${userMsg}` }],
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
    const parsed = m ? JSON.parse(m[0]) : { grupos: [] };
    res.status(200).json({ grupos: Array.isArray(parsed.grupos) ? parsed.grupos : [] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "erro" });
  }
}

export const config = { maxDuration: 60 };

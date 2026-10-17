// Cliente da NFC-e (Focus NFe) — chama o nosso backend /api/nfce (segredos lá).
// Monta os itens/formas a partir da comanda + dados fiscais do produto.
import { authHeader } from "../../core/firebase/idToken";
import type { Comanda, ComandaProduto } from "../../core/types";

export type NfceResp = { ok: boolean; httpStatus: number; data: unknown; error?: string };

async function call(payload: Record<string, unknown>): Promise<NfceResp> {
  const r = await fetch("/api/nfce", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string })?.error || `Erro na NFC-e (${r.status})`);
  return j as NfceResp;
}

type FocusItem = Record<string, unknown>;
type FocusForma = { forma_pagamento: string; valor_pagamento: number; bandeira_operadora?: string; numero_autorizacao?: string };

// Código de pagamento NFC-e a partir da nossa "forma".
function codForma(forma: string): string {
  const f = forma.toLowerCase();
  if (f.includes("dinheiro")) return "01";
  if (f.includes("débito") || f.includes("debito")) return "04";
  if (f.includes("crédito") || f.includes("credito")) return "03";
  if (f.includes("pix")) return "17";
  return "99";
}

// Monta o corpo da NFC-e. Retorna os itens/formas + a lista de produtos SEM
// fiscal (NCM/CFOP/CSOSN) — se houver, a nota seria rejeitada.
export function montarNfce(comanda: Comanda, produtos: ComandaProduto[]): { items: FocusItem[]; formas: FocusForma[]; faltando: string[] } {
  const byId = new Map(produtos.map((p) => [p.id, p]));
  const faltando: string[] = [];
  const items: FocusItem[] = comanda.itens.map((i, idx) => {
    const p = i.produtoId ? byId.get(i.produtoId) : undefined;
    const ncm = p?.ncm || "";
    const cfop = p?.cfop || "";
    const csosn = p?.csosn || p?.cst || "";
    if (!ncm || !cfop || !csosn) faltando.push(i.nome);
    const un = (p?.unidadeFiscal || p?.unidade || (i.porPeso ? "kg" : "un")).toUpperCase();
    return {
      numero_item: String(idx + 1),
      codigo_produto: p?.codigo || i.produtoId || String(idx + 1),
      codigo_ncm: ncm,
      cfop,
      descricao: i.nome,
      quantidade_comercial: +i.qtd.toFixed(3),
      quantidade_tributavel: +i.qtd.toFixed(3),
      valor_unitario_comercial: +i.precoUnit.toFixed(2),
      valor_unitario_tributavel: +i.precoUnit.toFixed(2),
      valor_bruto: +i.total.toFixed(2),
      unidade_comercial: un,
      unidade_tributavel: un,
      icms_origem: p?.origem || "0",
      icms_situacao_tributaria: csosn,
    };
  });
  // Agrupa formas de pagamento por código.
  const m = new Map<string, number>();
  for (const pg of comanda.pagamentos || []) m.set(codForma(pg.forma), (m.get(codForma(pg.forma)) || 0) + pg.valor);
  const formas: FocusForma[] = [...m.entries()].map(([forma_pagamento, valor_pagamento]) => ({ forma_pagamento, valor_pagamento: +valor_pagamento.toFixed(2) }));
  return { items, formas, faltando };
}

export const nfceEmitir = (ref: string, items: FocusItem[], formas: FocusForma[], cpf?: string, nome?: string) =>
  call({ acao: "emitir", ref, items, formas_pagamento: formas, cpf_destinatario: cpf, nome_destinatario: nome });
export const nfceConsultar = (ref: string) => call({ acao: "consultar", ref });
export const nfceCancelar = (ref: string, justificativa: string) => call({ acao: "cancelar", ref, justificativa });

// Interpreta a resposta da Focus.
export function lerNfce(resp: NfceResp): { autorizado: boolean; status: string; mensagem: string; chave?: string; numero?: string; serie?: string; qrcodeUrl?: string; danfeUrl?: string } {
  const d = (resp.data && typeof resp.data === "object" ? resp.data : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" || typeof v === "number") ? String(v) : undefined;
  const status = String(d.status || "").toLowerCase();
  return {
    autorizado: status === "autorizado",
    status,
    mensagem: str(d.mensagem_sefaz) || str(d.mensagem) || "",
    chave: str(d.chave_nfe),
    numero: str(d.numero),
    serie: str(d.serie),
    qrcodeUrl: str(d.qrcode_url),
    danfeUrl: str(d.caminho_danfe),
  };
}

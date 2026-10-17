// Cliente da NFC-e (Focus NFe) — chama o nosso backend /api/nfce (segredos lá).
// Monta os itens/formas a partir da comanda + dados fiscais do produto.
import { authHeader } from "../../core/firebase/idToken";
import type { Comanda, ComandaProduto, ComandaFiscalConfig } from "../../core/types";

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

// CSTs de ICMS que NÃO destacam imposto (isenta / não tributada / ST já retido).
// Para esses não mandamos base/alíquota/valor — só o CST + origem.
const ICMS_SEM_DESTAQUE = new Set(["40", "41", "50", "60"]);
// CSTs de PIS/COFINS que destacam alíquota (tributável). Os demais (07, 08, 49…) = sem destaque.
const PISCOFINS_COM_DESTAQUE = new Set(["01", "02"]);
const r2 = (n: number) => +n.toFixed(2);

// Monta o corpo da NFC-e (Regime Normal / Lucro Presumido) a partir da comanda +
// do Fiscal padrão do restaurante + dos campos fiscais de cada produto.
// Por produto varia só o NCM (e, se quiser, CFOP/CST/alíquota de ICMS); o resto
// (CFOP padrão, PIS/COFINS, origem) vem do `cfg`. Retorna também `faltando`:
// itens sem NCM ou sem CST/CFOP resolvido — se houver, a nota é rejeitada.
export function montarNfce(
  comanda: Comanda,
  produtos: ComandaProduto[],
  cfg?: ComandaFiscalConfig | null,
): { items: FocusItem[]; formas: FocusForma[]; faltando: string[] } {
  const byId = new Map(produtos.map((p) => [p.id, p]));
  const faltando: string[] = [];
  const regime = cfg?.regime || "normal";
  const cfopPadrao = cfg?.cfop || "";
  const origemPadrao = cfg?.origem || "0";
  const cstIcmsPadrao = cfg?.cstIcms || "";
  const aliqIcmsPadrao = cfg?.aliqIcms ?? null;
  const cstPis = cfg?.cstPis || "01";
  const aliqPis = cfg?.aliqPis ?? 0.65;
  const cstCofins = cfg?.cstCofins || "01";
  const aliqCofins = cfg?.aliqCofins ?? 3;

  const items: FocusItem[] = comanda.itens.map((i, idx) => {
    const p = i.produtoId ? byId.get(i.produtoId) : undefined;
    const ncm = p?.ncm || "";
    const cfop = p?.cfop || cfopPadrao;
    const origem = p?.origem || origemPadrao;
    // Regime Normal: SEMPRE CST (2 díg); nunca cai no csosn antigo do produto.
    // Simples: usa CSOSN (3 díg). Produto sobrepõe o padrão.
    const cstIcms = regime === "simples"
      ? (p?.csosn || p?.cst || cstIcmsPadrao)
      : (p?.cst || cstIcmsPadrao);
    const aliqIcms = p?.aliqIcms ?? aliqIcmsPadrao;
    if (!ncm || !cfop || !cstIcms) faltando.push(i.nome);
    const un = (p?.unidadeFiscal || p?.unidade || (i.porPeso ? "kg" : "un")).toUpperCase();
    const bruto = r2(i.total);

    const item: FocusItem = {
      numero_item: String(idx + 1),
      codigo_produto: p?.codigo || i.produtoId || String(idx + 1),
      codigo_ncm: ncm,
      cfop,
      descricao: i.nome,
      quantidade_comercial: +i.qtd.toFixed(3),
      quantidade_tributavel: +i.qtd.toFixed(3),
      valor_unitario_comercial: r2(i.precoUnit),
      valor_unitario_tributavel: r2(i.precoUnit),
      valor_bruto: bruto,
      unidade_comercial: un,
      unidade_tributavel: un,
      // ICMS (Regime Normal)
      icms_origem: origem,
      icms_situacao_tributaria: cstIcms,
    };
    if (cstIcms && !ICMS_SEM_DESTAQUE.has(cstIcms)) {
      // Tributado (CST 00, 10, 20, 70, 90…): base = valor da operação.
      item.icms_modalidade_base_calculo = "3";
      item.icms_base_calculo = bruto;
      item.icms_aliquota = aliqIcms ?? 0;
      item.icms_valor = r2((bruto * (aliqIcms ?? 0)) / 100);
    }
    // PIS
    item.pis_situacao_tributaria = cstPis;
    if (PISCOFINS_COM_DESTAQUE.has(cstPis)) {
      item.pis_base_calculo = bruto;
      item.pis_aliquota_porcentual = aliqPis;
      item.pis_valor = r2((bruto * aliqPis) / 100);
    }
    // COFINS
    item.cofins_situacao_tributaria = cstCofins;
    if (PISCOFINS_COM_DESTAQUE.has(cstCofins)) {
      item.cofins_base_calculo = bruto;
      item.cofins_aliquota_porcentual = aliqCofins;
      item.cofins_valor = r2((bruto * aliqCofins) / 100);
    }
    return item;
  });
  // Agrupa formas de pagamento por código.
  const m = new Map<string, number>();
  for (const pg of comanda.pagamentos || []) m.set(codForma(pg.forma), (m.get(codForma(pg.forma)) || 0) + pg.valor);
  const formas: FocusForma[] = [...m.entries()].map(([forma_pagamento, valor_pagamento]) => ({ forma_pagamento, valor_pagamento: r2(valor_pagamento) }));
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

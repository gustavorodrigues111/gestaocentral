// ════════════════════════════════════════════════════════════════════════════
//  /api/nfce — emissão de NFC-e (modelo 65) via Focus NFe, pro módulo Comandas.
//
//  O token da Focus é SEGREDO e fica SÓ aqui (env). O cliente (PDV) manda a venda
//  (itens já com NCM/CFOP/CSOSN + formas de pagamento) e este endpoint monta o
//  JSON da Focus e emite. Série/CSC/certificado ficam no PAINEL da Focus (empresa).
//
//  Focus NFe (HTTP Basic: usuário = token, senha vazia):
//    Produção:    https://api.focusnfe.com.br/v2
//    Homologação: https://homologacao.focusnfe.com.br/v2
//    Emitir:    POST /v2/nfce?ref=<ref>     (síncrono: volta autorizado/erro)
//    Consultar: GET  /v2/nfce/<ref>
//    Cancelar:  DELETE /v2/nfce/<ref>        (até 30min, com justificativa)
//  Resposta: { status, status_sefaz, mensagem_sefaz, chave_nfe, numero, serie,
//              caminho_danfe, caminho_xml_nota_fiscal, qrcode_url, url_consulta_nf }
//
//  Envs: FOCUS_NFE_TOKEN (segredo), FOCUS_NFE_CNPJ (emitente, só dígitos),
//        FOCUS_NFE_AMBIENTE ("homologacao" | "producao", padrão homologacao).
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 60 };

const TOKEN = process.env.FOCUS_NFE_TOKEN || "";
const CNPJ = (process.env.FOCUS_NFE_CNPJ || "").replace(/\D/g, "");
const AMBIENTE = (process.env.FOCUS_NFE_AMBIENTE || "homologacao").toLowerCase();
const BASE = AMBIENTE === "producao" ? "https://api.focusnfe.com.br/v2" : "https://homologacao.focusnfe.com.br/v2";

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

function basic(): string { return "Basic " + Buffer.from(`${TOKEN}:`).toString("base64"); }

async function focus(method: string, path: string, corpo?: unknown): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const r = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`, {
      method,
      headers: { "Authorization": basic(), "Content-Type": "application/json", "Accept": "application/json" },
      body: corpo != null ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
    let body: unknown = null;
    const txt = await r.text();
    try { body = txt ? JSON.parse(txt) : null; } catch { body = { raw: txt }; }
    return { status: r.status, body };
  } finally { clearTimeout(t); }
}

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== "POST") { res.status(405).json({ error: "Método não permitido." }); return; }
  try { await requireUser(req); }
  catch (e) { res.status(e instanceof AuthError ? e.status : 401).json({ error: e instanceof Error ? e.message : "Não autorizado." }); return; }

  if (!TOKEN || !CNPJ) { res.status(503).json({ error: "NFC-e não configurada — faltam FOCUS_NFE_TOKEN / FOCUS_NFE_CNPJ na Vercel." }); return; }

  const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  const acao = String(body?.acao || "");
  const ref = String(body?.ref || "").trim();

  try {
    if (acao === "emitir") {
      if (!ref) { res.status(400).json({ error: "ref ausente." }); return; }
      const items = Array.isArray(body?.items) ? body!.items : [];
      const formas = Array.isArray(body?.formas_pagamento) ? body!.formas_pagamento : [];
      if (!items.length) { res.status(400).json({ error: "Sem itens." }); return; }
      const nfce: Record<string, unknown> = {
        cnpj_emitente: CNPJ,
        data_emissao: new Date().toISOString(),
        indicador_inscricao_estadual_destinatario: "9",   // consumidor não contribuinte
        modalidade_frete: "9",
        local_destino: "1",
        presenca_comprador: "1",                            // operação presencial
        natureza_operacao: "VENDA AO CONSUMIDOR",
        items,
        formas_pagamento: formas.length ? formas : [{ forma_pagamento: "99", valor_pagamento: 0 }],
      };
      if (body?.cpf_destinatario) nfce.cpf_destinatario = String(body.cpf_destinatario).replace(/\D/g, "");
      if (body?.nome_destinatario) nfce.nome_destinatario = String(body.nome_destinatario);
      const r = await focus("POST", `/nfce?ref=${encodeURIComponent(ref)}`, nfce);
      res.status(200).json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, data: r.body });
      return;
    }
    if (acao === "consultar") {
      if (!ref) { res.status(400).json({ error: "ref ausente." }); return; }
      const r = await focus("GET", `/nfce/${encodeURIComponent(ref)}`);
      res.status(200).json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, data: r.body });
      return;
    }
    if (acao === "cancelar") {
      if (!ref) { res.status(400).json({ error: "ref ausente." }); return; }
      const just = String(body?.justificativa || "Cancelamento solicitado pelo emitente");
      const r = await focus("DELETE", `/nfce/${encodeURIComponent(ref)}`, { justificativa: just });
      res.status(200).json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, data: r.body });
      return;
    }
    res.status(400).json({ error: `Ação desconhecida: ${acao}` });
  } catch (e) {
    const causa = (e as { cause?: { code?: string } })?.cause;
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao falar com a Focus NFe.", causa: causa?.code });
  }
}

function safeJson(s: string): Record<string, unknown> | null { try { return JSON.parse(s); } catch { return null; } }

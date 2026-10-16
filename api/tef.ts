// ════════════════════════════════════════════════════════════════════════════
//  /api/tef — proxy pro Smart TEF (TW2/POS Controle) pro módulo Comandas.
//
//  O navegador NUNCA fala com a API do Smart TEF direto — os 2 segredos
//  (subscription key + JWT) ficam SÓ aqui no servidor (env da Vercel). O cliente
//  (PDV) chama este endpoint autenticado com o Firebase ID token.
//
//  API do Smart TEF (base https://api.smarttef.com.br), 2 headers:
//    Ocp-Apim-Subscription-Key: <SMARTTEF_SUBSCRIPTION_KEY>
//    Authorization: Bearer <SMARTTEF_TOKEN>
//  Endpoints:
//    criar    → POST /commands/order/create
//    status   → POST /pooling/order/get           { payment_identifier }
//    estornar → POST /commands/order/status/estornar { payment_identifier }
//    cancelar → POST /commands/order/status/cancelar { payment_identifier }
//  Resposta: envelope { Sucesso, MensagemErro, RespostaJson, DadosTEF{nsu,
//  autorizacao, bandeira, ...} }. Status "CNC" = aprovado.
// ════════════════════════════════════════════════════════════════════════════
import { requireUser, AuthError } from "./_auth.js";

export const config = { maxDuration: 30 };

const BASE = (process.env.SMARTTEF_BASE_URL || "https://api.smarttef.com.br").replace(/\/+$/, "");
const SUB_KEY = process.env.SMARTTEF_SUBSCRIPTION_KEY || "";
const TOKEN = process.env.SMARTTEF_TOKEN || "";
const SERIAL_POS_PADRAO = process.env.SMARTTEF_SERIAL_POS || "008b4a5e2a1ef8ff";  // Laranjinha Peixaria (Sororoca)

type VercelReq = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type VercelRes = { status: (code: number) => VercelRes; json: (body: unknown) => void };

async function tefPost(path: string, corpo: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const r = await fetch(`${BASE}/${path.replace(/^\/+/, "")}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": SUB_KEY,
        "Authorization": `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(corpo),
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
  try {
    await requireUser(req);   // exige usuário logado do app
  } catch (e) {
    const st = e instanceof AuthError ? e.status : 401;
    res.status(st).json({ error: e instanceof Error ? e.message : "Não autorizado." });
    return;
  }

  if (!SUB_KEY || !TOKEN) {
    res.status(503).json({ error: "TEF não configurado — faltam SMARTTEF_SUBSCRIPTION_KEY / SMARTTEF_TOKEN na Vercel." });
    return;
  }

  const body = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  const acao = String(body?.acao || "");

  try {
    if (acao === "criar") {
      const value = Number(body?.value);
      if (!(value > 0)) { res.status(400).json({ error: "Valor inválido." }); return; }
      const corpo: Record<string, unknown> = {
        value,
        payment_type: String(body?.payment_type || "credito"),
        charge_id: String(body?.charge_id || `tef_${Date.now()}`),
        serial_pos: String(body?.serial_pos || SERIAL_POS_PADRAO),
        installments: Number(body?.installments) > 0 ? Number(body?.installments) : 1,
        order_type: String(body?.order_type || "CRD_UNICO"),
      };
      if (body?.cpf || body?.nome) corpo.extras = { CPF: body?.cpf || "", Nome: body?.nome || "" };
      if (body?.user_id != null) corpo.user_id = Number(body?.user_id);
      const r = await tefPost("/commands/order/create", corpo);
      res.status(200).json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, data: r.body });
      return;
    }
    if (acao === "status") {
      const id = String(body?.payment_identifier || "");
      if (!id) { res.status(400).json({ error: "payment_identifier ausente." }); return; }
      const r = await tefPost("/pooling/order/get", { payment_identifier: id });
      res.status(200).json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, data: r.body });
      return;
    }
    if (acao === "estornar" || acao === "cancelar") {
      const id = String(body?.payment_identifier || "");
      if (!id) { res.status(400).json({ error: "payment_identifier ausente." }); return; }
      const path = acao === "estornar" ? "/commands/order/status/estornar" : "/commands/order/status/cancelar";
      const r = await tefPost(path, { payment_identifier: id });
      res.status(200).json({ ok: r.status >= 200 && r.status < 300, httpStatus: r.status, data: r.body });
      return;
    }
    res.status(400).json({ error: `Ação desconhecida: ${acao}` });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Falha ao falar com o Smart TEF." });
  }
}

function safeJson(s: string): Record<string, unknown> | null { try { return JSON.parse(s); } catch { return null; } }

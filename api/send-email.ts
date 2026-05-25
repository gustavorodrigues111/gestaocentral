// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — envia email transacional via Resend (https://resend.com).
//
//  POR QUE RESEND (e não Firebase Extension "Trigger Email"):
//    A extension Firebase precisa deployar uma Cloud Function v2, e a org
//    policy do Workspace `gestaocentral-85b13` bloqueia permissões necessárias
//    no service account de build do Cloud Functions. A mesma policy já tinha
//    bloqueado a criação de chaves de service account (ver prerender-sites.mjs).
//    Resend é HTTP puro, não depende de Cloud Functions, imune às policies.
//
//  FLUXO:
//    Cliente submete reserva → ReservasPublicaPage POSTa em /api/send-email
//    → essa função chama Resend API com a chave secreta (RESEND_API_KEY)
//    → Resend dispara email via SMTP próprio (com DKIM do domínio verificado).
//
//  POST /api/send-email
//    body: { to, replyTo?, subject, html, text? }
//    → 200 { id }                  (id do email no Resend pra rastrear)
//    → 4xx/5xx { error: string }
//
//  REQUISITOS (setup manual no painel da Resend):
//    1. Conta em resend.com
//    2. Domínio lobozo.com.br verificado em Domains (adicionar 3 registros DNS:
//       SPF, DKIM, MX feedback). Vai pra "Verified".
//    3. API Key (gerar em API Keys → Create) com escopo "Sending access"
//    4. Adicionar no Vercel: Project Settings → Environment Variables
//       - RESEND_API_KEY = re_xxxxxxxxxxxxx (only production+preview)
//       - RESEND_FROM_DEFAULT = "Lobozó <reservas@lobozo.com.br>" (opcional)
//
//  Domínio NÃO verificado? Em dev/teste pode usar from "onboarding@resend.dev"
//  — só envia pro mesmo email que cadastrou na conta Resend (limite anti-spam).
// ════════════════════════════════════════════════════════════════════════════

const RESEND_API = "https://api.resend.com/emails";
const REQ_TIMEOUT_MS = 15_000;
// Limite de tamanho pra não virar relay de spam — ninguém manda email
// de comprovante com 500KB de HTML.
const MAX_HTML_LEN = 200_000;
const MAX_TEXT_LEN = 50_000;
const MAX_SUBJECT_LEN = 300;

type VercelReq = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
  setHeader?: (k: string, v: string) => void;
};

type IncomingBody = {
  to?: unknown;
  replyTo?: unknown;
  from?: unknown;        // opcional — se omitido usa RESEND_FROM_DEFAULT
  subject?: unknown;
  html?: unknown;
  text?: unknown;
};

function badRequest(res: VercelRes, msg: string): void {
  res.status(400).json({ error: msg });
}

// Validação de email simples (não tenta cobrir 100% da RFC — só evita
// payloads visivelmente inválidos virarem chamada à Resend).
function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "RESEND_API_KEY não configurada nas env vars da Vercel.",
    });
    return;
  }

  // Body pode chegar como objeto (Vercel parseou) ou string (precisa parsear).
  let body: IncomingBody;
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body) as IncomingBody;
    } catch {
      badRequest(res, "Body precisa ser JSON válido.");
      return;
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as IncomingBody;
  } else {
    badRequest(res, "Body ausente.");
    return;
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : undefined;
  const replyTo = typeof body.replyTo === "string" ? body.replyTo.trim() : "";
  const fromOverride = typeof body.from === "string" ? body.from.trim() : "";

  if (!to || !isEmail(to)) { badRequest(res, "to inválido."); return; }
  if (!subject) { badRequest(res, "subject obrigatório."); return; }
  if (subject.length > MAX_SUBJECT_LEN) { badRequest(res, "subject muito longo."); return; }
  if (!html && !text) { badRequest(res, "html ou text obrigatório."); return; }
  if (html.length > MAX_HTML_LEN) { badRequest(res, "html muito grande."); return; }
  if (text && text.length > MAX_TEXT_LEN) { badRequest(res, "text muito grande."); return; }
  if (replyTo && !isEmail(replyTo)) { badRequest(res, "replyTo inválido."); return; }

  const from = fromOverride
    || process.env.RESEND_FROM_DEFAULT
    || "onboarding@resend.dev"; // fallback dev — só funciona pra email da conta

  // Monta payload no formato da Resend API
  // Docs: https://resend.com/docs/api-reference/emails/send-email
  const resendPayload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
  };
  if (html) resendPayload.html = html;
  if (text) resendPayload.text = text;
  if (replyTo) resendPayload.reply_to = replyTo;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const resp = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    if (!resp.ok) {
      // Resend devolve { name, message, statusCode } em erro
      const errMsg = (parsed && typeof parsed === "object" && "message" in parsed
        && typeof (parsed as { message: unknown }).message === "string")
        ? (parsed as { message: string }).message
        : `Resend retornou HTTP ${resp.status}`;
      res.status(502).json({ error: errMsg, resendStatus: resp.status, resendBody: parsed });
      return;
    }

    // Sucesso — Resend devolve { id: "re_xxxxx" }
    const id = (parsed && typeof parsed === "object" && "id" in parsed
      && typeof (parsed as { id: unknown }).id === "string")
      ? (parsed as { id: string }).id
      : "";
    res.status(200).json({ id });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      res.status(504).json({ error: `Timeout (${REQ_TIMEOUT_MS / 1000}s) chamando Resend.` });
      return;
    }
    res.status(500).json({
      error: e instanceof Error ? e.message : "Erro desconhecido chamando Resend.",
    });
  } finally {
    clearTimeout(timer);
  }
}

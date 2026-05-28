// ════════════════════════════════════════════════════════════════════════════
//  Vercel API Route — integração com a API v3 (Envelope) do Clicksign.
//
//  POR QUE SERVER-SIDE: o Access Token do Clicksign é SEGREDO e não pode ir pro
//  navegador. Toda chamada à API passa por aqui, que lê CLICKSIGN_ACCESS_TOKEN
//  das env vars da Vercel.
//
//  POR QUE POLLING (e não webhook→Firestore): a org policy do Workspace
//  gestaocentral-85b13 bloqueia a criação de chaves de service account (mesma
//  policy que barrou o Firebase Trigger Email — ver send-email.ts). Sem isso o
//  webhook não consegue escrever no Firestore via Admin SDK. Então o cliente
//  consulta o status (action "status") quando precisa, e baixa o assinado
//  (action "download") via proxy. Webhook fica como evolução futura.
//
//  POST /api/clicksign   body: { action, sandbox?, ...params }
//    action "criar":    { envelopeName, signer:{name,email,phone?}, docs:[{filename,base64}], message? }
//                        → { envelopeId, status }
//    action "status":   { envelopeId } → { status, documents:[{id,filename,status,signedUrl?}] }
//    action "download":  { envelopeId, documentId } → { filename, base64 }
//
//  ENV (Vercel → Project Settings → Environment Variables):
//    CLICKSIGN_ACCESS_TOKEN          (token de PRODUÇÃO — app.clicksign.com)
//    CLICKSIGN_ACCESS_TOKEN_SANDBOX  (opcional — sandbox.clicksign.com; testes)
//
//  Doc: https://developers.clicksign.com/docs (API v3 "Envelope")
// ════════════════════════════════════════════════════════════════════════════

const REQ_TIMEOUT_MS = 30_000;

type VercelReq = {
  method?: string;
  body?: unknown;
};
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

type Signer = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  documentation?: unknown;  // CPF
  birthday?: unknown;        // YYYY-MM-DD
  autoSignature?: unknown;   // assinatura automática (empresa)
};
type Doc = { filename?: unknown; base64?: unknown };

function host(sandbox: boolean): string {
  return sandbox ? "https://sandbox.clicksign.com" : "https://app.clicksign.com";
}
function tokenFor(sandbox: boolean): string | undefined {
  if (sandbox) {
    return process.env.CLICKSIGN_ACCESS_TOKEN_SANDBOX || process.env.CLICKSIGN_ACCESS_TOKEN;
  }
  return process.env.CLICKSIGN_ACCESS_TOKEN;
}

// Chamada genérica à API v3 do Clicksign (JSON:API). Lança Error com a msg da
// API em caso de !ok.
async function cs(
  sandbox: boolean,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const token = tokenFor(sandbox);
  if (!token) {
    throw new Error(
      "CLICKSIGN_ACCESS_TOKEN não configurada nas env vars da Vercel.",
    );
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(`${host(sandbox)}/api/v3${path}`, {
      method,
      headers: {
        Authorization: token,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let json: Record<string, unknown>;
    try {
      json = txt ? (JSON.parse(txt) as Record<string, unknown>) : {};
    } catch {
      json = { raw: txt };
    }
    if (!res.ok) {
      const errs = (json as { errors?: { detail?: string; title?: string }[] }).errors;
      const detail = errs?.[0]?.detail || errs?.[0]?.title || `HTTP ${res.status}`;
      throw new Error(`Clicksign (${res.status}): ${detail}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function dataId(json: Record<string, unknown>): string {
  const data = json.data as { id?: string } | undefined;
  return data?.id || "";
}

// content_base64 precisa do prefixo data URI. Garante que tenha.
function comoDataUri(base64: string): string {
  if (base64.startsWith("data:")) return base64;
  return `data:application/pdf;base64,${base64}`;
}

// ─── Fluxo: criar envelope completo + enviar pra assinatura ─────────────────
async function criarEnvelope(
  sandbox: boolean,
  envelopeName: string,
  signers: {
    name: string;
    email: string;
    phone?: string;
    documentation?: string;
    birthday?: string;
    autoSignature?: boolean;   // assinatura automática (empresa)
  }[],
  docs: { filename: string; base64: string }[],
  message?: string,
  metadata?: Record<string, unknown>,
): Promise<{ envelopeId: string; status: string }> {
  // 1) envelope
  const envAttrs: Record<string, unknown> = {
    name: envelopeName,
    locale: "pt-BR",
    auto_close: true,
  };
  if (message) envAttrs.default_message = message;
  const env = await cs(sandbox, "POST", "/envelopes", {
    data: { type: "envelopes", attributes: envAttrs },
  });
  const envelopeId = dataId(env);
  if (!envelopeId) throw new Error("Clicksign não retornou o id do envelope.");

  // 2) documentos (base64)
  const docIds: string[] = [];
  for (const d of docs) {
    const docAttrs: Record<string, unknown> = {
      filename: d.filename,
      content_base64: comoDataUri(d.base64),
    };
    if (metadata) docAttrs.metadata = metadata;
    const dr = await cs(sandbox, "POST", `/envelopes/${envelopeId}/documents`, {
      data: { type: "documents", attributes: docAttrs },
    });
    docIds.push(dataId(dr));
  }

  // 3) signatários (ex: empresa + empregado). Guarda id + método de auth de
  //    cada um (auto_signature pra empresa quando habilitado).
  const signerEntries: { id: string; auth: string }[] = [];
  for (const s of signers) {
    const attrs: Record<string, unknown> = { name: s.name, email: s.email };
    if (s.phone) attrs.phone_number = s.phone;
    if (s.documentation) attrs.documentation = s.documentation;
    if (s.birthday) attrs.birthday = s.birthday;
    if (s.documentation || s.birthday) attrs.has_documentation = true;
    const sr = await cs(sandbox, "POST", `/envelopes/${envelopeId}/signers`, {
      data: { type: "signers", attributes: attrs },
    });
    signerEntries.push({
      id: dataId(sr),
      auth: s.autoSignature ? "auto_signature" : "email",
    });
  }

  // 4) requisitos: cada documento × cada signatário (qualificação + autenticação)
  for (const docId of docIds) {
    for (const se of signerEntries) {
      const rels = {
        document: { data: { type: "documents", id: docId } },
        signer: { data: { type: "signers", id: se.id } },
      };
      await cs(sandbox, "POST", `/envelopes/${envelopeId}/requirements`, {
        data: { type: "requirements", attributes: { action: "agree", role: "sign" }, relationships: rels },
      });
      await cs(sandbox, "POST", `/envelopes/${envelopeId}/requirements`, {
        data: { type: "requirements", attributes: { action: "provide_evidence", auth: se.auth }, relationships: rels },
      });
    }
  }

  // 5) ativar (status running) — habilita a assinatura
  await cs(sandbox, "PATCH", `/envelopes/${envelopeId}`, {
    data: { id: envelopeId, type: "envelopes", attributes: { status: "running" } },
  });

  // 6) notificar signatários (dispara e-mail de solicitação de assinatura)
  await cs(sandbox, "POST", `/envelopes/${envelopeId}/notifications`, {
    data: { type: "notifications", attributes: {} },
  });

  return { envelopeId, status: "running" };
}

type DocResumo = { id: string; filename?: string; status?: string; signedUrl?: string };

function extrairSignedUrl(attrs: Record<string, unknown> | undefined): string | undefined {
  if (!attrs) return undefined;
  const downloads = attrs.downloads as { signed_file_url?: string } | undefined;
  return downloads?.signed_file_url || (attrs.signed_file_url as string | undefined);
}

async function statusEnvelope(
  sandbox: boolean,
  envelopeId: string,
): Promise<{ status: string; documents: DocResumo[] }> {
  const env = await cs(sandbox, "GET", `/envelopes/${envelopeId}`);
  const status = ((env.data as { attributes?: { status?: string } })?.attributes?.status) || "unknown";
  const docsRes = await cs(sandbox, "GET", `/envelopes/${envelopeId}/documents`);
  const arr = (docsRes.data as { id: string; attributes?: Record<string, unknown> }[]) || [];
  const documents: DocResumo[] = arr.map((d) => ({
    id: d.id,
    filename: d.attributes?.filename as string | undefined,
    status: d.attributes?.status as string | undefined,
    signedUrl: extrairSignedUrl(d.attributes),
  }));
  return { status, documents };
}

async function baixarAssinado(
  sandbox: boolean,
  envelopeId: string,
  documentId: string,
): Promise<{ filename: string; base64: string }> {
  const doc = await cs(sandbox, "GET", `/envelopes/${envelopeId}/documents/${documentId}`);
  const attrs = (doc.data as { attributes?: Record<string, unknown> })?.attributes;
  const rawUrl = extrairSignedUrl(attrs);
  if (!rawUrl) throw new Error("Documento ainda não tem arquivo assinado disponível.");
  // As URLs de download do Clicksign vêm RELATIVAS (ex:
  // "/2023/03/13/..._Clicksign.pdf") — precisam do host + token. Se já vier
  // absoluta (URL assinada de CDN), baixa direto sem header extra.
  const isRelative = !/^https?:\/\//i.test(rawUrl);
  const fetchUrl = isRelative ? host(sandbox) + rawUrl : rawUrl;
  const headers: Record<string, string> = {};
  if (isRelative) {
    const t = tokenFor(sandbox);
    if (t) headers.Authorization = t;
  }
  const fileRes = await fetch(fetchUrl, { headers });
  if (!fileRes.ok) throw new Error(`Falha ao baixar o assinado (HTTP ${fileRes.status}).`);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const filename = (attrs?.filename as string | undefined) || "documento-assinado.pdf";
  return { filename, base64: buf.toString("base64") };
}

export default async function handler(req: VercelReq, res: VercelRes): Promise<void> {
  if (req.method && req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }
  let body: Record<string, unknown>;
  if (typeof req.body === "string") {
    try { body = JSON.parse(req.body) as Record<string, unknown>; }
    catch { res.status(400).json({ error: "Body precisa ser JSON válido." }); return; }
  } else if (req.body && typeof req.body === "object") {
    body = req.body as Record<string, unknown>;
  } else {
    res.status(400).json({ error: "Body ausente." });
    return;
  }

  const action = typeof body.action === "string" ? body.action : "";
  const sandbox = body.sandbox === true;

  try {
    if (action === "criar") {
      const rawSigners = Array.isArray(body.signers) ? (body.signers as Signer[]) : [];
      const signers = rawSigners
        .map((s) => ({
          name: typeof s.name === "string" ? s.name.trim() : "",
          email: typeof s.email === "string" ? s.email.trim() : "",
          phone: typeof s.phone === "string" ? s.phone.trim() : undefined,
          documentation: typeof s.documentation === "string" ? s.documentation.trim() : undefined,
          birthday: typeof s.birthday === "string" ? s.birthday.trim() : undefined,
          autoSignature: s.autoSignature === true,
        }))
        .filter((s) => s.name && s.email);
      const envelopeName = typeof body.envelopeName === "string" ? body.envelopeName.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : undefined;
      const rawDocs = Array.isArray(body.docs) ? (body.docs as Doc[]) : [];
      const docs = rawDocs
        .map((d) => ({
          filename: typeof d.filename === "string" ? d.filename : "",
          base64: typeof d.base64 === "string" ? d.base64 : "",
        }))
        .filter((d) => d.filename && d.base64);

      if (!envelopeName) { res.status(400).json({ error: "envelopeName obrigatório." }); return; }
      if (signers.length === 0) { res.status(400).json({ error: "Nenhum signatário válido (name + email)." }); return; }
      if (docs.length === 0) { res.status(400).json({ error: "Nenhum documento válido (filename + base64)." }); return; }

      const externalId = typeof body.externalId === "string" ? body.externalId : "";
      const metadata = externalId
        ? { admissao_id: externalId, origem: "planejamento.app" }
        : undefined;
      const out = await criarEnvelope(
        sandbox, envelopeName, signers, docs, message, metadata,
      );
      res.status(200).json(out);
      return;
    }

    if (action === "status") {
      const envelopeId = typeof body.envelopeId === "string" ? body.envelopeId : "";
      if (!envelopeId) { res.status(400).json({ error: "envelopeId obrigatório." }); return; }
      res.status(200).json(await statusEnvelope(sandbox, envelopeId));
      return;
    }

    if (action === "download") {
      const envelopeId = typeof body.envelopeId === "string" ? body.envelopeId : "";
      const documentId = typeof body.documentId === "string" ? body.documentId : "";
      if (!envelopeId || !documentId) { res.status(400).json({ error: "envelopeId e documentId obrigatórios." }); return; }
      res.status(200).json(await baixarAssinado(sandbox, envelopeId, documentId));
      return;
    }

    res.status(400).json({ error: `action inválida: ${action || "(vazia)"}` });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      res.status(504).json({ error: `Timeout (${REQ_TIMEOUT_MS / 1000}s) chamando o Clicksign.` });
      return;
    }
    res.status(502).json({ error: e instanceof Error ? e.message : "Erro chamando o Clicksign." });
  }
}

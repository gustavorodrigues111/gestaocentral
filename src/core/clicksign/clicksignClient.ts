// ════════════════════════════════════════════════════════════════════════════
//  Cliente Clicksign (chama a função serverless /api/clicksign).
//
//  O Access Token do Clicksign NUNCA passa pelo navegador — fica server-side
//  na env var CLICKSIGN_ACCESS_TOKEN. Este módulo só conversa com o nosso
//  endpoint /api/clicksign, que repassa pra API v3 (Envelope) do Clicksign.
//
//  Sandbox: pra testar sem validade jurídica, setar VITE_CLICKSIGN_SANDBOX=true
//  (e CLICKSIGN_ACCESS_TOKEN_SANDBOX no servidor).
// ════════════════════════════════════════════════════════════════════════════

const CLICKSIGN_ENDPOINT = "/api/clicksign";

// Manda usar o ambiente sandbox do Clicksign (sem validade jurídica) — útil
// pra testar. Default produção.
export const CLICKSIGN_SANDBOX: boolean =
  (import.meta.env.VITE_CLICKSIGN_SANDBOX as string | undefined) === "true";

export type ClicksignSigner = { name: string; email: string; phone?: string };
export type ClicksignDoc = { filename: string; base64: string };
export type ClicksignDocResumo = {
  id: string;
  filename?: string;
  status?: string;
  signedUrl?: string;
};

async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(CLICKSIGN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, sandbox: CLICKSIGN_SANDBOX, ...payload }),
  });
  let json: unknown;
  try { json = await res.json(); } catch { json = {}; }
  if (!res.ok) {
    const err = (json as { error?: string })?.error;
    throw new Error(err || `Erro do Clicksign (HTTP ${res.status}).`);
  }
  return json as T;
}

// Cria o envelope, anexa os PDFs, adiciona o signatário, ativa e notifica.
export async function criarEnvelopeClicksign(payload: {
  envelopeName: string;
  signer: ClicksignSigner;
  docs: ClicksignDoc[];
  message?: string;
  externalId?: string;   // ex: admissao.id — vira metadata do documento
}): Promise<{ envelopeId: string; status: string }> {
  return call("criar", payload);
}

// Consulta o status atual do envelope + seus documentos.
export async function statusEnvelopeClicksign(
  envelopeId: string,
): Promise<{ status: string; documents: ClicksignDocResumo[] }> {
  return call("status", { envelopeId });
}

// Baixa (via proxy server-side) o PDF assinado de um documento → base64.
export async function baixarAssinadoClicksign(
  envelopeId: string,
  documentId: string,
): Promise<{ filename: string; base64: string }> {
  return call("download", { envelopeId, documentId });
}

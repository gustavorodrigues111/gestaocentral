// ════════════════════════════════════════════════════════════════════════════
//  _firestoreRest — grava no Firestore a partir do backend (Vercel) SEM
//  firebase-admin: minta um access token de uma service account (JWT RS256 via
//  node:crypto) e usa a REST API do Firestore. Usado pelo webhook do WhatsApp,
//  que é chamado pela Meta (sem usuário logado), então precisa escrever server-side.
//
//  Env var: FIREBASE_SERVICE_ACCOUNT — JSON da service account (ou base64 dele).
//  (Firebase Console → Configurações → Contas de serviço → Gerar nova chave.)
// ════════════════════════════════════════════════════════════════════════════
import crypto from "node:crypto";

type SA = { client_email: string; private_key: string; project_id?: string };

function getSA(): SA | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const txt = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(txt) as SA;
    return sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}

export function firestoreDisponivel(): boolean { return !!getSA(); }
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "gestaocentral-85b13";
const b64url = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let tokenCache: { token: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.token;
  const sa = getSA();
  if (!sa) throw new Error("FIREBASE_SERVICE_ACCOUNT não configurada.");
  const iat = Math.floor(now / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(Buffer.from(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 })));
  const signer = crypto.createSign("RSA-SHA256"); signer.update(`${header}.${claim}`); signer.end();
  const jwt = `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = (await resp.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error("Falha ao obter token da service account: " + (j.error_description || ""));
  tokenCache = { token: j.access_token, exp: now + 3500_000 };
  return j.access_token;
}

// Converte um valor JS pro formato de campo da REST API do Firestore.
function encVal(v: unknown): Record<string, unknown> | null {
  if (v === undefined) return null;
  if (v === null) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encVal).filter(Boolean) } };
  if (typeof v === "object") { const fields: Record<string, unknown> = {}; for (const [k, val] of Object.entries(v as object)) { const e = encVal(val); if (e) fields[k] = e; } return { mapValue: { fields } }; }
  return { stringValue: String(v) };
}

// Cria um doc com id conhecido. 409 (já existe) = ok (dedupe). Devolve true se gravou/existia.
export async function firestoreCriar(colecao: string, docId: string, obj: Record<string, unknown>): Promise<boolean> {
  const token = await accessToken();
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) { const e = encVal(v); if (e) fields[k] = e; }
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${colecao}?documentId=${encodeURIComponent(docId)}`;
  const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  if (resp.ok || resp.status === 409) return true;
  const t = await resp.text();
  throw new Error(`Firestore ${resp.status}: ${t.slice(0, 200)}`);
}

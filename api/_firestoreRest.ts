// ════════════════════════════════════════════════════════════════════════════
//  _firestoreRest — grava no Firestore a partir do backend (Vercel) SEM
//  firebase-admin e SEM service-account key (a org bloqueia criação de chaves
//  de SA via política iam.disableServiceAccountKeyCreation).
//
//  Em vez disso, o backend faz login como um USUÁRIO DE SERVIÇO do Firebase Auth
//  (o mesmo Auth que o app já usa), pega um ID token via Identity Toolkit e usa
//  a REST API do Firestore com esse token — que respeita as security rules
//  (as coleções do webhook liberam write pra qualquer usuário autenticado).
//  Usado pelo webhook do WhatsApp, chamado pela Meta (sem usuário logado).
//
//  Env vars:
//   - WEBHOOK_FB_EMAIL      → email do usuário de serviço (criado no Firebase Auth)
//   - WEBHOOK_FB_PASSWORD   → senha desse usuário
//   - FIREBASE_WEB_API_KEY  → API key web (fallback: VITE_FIREBASE_API_KEY, já na Vercel)
// ════════════════════════════════════════════════════════════════════════════

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "gestaocentral-85b13";
const API_KEY = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
const SVC_EMAIL = process.env.WEBHOOK_FB_EMAIL || "";
const SVC_PASSWORD = process.env.WEBHOOK_FB_PASSWORD || "";

export function firestoreDisponivel(): boolean {
  return !!(API_KEY && SVC_EMAIL && SVC_PASSWORD);
}

// ─── ID token do usuário de serviço (cache com expiração) ───────────────────
let tokenCache: { token: string; exp: number } | null = null;
async function idToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.exp > now + 60_000) return tokenCache.token;
  if (!firestoreDisponivel()) throw new Error("Credenciais do webhook não configuradas (WEBHOOK_FB_EMAIL/PASSWORD).");
  const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SVC_EMAIL, password: SVC_PASSWORD, returnSecureToken: true }),
  });
  const j = (await resp.json()) as { idToken?: string; expiresIn?: string; error?: { message?: string } };
  if (!j.idToken) throw new Error("Falha no login do usuário de serviço: " + (j.error?.message || resp.status));
  const ttlMs = (parseInt(j.expiresIn || "3600", 10) || 3600) * 1000;
  tokenCache = { token: j.idToken, exp: now + ttlMs };
  return j.idToken;
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

// Converte um campo da REST API do Firestore de volta pra valor JS.
function decVal(f: Record<string, unknown>): unknown {
  if (f == null) return null;
  if ("nullValue" in f) return null;
  if ("booleanValue" in f) return f.booleanValue;
  if ("integerValue" in f) return Number(f.integerValue);
  if ("doubleValue" in f) return f.doubleValue;
  if ("stringValue" in f) return f.stringValue;
  if ("timestampValue" in f) return f.timestampValue;
  if ("arrayValue" in f) { const a = (f.arrayValue as { values?: Array<Record<string, unknown>> }).values || []; return a.map(decVal); }
  if ("mapValue" in f) { const m = (f.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields || {}; const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(m)) o[k] = decVal(v); return o; }
  return null;
}
function decDoc(doc: { name?: string; fields?: Record<string, Record<string, unknown>> }): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const f = doc.fields || {};
  for (const [k, v] of Object.entries(f)) o[k] = decVal(v);
  o.id = (doc.name || "").split("/").pop();
  return o;
}

// Lista todos os docs de uma coleção (pagina automático). Uso interno (cron).
export async function firestoreListar(colecao: string): Promise<Array<Record<string, unknown>>> {
  const token = await idToken();
  const out: Array<Record<string, unknown>> = [];
  let pageToken = "";
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${colecao}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Firestore listar ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
    const j = (await resp.json()) as { documents?: Array<{ name?: string; fields?: Record<string, Record<string, unknown>> }>; nextPageToken?: string };
    for (const d of j.documents || []) out.push(decDoc(d));
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

// Lê um doc por id. null se não existe (404).
export async function firestoreLer(colecao: string, docId: string): Promise<Record<string, unknown> | null> {
  const token = await idToken();
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${colecao}/${encodeURIComponent(docId)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`Firestore ler ${resp.status}`);
  return decDoc((await resp.json()) as { name?: string; fields?: Record<string, Record<string, unknown>> });
}

// Atualiza (merge) campos de um doc existente via PATCH + updateMask.
// Só mexe nos campos passados; cria o doc se não existir.
export async function firestoreAtualizar(colecao: string, docId: string, obj: Record<string, unknown>): Promise<boolean> {
  const token = await idToken();
  const fields: Record<string, unknown> = {};
  const mask: string[] = [];
  for (const [k, v] of Object.entries(obj)) { const e = encVal(v); if (e) { fields[k] = e; mask.push(k); } }
  const maskQs = mask.map(m => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${colecao}/${encodeURIComponent(docId)}?${maskQs}`;
  const resp = await fetch(url, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  if (resp.ok) return true;
  const t = await resp.text();
  throw new Error(`Firestore PATCH ${resp.status}: ${t.slice(0, 200)}`);
}

// Cria um doc com id conhecido. 409 (já existe) = ok (dedupe). Devolve true se gravou/existia.
export async function firestoreCriar(colecao: string, docId: string, obj: Record<string, unknown>): Promise<boolean> {
  const token = await idToken();
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) { const e = encVal(v); if (e) fields[k] = e; }
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${colecao}?documentId=${encodeURIComponent(docId)}`;
  const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
  if (resp.ok || resp.status === 409) return true;
  const t = await resp.text();
  throw new Error(`Firestore ${resp.status}: ${t.slice(0, 200)}`);
}

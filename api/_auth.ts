// ════════════════════════════════════════════════════════════════════════════
//  Verificação do Firebase ID token nos endpoints, SEM Admin SDK e SEM libs
//  externas — usa só o crypto nativo do Node (zero risco de bundling/ESM na
//  Vercel; a tentativa anterior com `jose` derrubava a function).
//
//  Valida a assinatura RS256 do token contra as chaves públicas do Google
//  (x509 do securetoken) + issuer/audience/exp do projeto. Garante que quem
//  chama o endpoint é um usuário LOGADO do app. Devolve uid/email p/ auditoria.
//
//  Arquivo prefixado com "_" → a Vercel NÃO o expõe como rota.
// ════════════════════════════════════════════════════════════════════════════
import crypto from "node:crypto";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "gestaocentral-85b13";
const CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

export type UsuarioAuth = { uid: string; email?: string };

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type ReqComHeaders = { headers?: Record<string, string | string[] | undefined> };

// Cache simples das chaves públicas do Google (rotacionam de tempos em tempos).
let certsCache: { certs: Record<string, string>; exp: number } | null = null;
async function getCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (certsCache && certsCache.exp > now) return certsCache.certs;
  const resp = await fetch(CERTS_URL);
  if (!resp.ok) throw new AuthError("Não consegui buscar as chaves públicas do Google.");
  const certs = (await resp.json()) as Record<string, string>;
  certsCache = { certs, exp: now + 3600_000 }; // 1h
  return certs;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64urlJson(s: string): Record<string, unknown> {
  return JSON.parse(b64urlToBuf(s).toString("utf8")) as Record<string, unknown>;
}

export async function requireUser(req: ReqComHeaders): Promise<UsuarioAuth> {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AuthError("Faça login no app — token de autenticação ausente.");
  }
  const token = header.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Token malformado.");

  let head: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    head = b64urlJson(parts[0]);
    payload = b64urlJson(parts[1]);
  } catch {
    throw new AuthError("Token ilegível.");
  }
  if (head.alg !== "RS256") throw new AuthError("Algoritmo do token inesperado.");

  // Assinatura.
  const certs = await getCerts();
  const cert = certs[String(head.kid)];
  if (!cert) throw new AuthError("Chave do token não encontrada (kid).");
  let ok = false;
  try {
    const pub = new crypto.X509Certificate(cert).publicKey;
    ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), pub, b64urlToBuf(parts[2]));
  } catch {
    throw new AuthError("Falha ao validar a assinatura do token.");
  }
  if (!ok) throw new AuthError("Assinatura do token inválida.");

  // Claims.
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) throw new AuthError("Issuer do token inválido.");
  if (payload.aud !== PROJECT_ID) throw new AuthError("Audience do token inválido.");
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) throw new AuthError("Token expirado. Recarregue o app.");
  const uid = (payload.sub || (payload as { user_id?: string }).user_id) as string | undefined;
  if (!uid) throw new AuthError("Token sem identidade (uid).");
  return { uid, email: typeof payload.email === "string" ? payload.email : undefined };
}

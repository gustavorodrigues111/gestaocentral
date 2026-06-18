// ════════════════════════════════════════════════════════════════════════════
//  Verificação do Firebase ID token nos endpoints, SEM Admin SDK.
//
//  Valida a assinatura RS256 do token contra as chaves públicas do Google
//  (JWKS do securetoken) + issuer/audience do projeto. Garante que quem chama
//  o endpoint é um usuário LOGADO do app — fecha a exposição "aberta na internet"
//  dos dados de ponto. Devolve uid/email pra auditoria.
//
//  Não verifica acesso por restaurante (isso exigiria as permissões no Firestore,
//  que a Vercel não lê sem Admin SDK) — esse nível fica pro perfil de acesso no
//  app (client-side) e, no futuro, por Firebase Functions.
//
//  Arquivo prefixado com "_" → a Vercel NÃO o expõe como rota.
// ════════════════════════════════════════════════════════════════════════════
import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "gestaocentral-85b13";
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export type UsuarioAuth = { uid: string; email?: string };

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type ReqComHeaders = { headers?: Record<string, string | string[] | undefined> };

export async function requireUser(req: ReqComHeaders): Promise<UsuarioAuth> {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AuthError("Faça login no app — token de autenticação ausente.");
  }
  const token = header.slice(7).trim();
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
      algorithms: ["RS256"],
    });
    const uid = (payload.sub || (payload as { user_id?: string }).user_id) as string | undefined;
    if (!uid) throw new AuthError("Token sem identidade (uid).");
    return { uid, email: typeof payload.email === "string" ? payload.email : undefined };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError("Token inválido ou expirado. Recarregue o app e tente de novo.");
  }
}

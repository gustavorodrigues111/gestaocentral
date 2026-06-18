// Header de autenticação pros endpoints (api/solides-*): manda o Firebase ID
// token do usuário logado. O servidor valida (api/_auth) — garante que só
// usuário logado do app chama os endpoints de ponto.
import { auth } from "./config";

export async function authHeader(): Promise<Record<string, string>> {
  const u = auth.currentUser;
  if (!u) return {};
  try {
    const t = await u.getIdToken();
    return { Authorization: `Bearer ${t}` };
  } catch {
    return {};
  }
}

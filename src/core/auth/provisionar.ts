// Provisiona o acesso de uma pessoa SEM deslogar o admin logado.
// Padrão "app secundário": cria a conta no Firebase Auth numa segunda instância
// do app (o Auth do admin fica na instância primária, intacto). Assim dá pra o
// sistema criar a conta + gerar a senha inicial no cliente, sem Admin SDK (que
// está bloqueado pela org policy do Workspace).
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { app } from "../firebase/config";

export type ResultadoProvisao =
  | { ok: true; uid: string }
  | { ok: false; motivo: "email_em_uso" | "email_invalido" | "senha_fraca" | "erro"; detalhe?: string };

// Gera uma senha inicial legível (evita 0/O, 1/l/I) com 8 caracteres.
export function gerarSenhaInicial(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) s += chars[buf[i] % chars.length];
  return s;
}

export async function provisionarAcesso(email: string, senha: string): Promise<ResultadoProvisao> {
  const nome = `prov-${Date.now()}`;
  const secApp = initializeApp(app.options, nome);
  try {
    // App Check espelhado (se o primário usa) pra não ser barrado.
    const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    if (siteKey) {
      try { initializeAppCheck(secApp, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: false }); } catch { /* ok */ }
    }
    const secAuth = getAuth(secApp);
    const cred = await createUserWithEmailAndPassword(secAuth, email.trim().toLowerCase(), senha);
    const uid = cred.user.uid;
    await signOut(secAuth).catch(() => {});
    return { ok: true, uid };
  } catch (e) {
    const code = (e as { code?: string })?.code || "";
    if (code === "auth/email-already-in-use") return { ok: false, motivo: "email_em_uso" };
    if (code === "auth/invalid-email") return { ok: false, motivo: "email_invalido" };
    if (code === "auth/weak-password") return { ok: false, motivo: "senha_fraca" };
    return { ok: false, motivo: "erro", detalhe: e instanceof Error ? e.message : String(e) };
  } finally {
    await deleteApp(secApp).catch(() => {});
  }
}

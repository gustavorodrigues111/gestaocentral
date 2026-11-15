// Pareamento da maquininha por CÓDIGO (login sem digitar senha).
//
// O aparelho entra ANÔNIMO numa 2ª instância do Firebase (a instância primária
// fica deslogada, então a tela de login não sai do ar), cria um pedido em
// `pareamentosMaquina` com o próprio uid anônimo e mostra um código. O master
// acha pelo código e aprova na retaguarda; a Cloud Function cunha um custom
// token e grava no doc; o aparelho (dono do doc) lê o token e faz
// signInWithCustomToken na instância PRIMÁRIA → fica logado como a conta da
// máquina. O token só é legível pelo dono anônimo (regra) — nada exposto.
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, signInAnonymously, signInWithCustomToken } from "firebase/auth";
import { getFirestore, addDoc, collection, onSnapshot } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { app, auth as primaryAuth } from "../firebase/config";

function deviceIdLocal(): string {
  try {
    let id = localStorage.getItem("etiq_device_id");
    if (!id) { id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; localStorage.setItem("etiq_device_id", id); }
    return id;
  } catch { return "dev_tmp"; }
}

function gerarCodigo(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

export type IniciarPareamentoOpts = {
  onCodigo: (codigo: string) => void;
  onErro: (msg: string) => void;
  onSucesso: () => void;   // já logou na instância primária
};

/** Inicia o pareamento. Retorna uma função pra cancelar. */
export async function iniciarPareamento(opts: IniciarPareamentoOpts): Promise<() => void> {
  const secApp = initializeApp(app.options, `pair-${Date.now()}`);
  let unsub: (() => void) | null = null;
  let encerrado = false;
  const limpar = async () => {
    if (unsub) { unsub(); unsub = null; }
    try { await deleteApp(secApp); } catch { /* ok */ }
  };
  const cancelar = () => { if (!encerrado) { encerrado = true; void limpar(); } };

  try {
    const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
    if (siteKey) { try { initializeAppCheck(secApp, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: false }); } catch { /* ok */ } }

    const secAuth = getAuth(secApp);
    let anonUid: string;
    try {
      const cred = await signInAnonymously(secAuth);
      anonUid = cred.user.uid;
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      await limpar();
      if (code === "auth/operation-not-allowed") opts.onErro("O 'Login anônimo' não está ligado no Firebase. Ligue em Authentication › Sign-in method e tente de novo.");
      else opts.onErro("Não consegui iniciar o pareamento. Verifique a internet.");
      return cancelar;
    }

    const secDb = getFirestore(secApp);
    const codigo = gerarCodigo();
    const ref = await addDoc(collection(secDb, "pareamentosMaquina"), {
      anonUid, deviceId: deviceIdLocal(), codigo, status: "aguardando", criadoEm: new Date().toISOString(),
    });
    if (encerrado) { await limpar(); return cancelar; }
    opts.onCodigo(codigo);

    unsub = onSnapshot(ref, async (snap) => {
      const d = snap.data() as { status?: string; customToken?: string; rid?: string; erro?: string } | undefined;
      if (!d || encerrado) return;
      if (d.status === "pronto" && d.customToken) {
        encerrado = true;
        if (unsub) { unsub(); unsub = null; }
        try {
          if (d.rid) { try { localStorage.setItem("etiq_kiosk_rid", d.rid); } catch { /* sem storage */ } }
          await signInWithCustomToken(primaryAuth, d.customToken);
          await limpar();
          opts.onSucesso();
        } catch {
          await limpar();
          opts.onErro("Não deu pra entrar com este pareamento (pode ter expirado). Gere um novo.");
        }
      } else if (d.status === "erro") {
        encerrado = true;
        await limpar();
        opts.onErro(d.erro || "Falha ao vincular.");
      }
    }, async () => { encerrado = true; await limpar(); opts.onErro("Erro ao acompanhar o pareamento."); });

    return cancelar;
  } catch (e) {
    await limpar();
    opts.onErro(e instanceof Error ? e.message : "Falha ao parear.");
    return cancelar;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Cloud Functions — reset de senha de acesso (operação de Auth admin).
//
//  Roda como `firebase-adminsdk-fbsvc@` (já tem roles/firebaseauth.admin) via
//  ADC — SEM chave de service account. Redefine a senha de uma conta EXISTENTE,
//  coisa impossível no cliente.
//
//  ARQUITETURA por GATILHO (não callable): a org bloqueia deixar função pública
//  (`allUsers` invoker, exigido por callable no navegador — Domain Restricted
//  Sharing). Então:
//    1. o master grava um doc em `resetSenhaRequests` (regras: só o próprio uid);
//    2. este trigger dispara (Eventarc, sem invoker público), CONFERE se quem
//       pediu é master, reseta a senha e marca `mustTrocarSenha` na pessoa;
//    3. escreve a senha temporária de volta no MESMO doc → o cliente lê e
//       mostra pro master (que pode testar o login) e apaga o doc em seguida.
// ════════════════════════════════════════════════════════════════════════════
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";

admin.initializeApp();

setGlobalOptions({
  region: "southamerica-east1",
  serviceAccount: "firebase-adminsdk-fbsvc@gestaocentral-85b13.iam.gserviceaccount.com",
});

function gerarSenha(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[bytes[i] % chars.length];
  return s;
}

type PessoaDoc = { id: string; isMaster?: boolean; email?: string; uidVinculado?: string; nome?: string };

// Acha a Pessoa de quem pediu (mesma lógica do AuthContext: uidVinculado →
// docId → email). Usada pra confirmar que é master.
async function acharPessoaPorUid(
  db: admin.firestore.Firestore,
  uid: string,
  email?: string,
): Promise<PessoaDoc | null> {
  if (uid) {
    const q1 = await db.collection("pessoas").where("uidVinculado", "==", uid).limit(1).get();
    if (!q1.empty) return { id: q1.docs[0].id, ...(q1.docs[0].data() as object) } as PessoaDoc;
    const d = await db.collection("pessoas").doc(uid).get();
    if (d.exists) return { id: d.id, ...(d.data() as object) } as PessoaDoc;
  }
  if (email) {
    const q2 = await db.collection("pessoas").where("email", "==", email.toLowerCase()).limit(1).get();
    if (!q2.empty) return { id: q2.docs[0].id, ...(q2.docs[0].data() as object) } as PessoaDoc;
  }
  return null;
}

export const processarResetSenha = onDocumentCreated("resetSenhaRequests/{id}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const req = snap.data() as {
    pessoaId?: string; solicitadoPorUid?: string; solicitadoPorEmail?: string; status?: string;
  };
  if (req.status && req.status !== "pendente") return; // idempotência

  const db = admin.firestore();
  const erro = (msg: string) =>
    snap.ref.update({ status: "erro", erro: msg, resolvidoEm: new Date().toISOString() });

  try {
    const caller = await acharPessoaPorUid(db, req.solicitadoPorUid || "", req.solicitadoPorEmail);
    if (!caller?.isMaster) { await erro("Só um master pode redefinir a senha de acesso."); return; }

    const pessoaId = (req.pessoaId || "").toString();
    if (!pessoaId) { await erro("pessoaId ausente."); return; }

    const alvoSnap = await db.collection("pessoas").doc(pessoaId).get();
    if (!alvoSnap.exists) { await erro("Pessoa não encontrada."); return; }
    const alvo = alvoSnap.data() as PessoaDoc;
    const email = (alvo.email || "").trim().toLowerCase();
    if (!email) { await erro("Essa pessoa não tem email — cadastre um antes."); return; }

    let userRec: admin.auth.UserRecord;
    try {
      userRec = await admin.auth().getUserByEmail(email);
    } catch {
      await erro("Essa pessoa ainda não tem conta de acesso. Use 'Convidar pra acessar' primeiro.");
      return;
    }

    const novaSenha = gerarSenha();
    await admin.auth().updateUser(userRec.uid, { password: novaSenha, disabled: false });
    await alvoSnap.ref.update({
      mustTrocarSenha: true,
      senhaRedefinidaEm: new Date().toISOString(),
      senhaRedefinidaPor: caller.id,
    });

    await snap.ref.update({
      status: "ok",
      senhaTemporaria: novaSenha,
      emailAlvo: email,
      resolvidoEm: new Date().toISOString(),
    });
  } catch (e) {
    await erro(e instanceof Error ? e.message : "Erro inesperado ao redefinir senha.");
  }
});

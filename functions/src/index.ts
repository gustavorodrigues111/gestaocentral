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
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
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

// ════════════════════════════════════════════════════════════════════════════
//  permUsuario — resumo de permissão POR LOGIN (uid), pra as regras do Firestore
//  travarem leitura no SERVIDOR (não só na UI).
//
//  Problema: as regras não sabem mapear uid → pessoa → permissão (uid ≠ pessoaId;
//  permissão vem do perfil). Solução: este gatilho (Admin SDK, cliente NÃO pode
//  forjar) mantém `permUsuario/{uid}` = { pessoaId, isMaster, perms{modulo:{acao:
//  [rids]}} }. As regras leem via get() e checam `rid in perms.modulo.acao`.
//
//  Fonte da verdade = pessoa.profileIds[rid] → perfil (accessProfiles no Firestore,
//  ou built-in Portal Empregado embutido). FAIL-CLOSED: perfil não resolvido = sem
//  acesso (direção segura). Regenera on-write de pessoas e de accessProfiles, e há
//  um rebuild em lote (escreve doc em permUsuarioRebuild) pra backfill.
// ════════════════════════════════════════════════════════════════════════════

// Único built-in que NÃO é semeado no Firestore (e não dá acesso sensível).
// Os demais perfis (Gerente e custom) vivem em /accessProfiles.
const PORTAL_EMPREGADO_PERMS: Record<string, Record<string, unknown>> = {
  portalEmpregado: { acessar: true, verMinhaEscala: true, verMeusHorarios: true, verMinhaGorjeta: true, acessarFaleComDP: true },
};

async function resolverProfilePerms(
  db: admin.firestore.Firestore,
  profileId: string | undefined,
): Promise<Record<string, Record<string, unknown>>> {
  if (!profileId) return {};
  const d = await db.collection("accessProfiles").doc(profileId).get();
  if (d.exists) return ((d.data() as { permissions?: Record<string, Record<string, unknown>> }).permissions) || {};
  if (profileId === "_builtin_portal_empregado") return PORTAL_EMPREGADO_PERMS;
  // Gerente não-semeado ou id desconhecido: fail-closed (sem perms).
  return {};
}

type PessoaPerm = { id: string; uidVinculado?: string; isMaster?: boolean; restaurantIds?: string[]; profileIds?: Record<string, string> };

async function computarPerms(
  db: admin.firestore.Firestore,
  pessoa: PessoaPerm,
): Promise<Record<string, Record<string, string[]>>> {
  const perms: Record<string, Record<string, string[]>> = {};
  const rids = Array.isArray(pessoa.restaurantIds) ? pessoa.restaurantIds : [];
  const profileIds = pessoa.profileIds || {};
  const cache: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const rid of rids) {
    const pid = profileIds[rid];
    if (!pid) continue;
    if (!cache[pid]) cache[pid] = await resolverProfilePerms(db, pid);
    const pp = cache[pid];
    for (const [mod, acoes] of Object.entries(pp)) {
      if (!acoes || typeof acoes !== "object") continue;
      for (const [acao, val] of Object.entries(acoes)) {
        if (val === true) {
          (perms[mod] = perms[mod] || {});
          (perms[mod][acao] = perms[mod][acao] || []);
          if (!perms[mod][acao].includes(rid)) perms[mod][acao].push(rid);
        }
      }
    }
  }
  return perms;
}

async function gerarPermUsuario(db: admin.firestore.Firestore, pessoa: PessoaPerm): Promise<void> {
  const uid = pessoa.uidVinculado;
  if (!uid) return;   // sem conta de acesso → não há uid pra travar
  const perms = await computarPerms(db, pessoa);
  await db.collection("permUsuario").doc(uid).set({
    pessoaId: pessoa.id,
    isMaster: pessoa.isMaster === true,
    perms,
    restaurantIds: Array.isArray(pessoa.restaurantIds) ? pessoa.restaurantIds : [],
    atualizadoEm: new Date().toISOString(),
  });
}

// Pessoa mudou (perfil/vínculo/uid/master) → regenera o resumo dela.
export const syncPermUsuarioPessoa = onDocumentWritten("pessoas/{id}", async (event) => {
  const after = event.data?.after;
  if (!after || !after.exists) return;
  await gerarPermUsuario(admin.firestore(), { id: after.id, ...(after.data() as object) } as PessoaPerm);
});

// Um perfil de acesso mudou → regenera todos que usam esse perfil.
export const syncPermUsuarioPerfil = onDocumentWritten("accessProfiles/{id}", async (event) => {
  const db = admin.firestore();
  const profileId = event.params.id as string;
  const snap = await db.collection("pessoas").get();
  for (const doc of snap.docs) {
    const p = { id: doc.id, ...(doc.data() as object) } as PessoaPerm;
    if (!p.uidVinculado) continue;
    if (Object.values(p.profileIds || {}).includes(profileId)) await gerarPermUsuario(db, p);
  }
});

// Backfill em lote: master grava um doc em permUsuarioRebuild → regenera TODOS.
export const rebuildPermUsuario = onDocumentCreated("permUsuarioRebuild/{id}", async (event) => {
  const db = admin.firestore();
  const snap = await db.collection("pessoas").get();
  let n = 0;
  for (const doc of snap.docs) {
    const p = { id: doc.id, ...(doc.data() as object) } as PessoaPerm;
    if (!p.uidVinculado) continue;
    await gerarPermUsuario(db, p);
    n++;
  }
  const s = event.data;
  if (s) await s.ref.set({ status: "ok", gerados: n, resolvidoEm: new Date().toISOString() }, { merge: true });
});

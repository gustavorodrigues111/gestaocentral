// ════════════════════════════════════════════════════════════════════════════
//  _whatsappAuth — autorização POR NÚMERO nos endpoints do WhatsApp.
//
//  O front já esconde os números que o usuário não pode ver (usuariosIds /
//  perfil de acesso), mas os endpoints só validavam o token (estar logado).
//  Aqui repetimos a checagem NO SERVIDOR: o uid do token vira a pessoa do app
//  e conferimos se ela é master ou está em whatsappNumeros/{instancia}.usuariosIds.
//
//  Fail-open SÓ se o Firestore de serviço não estiver configurado (mantém o
//  comportamento antigo em vez de derrubar o envio). Prefixo "_" → não vira rota.
// ════════════════════════════════════════════════════════════════════════════
import { firestoreLer, firestoreConsultarUm, firestoreDisponivel } from "./_firestoreRest.js";
import type { UsuarioAuth } from "./_auth.js";

export type NumAuth = { permitido: boolean; master: boolean; pessoaId: string | null; motivo?: string };

type PessoaMin = { id: string; isMaster: boolean };
// Caches em memória do lambda (reduzem leituras: envio/ação acontecem em ritmo
// humano, mas o container quente reaproveita). pessoa: 5min; número: 60s.
const pessoaCache = new Map<string, { v: PessoaMin | null; exp: number }>();
const numeroCache = new Map<string, { uids: string[]; exp: number }>();

// uid do Firebase → pessoa do app. Direto (pessoas/{uid}) ou vínculo por
// uidVinculado / email (mesmo mapeamento do AuthContext do front).
async function resolverPessoa(u: UsuarioAuth): Promise<PessoaMin | null> {
  const hit = pessoaCache.get(u.uid);
  if (hit && hit.exp > Date.now()) return hit.v;
  let v: PessoaMin | null = null;
  const direto = await firestoreLer("pessoas", u.uid);
  if (direto) v = { id: u.uid, isMaster: !!direto.isMaster };
  else {
    let p = await firestoreConsultarUm("pessoas", "uidVinculado", u.uid);
    if (!p && u.email) p = await firestoreConsultarUm("pessoas", "email", u.email);
    if (p && p.id) v = { id: String(p.id), isMaster: !!p.isMaster };
  }
  pessoaCache.set(u.uid, { v, exp: Date.now() + 5 * 60_000 });
  return v;
}

async function usuariosDoNumero(instancia: string): Promise<string[]> {
  const hit = numeroCache.get(instancia);
  if (hit && hit.exp > Date.now()) return hit.uids;
  const num = await firestoreLer("whatsappNumeros", instancia);
  const uids = Array.isArray(num?.usuariosIds) ? (num!.usuariosIds as string[]) : [];
  numeroCache.set(instancia, { uids, exp: Date.now() + 60_000 });
  return uids;
}

// Autoriza o uso de UM número. `exigirMaster` = ação destrutiva (só master).
export async function autorizarNumero(u: UsuarioAuth, instancia: string, exigirMaster = false): Promise<NumAuth> {
  // Sem credenciais de serviço no backend → não dá pra checar; mantém o antigo.
  if (!firestoreDisponivel()) return { permitido: true, master: false, pessoaId: null, motivo: "sem-verificacao" };
  let pessoa: { id: string; isMaster: boolean } | null;
  try { pessoa = await resolverPessoa(u); }
  catch { return { permitido: true, master: false, pessoaId: null, motivo: "sem-verificacao" }; }  // erro de leitura → não trava o envio
  if (!pessoa) return { permitido: false, master: false, pessoaId: null, motivo: "Usuário não encontrado no sistema." };
  if (pessoa.isMaster) return { permitido: true, master: true, pessoaId: pessoa.id };
  if (exigirMaster) return { permitido: false, master: false, pessoaId: pessoa.id, motivo: "Só o master pode fazer isso." };
  const uids = await usuariosDoNumero(instancia);
  const ok = uids.includes(pessoa.id);
  return { permitido: ok, master: false, pessoaId: pessoa.id, motivo: ok ? undefined : "Você não tem acesso a este número do WhatsApp." };
}

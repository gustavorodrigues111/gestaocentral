// ════════════════════════════════════════════════════════════════════════════
//  Status de acesso de uma Pessoa num restaurante específico.
//
//  Retorna ARRAY de badges — múltiplas pendências podem coexistir (ex: falta
//  email + falta CPF + precisa de perfil). Estados terminais (Inativa, Master,
//  Pronto) curto-circuitam — quando algum deles vale, retorna só ele.
//
//  Ordem de avaliação:
//    1. Inativa             [terminal — único]
//    2. Master              [terminal — único]
//    3. Falta email         [soma]
//    4. Falta CPF           [soma]
//    5. Precisa de perfil   [soma]
//    6. Precisa empregado   [soma] (só se perfil dá portal mas sem /empregados)
//    7. Nunca logou         [soma]
//    8. Pronto              [terminal — único; só quando nenhum dos somáveis acima]
// ════════════════════════════════════════════════════════════════════════════

import type { AccessProfile, Empregado, Pessoa } from "../../core/types";
import { resolverPerfil } from "../../core/auth/permissions";

export type AccessStatus =
  | "inativa"
  | "master"
  | "falta_email"
  | "falta_cpf"
  | "precisa_perfil"
  | "precisa_empregado"
  | "nunca_logou"
  | "pronto";

export type AccessBadge = {
  status: AccessStatus;
  label: string;
  tooltip: string;
  /** Classes Tailwind pro pill (bg + text). */
  classes: string;
};

const BADGE_INATIVA: AccessBadge = {
  status: "inativa",
  label: "Inativa",
  tooltip: "Pessoa desativada. Reative no editor pra dar acesso novamente.",
  classes: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};
const BADGE_MASTER: AccessBadge = {
  status: "master",
  label: "Master",
  tooltip: "Master tem acesso total ao sistema (bypass de perfis e restaurantes).",
  classes: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};
const BADGE_PRONTO: AccessBadge = {
  status: "pronto",
  label: "Pronto",
  tooltip: "Pessoa tem login, perfil atribuído e já acessou o sistema.",
  classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};
const BADGE_FALTA_EMAIL: AccessBadge = {
  status: "falta_email",
  label: "Falta email",
  tooltip: "Sem email, ela não consegue fazer login no sistema.",
  classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
const BADGE_FALTA_CPF: AccessBadge = {
  status: "falta_cpf",
  label: "Falta CPF",
  tooltip: "Sem CPF, identidade incompleta (necessária pra Sólides e auditoria).",
  classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
const BADGE_PRECISA_PERFIL: AccessBadge = {
  status: "precisa_perfil",
  label: "Precisa de perfil",
  tooltip: "Pessoa vai logar mas vê tela vazia — sem perfil de acesso atribuído neste restaurante.",
  classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
const BADGE_PRECISA_EMPREGADO: AccessBadge = {
  status: "precisa_empregado",
  label: "Precisa empregado",
  tooltip: "Perfil dá acesso ao Portal do Empregado mas a pessoa não está cadastrada como empregada deste restaurante.",
  classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};
const BADGE_NUNCA_LOGOU: AccessBadge = {
  status: "nunca_logou",
  label: "Nunca logou",
  tooltip: "Tudo configurado, mas a pessoa nunca acessou o sistema. Manda o link de acesso ou peça pra entrar.",
  classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
};

/**
 * Resolve o(s) status de acesso da pessoa. Sempre retorna pelo menos 1 badge.
 * - Inativa / Master / Pronto: array com 1 só (curto-circuitam).
 * - Pendências: array com 1 ou mais (soma — falta email + falta CPF +
 *   precisa de perfil pode aparecer junto).
 */
export function statusAcesso(
  p: Pessoa,
  restaurantId: string,
  empregado: Empregado | null | undefined,
  perfis: AccessProfile[],
): AccessBadge[] {
  // Estados terminais — curto-circuitam
  if (p.ativa === false) return [BADGE_INATIVA];
  if (p.isMaster) return [BADGE_MASTER];

  const badges: AccessBadge[] = [];

  // Soma: falta email / falta CPF (independentes)
  const semEmail = !p.email || !p.email.trim();
  const semCpf = !p.cpf || !p.cpf.trim();
  if (semEmail) badges.push(BADGE_FALTA_EMAIL);
  if (semCpf) badges.push(BADGE_FALTA_CPF);

  // Soma: perfil no restaurante ativo
  const profileId = p.profileIds?.[restaurantId];
  if (!profileId) {
    badges.push(BADGE_PRECISA_PERFIL);
  } else {
    // Soma: perfil dá portal mas pessoa não tem empregado
    const perfil = resolverPerfil(profileId, perfis);
    const perfilLiberaPortal = perfil?.permissions?.portalEmpregado?.acessar === true;
    if (perfilLiberaPortal && !empregado) badges.push(BADGE_PRECISA_EMPREGADO);
  }

  // Soma: nunca logou (info, não bloqueia)
  // `uidVinculado` é campo runtime salvo no doc do Firestore mas não tipado
  // em Pessoa (cast). Setado uma vez no 1º login pelo AuthContext.
  const uidVinculado = (p as unknown as { uidVinculado?: string }).uidVinculado;
  if (!uidVinculado) badges.push(BADGE_NUNCA_LOGOU);

  // Fallback terminal — se nada pendente, "Pronto" sozinho.
  if (badges.length === 0) return [BADGE_PRONTO];
  return badges;
}

// ─── Filtro de acesso na lista ────────────────────────────────────────────

export type FiltroAcesso = "todos" | "comPendencia" | "pronto" | "nuncaLogou";

const STATUS_PENDENCIA: AccessStatus[] = [
  "falta_email", "falta_cpf", "precisa_perfil", "precisa_empregado",
];

export function passaFiltroAcesso(badges: AccessBadge[], filtro: FiltroAcesso): boolean {
  if (filtro === "todos") return true;
  if (filtro === "pronto") return badges.some(b => b.status === "pronto");
  if (filtro === "nuncaLogou") return badges.some(b => b.status === "nunca_logou");
  if (filtro === "comPendencia") {
    // Tudo que precisa de atenção do admin — não inclui Inativa, Master,
    // Pronto, nem "Nunca logou" (esse é informativo, não pendência crítica).
    return badges.some(b => STATUS_PENDENCIA.includes(b.status));
  }
  return true;
}

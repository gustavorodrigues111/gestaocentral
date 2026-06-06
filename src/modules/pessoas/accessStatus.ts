// ════════════════════════════════════════════════════════════════════════════
//  Status de acesso de uma Pessoa num restaurante específico.
//
//  Calcula um badge único que resume o estado: pode logar e usar o sistema?
//  Tem todos os dados pra ter acesso? Falta algo? Esses badges aparecem
//  na PessoasList pra varredura rápida de pendências.
//
//  Ordem de prioridade (1 badge só, top→down):
//    1. Inativa             — pessoa desativada (terminal)
//    2. Master              — bypass total
//    3. Falta email e CPF   — sem login + sem identidade
//    4. Falta email         — sem login (Firebase Auth)
//    5. Falta CPF           — sem identidade/Sólides
//    6. Precisa de perfil   — sem profileIds[rid] no restaurante atual
//    7. Precisa empregado   — perfil de empregado mas sem doc /empregados
//    8. Nunca logou         — tudo OK mas uidVinculado vazio (info)
//    9. Pronto              — tudo configurado
// ════════════════════════════════════════════════════════════════════════════

import type { AccessProfile, Empregado, Pessoa } from "../../core/types";
import { resolverPerfil } from "../../core/auth/permissions";

export type AccessStatus =
  | "inativa"
  | "master"
  | "falta_email_e_cpf"
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

/**
 * Resolve o status de acesso. Recebe a pessoa + restaurante ativo + lista de
 * empregados (índice por pessoaId) + lista de perfis carregados (built-in +
 * Firestore) pra conseguir resolver perfis custom.
 */
export function statusAcesso(
  p: Pessoa,
  restaurantId: string,
  empregado: Empregado | null | undefined,
  perfis: AccessProfile[],
): AccessBadge {
  // 1. Inativa — terminal
  if (p.ativa === false) {
    return {
      status: "inativa",
      label: "Inativa",
      tooltip: "Pessoa desativada. Reative no editor pra dar acesso novamente.",
      classes: "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    };
  }
  // 2. Master — bypass
  if (p.isMaster) {
    return {
      status: "master",
      label: "Master",
      tooltip: "Master tem acesso total ao sistema (bypass de perfis e restaurantes).",
      classes: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    };
  }
  // 3-5. Login (email + CPF)
  const semEmail = !p.email || !p.email.trim();
  const semCpf = !p.cpf || !p.cpf.trim();
  if (semEmail && semCpf) {
    return {
      status: "falta_email_e_cpf",
      label: "Falta email e CPF",
      tooltip: "Sem email (login) e sem CPF (identidade). Preencha os dois pra dar acesso.",
      classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }
  if (semEmail) {
    return {
      status: "falta_email",
      label: "Falta email",
      tooltip: "Sem email, ela não consegue fazer login no sistema.",
      classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }
  if (semCpf) {
    return {
      status: "falta_cpf",
      label: "Falta CPF",
      tooltip: "Sem CPF, identidade incompleta (necessária pra Sólides e auditoria).",
      classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }
  // 6. Perfil no restaurante ativo
  const profileId = p.profileIds?.[restaurantId];
  if (!profileId) {
    return {
      status: "precisa_perfil",
      label: "Precisa de perfil",
      tooltip: "Pessoa vai logar mas vê tela vazia — sem perfil de acesso atribuído neste restaurante.",
      classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }
  // 7. Se o perfil concede acesso ao Portal do Empregado, precisa de
  //    empregado cadastrado (senão Portal mostra "não é equipe").
  const perfil = resolverPerfil(profileId, perfis);
  const perfilLiberaPortal = perfil?.permissions?.portalEmpregado?.acessar === true;
  if (perfilLiberaPortal && !empregado) {
    return {
      status: "precisa_empregado",
      label: "Precisa empregado",
      tooltip: "Perfil dá acesso ao Portal do Empregado mas a pessoa não está cadastrada como empregada deste restaurante.",
      classes: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    };
  }
  // 8. Nunca logou — info, não bloqueia
  // `uidVinculado` é campo runtime salvo no doc do Firestore mas não
  // tipado em Pessoa (cast). Setado uma vez no 1º login pelo AuthContext.
  const uidVinculado = (p as unknown as { uidVinculado?: string }).uidVinculado;
  if (!uidVinculado) {
    return {
      status: "nunca_logou",
      label: "Nunca logou",
      tooltip: "Tudo configurado, mas a pessoa nunca acessou o sistema. Manda o link de acesso ou peça pra entrar.",
      classes: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    };
  }
  // 9. Pronto
  return {
    status: "pronto",
    label: "Pronto",
    tooltip: "Pessoa tem login, perfil atribuído e já acessou o sistema.",
    classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  };
}

// ─── Filtro de acesso na lista ────────────────────────────────────────────

export type FiltroAcesso = "todos" | "comPendencia" | "pronto" | "nuncaLogou";

export function passaFiltroAcesso(badge: AccessBadge, filtro: FiltroAcesso): boolean {
  if (filtro === "todos") return true;
  if (filtro === "pronto") return badge.status === "pronto";
  if (filtro === "nuncaLogou") return badge.status === "nunca_logou";
  if (filtro === "comPendencia") {
    // Tudo que precisa de atenção do admin — não inclui Inativa, Master,
    // Pronto, nem "Nunca logou" (esse é informativo, não pendência crítica).
    return ["falta_email", "falta_cpf", "falta_email_e_cpf",
            "precisa_perfil", "precisa_empregado"].includes(badge.status);
  }
  return true;
}

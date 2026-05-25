// Sistema de permissões — baseado em AccessProfile (perfis de acesso).
//
// Pessoa em qualquer restaurante precisa de profileId pra ter acesso ao
// módulo. Master ignora isso (bypass total). Sistema legado de
// permissions[rid][moduleId].{ver,configurar} foi REMOVIDO (Rodada 5).
//
// canVer/canConfigurar continuam existindo como compatibilidade com pages
// não migradas — internamente consultam o perfil via o mesmo mecanismo.
// pessoa.permissions[rid] é derivada do perfil pelo bridge no AuthContext.

import type { Pessoa, ModuleId, AccessProfile } from "../types";
import { BUILTIN_BY_ID } from "./builtinProfiles";

// Pode VER o módulo neste restaurante?
// Implementação: pessoa.permissions[rid][moduleId] é derivada do perfil
// pelo bridge no AuthContext. Pages legadas que ainda chamam canVer/canConfigurar
// recebem resposta correta sem precisar refactor.
export function canVer(pessoa: Pessoa | null, restaurantId: string, moduleId: ModuleId): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  const p = pessoa.permissions?.[restaurantId]?.[moduleId];
  return p?.ver === true || p?.configurar === true;  // configurar implica ver
}

// Pode CONFIGURAR o módulo neste restaurante?
export function canConfigurar(pessoa: Pessoa | null, restaurantId: string, moduleId: ModuleId): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  return pessoa.permissions?.[restaurantId]?.[moduleId]?.configurar === true;
}

// Tem acesso a algum módulo do restaurante? (pra mostrar/esconder o restaurante)
export function hasAnyAccess(pessoa: Pessoa | null, restaurantId: string): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  if (!pessoa.restaurantIds.includes(restaurantId)) return false;
  const perms = pessoa.permissions?.[restaurantId];
  if (!perms) return false;
  return Object.values(perms).some(p => p.ver || p.configurar);
}

/**
 * Unidades que a pessoa pode acessar pra um módulo específico.
 * - null   = TODAS (pessoa é master OU permission.unidades vazio/ausente)
 * - []     = NENHUMA (pessoa não tem permissão no módulo)
 * - [...]  = só essas unidadeIds
 *
 * Uso: filtrar dados (gorjetas, empregados, etc) pelas unidades retornadas.
 * Função `null` é o caso "ampla" — escopo de unidade não aplica.
 */
export function unidadesAcessiveis(
  pessoa: Pessoa | null,
  restaurantId: string,
  moduleId: ModuleId,
): string[] | null {
  if (!pessoa) return [];
  if (pessoa.isMaster) return null;
  const p = pessoa.permissions?.[restaurantId]?.[moduleId];
  if (!p || (!p.ver && !p.configurar)) return [];
  // Sem campo unidades ou vazio = todas
  if (!p.unidades || p.unidades.length === 0) return null;
  return p.unidades;
}

/**
 * Pode acessar (ver/configurar) o módulo NESSA unidade específica?
 * Retorna true se: master, ou se a pessoa tem a permissão geral E
 * (a permissão é ampla OU a unidadeId está no escopo).
 */
export function canVerNaUnidade(
  pessoa: Pessoa | null,
  restaurantId: string,
  moduleId: ModuleId,
  unidadeId: string | null | undefined,
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  if (!canVer(pessoa, restaurantId, moduleId)) return false;
  const unidades = unidadesAcessiveis(pessoa, restaurantId, moduleId);
  if (unidades === null) return true;  // ampla
  if (!unidadeId) return true;          // dado sem unidade — todos veem (single-rest fallback)
  return unidades.includes(unidadeId);
}

// ── Aliases legados (mantidos enquanto refatoramos as páginas) ────────────────
// Use `canVer` e `canConfigurar` em código novo.
export const canUse = canVer;
export const canConfig = canConfigurar;

// ════════════════════════════════════════════════════════════════════════════
//  canAcao() — checagem granular baseada em AccessProfile.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Resolve um perfil pelo id, com priority: built-in > custom Firestore.
 * O caller fornece a lista de perfis custom já carregados (do Firestore).
 */
export function resolverPerfil(
  profileId: string | undefined,
  perfisCustom: AccessProfile[],
): AccessProfile | null {
  if (!profileId) return null;
  const builtin = BUILTIN_BY_ID[profileId];
  if (builtin) {
    // Se admin sobrescreveu o built-in no Firestore, o custom ganha.
    const override = perfisCustom.find(p => p.id === profileId);
    return override ?? builtin;
  }
  return perfisCustom.find(p => p.id === profileId) ?? null;
}

/**
 * Pode executar uma ação específica num módulo nesse restaurante?
 *
 * Ordem de resolução:
 *   1. Master sempre permite.
 *   2. Pessoa precisa ter profileId pra esse restaurante.
 *   3. Profile.permissions[moduleId][actionId] decide.
 *
 * Sem profile = sem permissão (não tem fallback legado mais — Rodada 5 removeu).
 */
export function canAcao(
  pessoa: Pessoa | null,
  restaurantId: string,
  moduleId: string,
  actionId: string,
  perfisCustom: AccessProfile[] = [],
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  if (!pessoa.restaurantIds.includes(restaurantId)) return false;
  const profileId = pessoa.profileIds?.[restaurantId];
  if (!profileId) return false;
  const profile = resolverPerfil(profileId, perfisCustom);
  if (!profile) return false;
  return profile.permissions?.[moduleId]?.[actionId] === true;
}

/**
 * Versão "any of" — true se pessoa pode fazer pelo menos UMA das ações do
 * módulo. Útil pra decidir se mostra o item no menu sem precisar verificar
 * cada ação individualmente.
 */
export function canAcessarModulo(
  pessoa: Pessoa | null,
  restaurantId: string,
  moduleId: string,
  perfisCustom: AccessProfile[] = [],
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  const profileId = pessoa.profileIds?.[restaurantId];
  if (!profileId) return false;
  const profile = resolverPerfil(profileId, perfisCustom);
  if (!profile) return false;
  const mod = profile.permissions?.[moduleId];
  if (!mod) return false;
  return Object.values(mod).some(v => v === true);
}

// ════════════════════════════════════════════════════════════════════════════
//  Helpers especiais — substituem specialPermissions legado
//
//  Antes essas viviam em pessoa.specialPermissions. Agora vêm direto do
//  perfil. Funções continuam pra evitar refactor em cada chamador.
// ════════════════════════════════════════════════════════════════════════════

/** Pode excluir pessoa definitivamente neste restaurante? */
export function canExcluirPessoa(pessoa: Pessoa | null, restaurantId: string): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  // Mantém specialPermissions como fallback enquanto bridge atualiza pessoa.
  // O bridge mapeia profile.pessoas.excluir → specialPermissions.pessoasExcluir.
  return pessoa.specialPermissions?.[restaurantId]?.pessoasExcluir === true;
}

/** Pode reabrir mês de escala fechado neste restaurante? */
export function canReabrirEscala(pessoa: Pessoa | null, restaurantId: string): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  return pessoa.specialPermissions?.[restaurantId]?.escalaReabrir === true;
}

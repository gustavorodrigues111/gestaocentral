import type { Pessoa, ModuleId, AccessProfile } from "../types";
import { BUILTIN_BY_ID } from "./builtinProfiles";

// Pode VER o módulo neste restaurante?
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

// Permissão especial: pode excluir pessoas DEFINITIVAMENTE neste restaurante?
export function canExcluirPessoa(pessoa: Pessoa | null, restaurantId: string): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  return pessoa.specialPermissions?.[restaurantId]?.pessoasExcluir === true;
}

// Permissão especial: pode reabrir mês de escala fechado?
export function canReabrirEscala(pessoa: Pessoa | null, restaurantId: string): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  return pessoa.specialPermissions?.[restaurantId]?.escalaReabrir === true;
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
//  SISTEMA NOVO — canAcao() granular baseado em AccessProfile.
//
//  Convive com o sistema antigo (canVer/canConfigurar) durante a transição.
//  Pages migradas chamam canAcao(); pages não-migradas seguem com canVer.
//  Pessoas sem profile atribuído caem no fallback legado (mapeamento
//  heurístico do ver/configurar → ações específicas).
// ════════════════════════════════════════════════════════════════════════════

export type CanAcaoOpts = {
  /**
   * Quando a pessoa não tem profile e o módulo não está mapeado no fallback
   * legado, retorna esse valor. Default: false. Útil em ações totalmente
   * novas (que não existiam no sistema antigo) — pode forçar `true` durante
   * dev pra não bloquear quem não migrou ainda.
   */
  fallbackQuandoSemMapeamento?: boolean;
};

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
 *   2. Se pessoa tem profileId pro rid → checa permissions[moduleId][actionId].
 *   3. Senão → fallback legado: mapeia algumas ações pra ver/configurar.
 *   4. Senão → opts.fallbackQuandoSemMapeamento (default false).
 *
 * `perfisCustom` é a lista carregada do Firestore. Pra evitar prop-drilling,
 * o caller normalmente vem dum hook (useAccessProfiles).
 */
export function canAcao(
  pessoa: Pessoa | null,
  restaurantId: string,
  moduleId: string,
  actionId: string,
  perfisCustom: AccessProfile[] = [],
  opts: CanAcaoOpts = {},
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  if (!pessoa.restaurantIds.includes(restaurantId)) return false;

  // Sistema novo: profile atribuído pra esse restaurante
  const profileId = pessoa.profileIds?.[restaurantId];
  if (profileId) {
    const profile = resolverPerfil(profileId, perfisCustom);
    if (profile) {
      return profile.permissions?.[moduleId]?.[actionId] === true;
    }
    // profile id existe mas não resolveu (foi deletado?) — cai no fallback
  }

  // Fallback legado: mapeia algumas ações comuns pra ver/configurar.
  // Vai sendo apertado conforme as pages migram e built-in profiles
  // cobrem mais. Por enquanto: ações que começam com "ver" → canVer,
  // "configurar"/"editar"/"criar"/"deletar" → canConfigurar. Heurística.
  const moduleAsLegacy = moduleId as ModuleId;
  const ehLeitura = actionId.startsWith("ver") || actionId === "ler"
    || actionId === "verPropria" || actionId === "verExtratoProprio";
  if (ehLeitura) {
    return canVer(pessoa, restaurantId, moduleAsLegacy);
  }
  return canConfigurar(pessoa, restaurantId, moduleAsLegacy)
    || (opts.fallbackQuandoSemMapeamento ?? false);
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
  if (profileId) {
    const profile = resolverPerfil(profileId, perfisCustom);
    if (profile) {
      const mod = profile.permissions?.[moduleId];
      if (!mod) return false;
      return Object.values(mod).some(v => v === true);
    }
  }
  return canVer(pessoa, restaurantId, moduleId as ModuleId)
    || canConfigurar(pessoa, restaurantId, moduleId as ModuleId);
}

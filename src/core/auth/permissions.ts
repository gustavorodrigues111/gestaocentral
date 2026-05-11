import type { Pessoa, ModuleId } from "../types";

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

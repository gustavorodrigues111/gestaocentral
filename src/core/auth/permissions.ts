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

// ── Aliases legados (mantidos enquanto refatoramos as páginas) ────────────────
// Use `canVer` e `canConfigurar` em código novo.
export const canUse = canVer;
export const canConfig = canConfigurar;

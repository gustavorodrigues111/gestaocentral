import type { Pessoa, ModuleId } from "../types";

// Pode usar o módulo neste restaurante?
export function canUse(pessoa: Pessoa | null, restaurantId: string, moduleId: ModuleId): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  return pessoa.permissions?.[restaurantId]?.[moduleId]?.use === true;
}

// Pode configurar o módulo neste restaurante?
export function canConfig(pessoa: Pessoa | null, restaurantId: string, moduleId: ModuleId): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  return pessoa.permissions?.[restaurantId]?.[moduleId]?.config === true;
}

// Tem acesso a algum módulo do restaurante? (pra mostrar/esconder o restaurante)
export function hasAnyAccess(pessoa: Pessoa | null, restaurantId: string): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  if (!pessoa.restaurantIds.includes(restaurantId)) return false;
  const perms = pessoa.permissions?.[restaurantId];
  if (!perms) return false;
  return Object.values(perms).some(p => p.use || p.config);
}

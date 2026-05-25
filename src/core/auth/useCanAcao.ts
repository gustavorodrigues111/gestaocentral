// Hook ergonômico pra checagem de ações granulares em componentes.
// Esconde o boilerplate de pegar pessoa do auth + perfis do hook +
// passar tudo no canAcao().
//
// Uso típico:
//
//   const can = useCanAcao(rid);
//   if (can("reservas", "cancelar")) { ... }
//
// Pessoa vem do useAuth (que respeita impersonação automaticamente —
// quando master tá "visualizando como", as checks usam o profile da
// pessoa impersonada, não do master).

import { useCallback } from "react";
import { useAuth } from "./AuthContext";
import { useAccessProfiles } from "./useAccessProfiles";
import { canAcao, canAcessarModulo } from "./permissions";

export type CanAcaoFn = (moduleId: string, actionId: string) => boolean;
export type CanModuloFn = (moduleId: string) => boolean;

export type UseCanAcaoResult = {
  /** Checa uma ação específica. Master sempre true. */
  can: CanAcaoFn;
  /** Checa se pessoa pode acessar qualquer ação do módulo. */
  canModulo: CanModuloFn;
  /** True enquanto carrega perfis (UI deve mostrar skeleton em vez de "sem permissão"). */
  loading: boolean;
};

export function useCanAcao(restaurantId: string): UseCanAcaoResult {
  const { pessoa } = useAuth();
  const { perfis, loading } = useAccessProfiles();

  const can = useCallback<CanAcaoFn>(
    (moduleId, actionId) => canAcao(pessoa, restaurantId, moduleId, actionId, perfis),
    [pessoa, restaurantId, perfis],
  );

  const canModulo = useCallback<CanModuloFn>(
    (moduleId) => canAcessarModulo(pessoa, restaurantId, moduleId, perfis),
    [pessoa, restaurantId, perfis],
  );

  return { can, canModulo, loading };
}

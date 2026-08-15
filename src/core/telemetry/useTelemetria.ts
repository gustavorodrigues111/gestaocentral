import { useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { telemetriaAppOpen, telemetriaView, telemetriaAcao, type TelemetriaCtx } from "./telemetry";

// Hook de telemetria de uso, já amarrado ao usuário logado + restaurante ativo.
//   const tel = useTelemetria();
//   tel.view("gorjetas");                       // abriu um módulo
//   tel.acao("gorjetas", "publicar", { mes });  // ação-chave (meta pequeno, sem PII)
export function useTelemetria() {
  const { pessoa } = useAuth();
  const { activeId } = useRestaurant();
  return useMemo(() => {
    const ctx: TelemetriaCtx = { pessoaId: pessoa?.id || "", pessoaNome: pessoa?.nome, restaurantId: activeId || undefined };
    return {
      appOpen: () => telemetriaAppOpen(ctx),
      view: (modulo: string) => telemetriaView(ctx, modulo),
      acao: (modulo: string, acao: string, meta?: Record<string, string | number | boolean>) => telemetriaAcao(ctx, modulo, acao, meta),
    };
  }, [pessoa?.id, pessoa?.nome, activeId]);
}

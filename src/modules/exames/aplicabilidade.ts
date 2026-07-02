// Regra de aplicabilidade de um tipo de exame a um cargo/empregado.
//
// Fonte de verdade: cargosObrigatorios (por cargo). Precedência:
//   1. cargosObrigatorios preenchido → só esses cargos.
//   2. senão areasAplicaveis (legado) preenchido → só cargos dessas áreas.
//   3. senão → TODOS os cargos CLT (registrado/estagiário) — ex: Clínico anual.
import type { Area, Cargo, ExameTipoConfig, TipoVinculo } from "../../core/types";
import { TIPOS_VINCULO_COM_PESSOA } from "../../core/types";

// Vínculos obrigados a exame ocupacional (CLT-ish): registrado + estagiário.
export function vinculoObrigadoExame(v?: TipoVinculo): boolean {
  return TIPOS_VINCULO_COM_PESSOA.includes(v || "registrado");
}

export function tipoAplicaAoCargo(
  tipo: Pick<ExameTipoConfig, "cargosObrigatorios" | "areasAplicaveis">,
  cargo: { id?: string; area?: Area | string; tipoVinculo?: TipoVinculo } | null | undefined,
): boolean {
  const cargosOb = tipo.cargosObrigatorios || [];
  if (cargosOb.length > 0) return !!cargo?.id && cargosOb.includes(cargo.id);
  const areas = tipo.areasAplicaveis || [];
  if (areas.length > 0) return !!cargo?.area && areas.includes(cargo.area as Area);
  // Default "todos" = todo cargo CLT.
  return vinculoObrigadoExame(cargo?.tipoVinculo);
}

// Conveniência a partir de um objeto Cargo completo.
export function tipoAplicaAoCargoObj(tipo: ExameTipoConfig, cargo: Cargo | null | undefined): boolean {
  return tipoAplicaAoCargo(tipo, cargo ? { id: cargo.id, area: cargo.area, tipoVinculo: cargo.tipoVinculo } : null);
}

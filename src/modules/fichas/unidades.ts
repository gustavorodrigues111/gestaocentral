// Unidades e conversões por DIMENSÃO. Um insumo cadastrado numa dimensão só
// aceita usos na mesma dimensão (sal em massa → g/kg; nunca litro).
import type { FtDimensao } from "../../core/types";

// Fator de cada unidade em relação à base da sua dimensão.
//   massa  → base grama (g)
//   volume → base mililitro (ml)
//   unidade→ base unidade (un)
type UnidadeDef = { unidade: string; dimensao: FtDimensao; fator: number; label: string };

export const UNIDADES: UnidadeDef[] = [
  { unidade: "g",  dimensao: "massa",   fator: 1,     label: "g" },
  { unidade: "kg", dimensao: "massa",   fator: 1000,  label: "kg" },
  { unidade: "mg", dimensao: "massa",   fator: 0.001, label: "mg" },
  { unidade: "ml", dimensao: "volume",  fator: 1,     label: "ml" },
  { unidade: "L",  dimensao: "volume",  fator: 1000,  label: "L" },
  { unidade: "un", dimensao: "unidade", fator: 1,     label: "un" },
  { unidade: "dz", dimensao: "unidade", fator: 12,    label: "dúzia" },
  { unidade: "porção", dimensao: "unidade", fator: 1, label: "porção" },
  { unidade: "fatia",  dimensao: "unidade", fator: 1, label: "fatia" },
  { unidade: "dose",   dimensao: "unidade", fator: 1, label: "dose" },
];

const BY_UNIT = new Map(UNIDADES.map(u => [u.unidade, u]));

export const DIMENSAO_LABEL: Record<FtDimensao, string> = {
  massa: "massa", volume: "volume", unidade: "unidade",
};

export function dimensaoDeUnidade(unidade: string): FtDimensao | null {
  return BY_UNIT.get(unidade)?.dimensao ?? null;
}

export function unidadesDaDimensao(dim: FtDimensao): UnidadeDef[] {
  return UNIDADES.filter(u => u.dimensao === dim);
}

// Unidades oferecidas pra RENDIMENTO (inclui porções/fatias/doses).
export function unidadesRendimento(): UnidadeDef[] {
  return UNIDADES;
}

// Converte uma quantidade de `unidade` para a base da dimensão. null se a
// unidade for desconhecida.
export function paraBase(qtd: number, unidade: string): number | null {
  const u = BY_UNIT.get(unidade);
  if (!u) return null;
  return qtd * u.fator;
}

// Converte de `de` para `para` (mesma dimensão). null se incompatíveis.
export function converter(qtd: number, de: string, para: string): number | null {
  const a = BY_UNIT.get(de), b = BY_UNIT.get(para);
  if (!a || !b || a.dimensao !== b.dimensao) return null;
  return (qtd * a.fator) / b.fator;
}

export function labelUnidade(unidade: string): string {
  return BY_UNIT.get(unidade)?.label ?? unidade;
}

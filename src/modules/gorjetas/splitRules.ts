// Lógica de regras de divisão (SplitVersion). Portado do AppTip.

import type { Area, AreaPercentConfig, Empregado, SplitVersion } from "../../core/types";
import { empregadoAtivoEm } from "../../core/utils/empregado";

// Pega a SplitVersion vigente em uma data específica.
//
// Cobertura: a versão cobre `date` se `effectiveFrom <= date` E
// (não tem effectiveUntil OU date <= effectiveUntil). Quando uma nova regra
// é criada, a anterior recebe automaticamente `effectiveUntil = (nova.from - 1)`
// pra evitar dia sem regra (invariante do produto).
//
// Retorna null se nenhuma versão cobre a data (ex: data antes da 1ª regra
// cadastrada). O caller deve mostrar "⚠ sem regra" e não dividir.
export function getActiveSplitVersion(
  versions: SplitVersion[] | undefined,
  date: string,
): SplitVersion | null {
  if (!versions || versions.length === 0) return null;
  const candidatos = versions.filter(v => {
    if (v.status !== "active") return false;
    if (v.effectiveFrom && v.effectiveFrom > date) return false;
    if (v.effectiveUntil && date > v.effectiveUntil) return false;
    return true;
  });
  if (candidatos.length === 0) return null;
  // Empate (sobreposição não-prevista): a com effectiveFrom maior vence
  candidatos.sort((a, b) => (a.effectiveFrom || "").localeCompare(b.effectiveFrom || ""));
  return candidatos[candidatos.length - 1];
}

// Conta empregados REGISTRADOS ativos numa área em uma data específica.
// Critério: cargo da área + tipoVinculo "registrado" + período cobrindo a data.
export function countEmpregadosRegistradosNaArea(
  empregados: Empregado[],
  cargoMap: Record<string, { area: Area; tipoVinculo: string }>,
  area: Area,
  date: string,
): number {
  return empregados.filter(e => {
    const cargo = cargoMap[e.cargoId];
    if (!cargo) return false;
    if (cargo.area !== area) return false;
    if (cargo.tipoVinculo !== "registrado") return false;
    return empregadoAtivoEm(e, date);
  }).length;
}

// Calcula % final de cada área dado:
// - regras (percentages com tipos fixed/perEmployee)
// - quantidade de empregados ativos por área
// Resultado soma 100 (a menos de arredondamento).
export function computeAreaPercentages(
  percentages: SplitVersion["percentages"] | undefined,
  empregadosPorArea: Partial<Record<Area, number>>,
): Record<Area, number> {
  const finalPct: Record<Area, number> = { Bar: 0, Cozinha: 0, Salão: 0, Limpeza: 0 };
  if (!percentages) return finalPct;

  // 1) Áreas perEmployee comem primeiro (% = N × valuePerEmp)
  let dynamicTotal = 0;
  (Object.keys(percentages) as Area[]).forEach(area => {
    const cfg = percentages[area];
    if (cfg.type === "perEmployee") {
      const n = empregadosPorArea[area] || 0;
      const pct = n * (cfg.valuePerEmp || 0);
      finalPct[area] = pct;
      dynamicTotal += pct;
    }
  });

  // Cap em 100 (caso patológico)
  if (dynamicTotal > 100) {
    const scale = 100 / dynamicTotal;
    (Object.keys(finalPct) as Area[]).forEach(k => {
      finalPct[k] = finalPct[k] * scale;
    });
    dynamicTotal = 100;
  }

  // 2) Saldo restante distribuído entre áreas fixas, proporcional aos valores
  const remaining = Math.max(0, 100 - dynamicTotal);
  let fixedSum = 0;
  (Object.values(percentages) as AreaPercentConfig[]).forEach(cfg => {
    if (cfg.type === "fixed") fixedSum += (cfg.value || 0);
  });
  (Object.keys(percentages) as Area[]).forEach(area => {
    const cfg = percentages[area];
    if (cfg.type === "fixed") {
      finalPct[area] = fixedSum > 0 ? ((cfg.value || 0) / fixedSum) * remaining : 0;
    }
  });

  return finalPct;
}

// Default vazio pra modo "Por Área" — soma 100% (Bar+Cozinha+Salão+Limpeza fixos)
export function defaultPercentages(): NonNullable<SplitVersion["percentages"]> {
  return {
    Bar:     { type: "fixed", value: 12 },
    Cozinha: { type: "fixed", value: 40 },
    Salão:   { type: "fixed", value: 40 },
    Limpeza: { type: "fixed", value: 8 },
  };
}

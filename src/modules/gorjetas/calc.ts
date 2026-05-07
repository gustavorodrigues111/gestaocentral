import type {
  Area, Cargo, DivisaoItem, Empregado, EscalaMes, ScheduleStatus, SplitVersion,
} from "../../core/types";
import { AREAS } from "../../core/types";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { computeAreaPercentages, countEmpregadosRegistradosNaArea } from "./splitRules";

// Re-export pra retrocompatibilidade (módulos antigos importam daqui)
export { empregadoAtivoEm };

// Status que faz o empregado RECEBER gorjeta naquele dia (se cargo tem pontos)
const STATUS_RECEBE: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  freela:    true,
  comp_trab: true,   // trabalhou compensando outro dia
  folga:     false,
  comp:      false,
  ferias:    false,
  falta_j:   false,
  falta_i:   false,
};

export type DivisaoResult = {
  itens: DivisaoItem[];
  totalPontos: number;
  valorPonto: number;
  totalDistribuido: number;
  resto: number;
};

/**
 * Calcula a divisão da gorjeta de UM dia.
 *
 * Suporta 2 modos via SplitVersion:
 * - "global_points" (default se sem regra): pool inteiro / pontos do cargo
 * - "area_points": pool dividido entre áreas por % (config), depois dentro da área por pontos
 *
 * Regras de elegibilidade (sempre):
 * - Cargo com semGorjeta=true ou pontos<=0 → fora (cobre sócio)
 * - Cargo com recebeProducao=true → recebe TODO dia (independente da escala)
 * - Demais → status REAL é trabalho/freela/comp_trab
 * - Empregado fora do período → fora
 */
export function calcularDivisaoDia(
  date: string,
  valorLiquido: number,
  empregados: Empregado[],
  cargos: Cargo[],
  escala: EscalaMes | null,
  splitVersion?: SplitVersion | null,
): DivisaoResult {
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const itens: DivisaoItem[] = [];

  // 1) Eligibilidade — quem recebe gorjeta neste dia?
  for (const e of empregados) {
    if (!empregadoAtivoEm(e, date)) continue;
    const cargo = cargoMap[e.cargoId];
    if (!cargo || cargo.semGorjeta || cargo.pontos <= 0) continue;

    let motivo: DivisaoItem["motivo"] | null = null;
    if (cargo.recebeProducao) {
      motivo = "producao";
    } else {
      const status = escala?.real?.[e.id]?.[date];
      if (status && STATUS_RECEBE[status]) {
        motivo = status === "freela" ? "freela" : "trabalho";
      }
    }
    if (motivo === null) continue;

    itens.push({
      empregadoId: e.id,
      empregadoNome: e.nome,
      cargoNome: cargo.nome,
      area: cargo.area,
      pontos: cargo.pontos,
      valor: 0,
      motivo,
    });
  }

  if (itens.length === 0) {
    return { itens, totalPontos: 0, valorPonto: 0, totalDistribuido: 0, resto: valorLiquido };
  }

  // 2) Distribui o líquido segundo o modo
  const mode = splitVersion?.mode || "global_points";

  if (mode === "global_points") {
    // Modo simples: tudo no pool global, divide por pontos
    const totalPontos = itens.reduce((s, i) => s + i.pontos, 0);
    if (totalPontos <= 0) {
      return { itens, totalPontos: 0, valorPonto: 0, totalDistribuido: 0, resto: valorLiquido };
    }
    const valorPonto = Math.floor((valorLiquido / totalPontos) * 100) / 100;
    let totalDistribuido = 0;
    for (const it of itens) {
      it.valor = Math.round(it.pontos * valorPonto * 100) / 100;
      totalDistribuido += it.valor;
    }
    totalDistribuido = Math.round(totalDistribuido * 100) / 100;
    return {
      itens,
      totalPontos,
      valorPonto,
      totalDistribuido,
      resto: Math.round((valorLiquido - totalDistribuido) * 100) / 100,
    };
  }

  // Modo "area_points":
  // a. calcula % efetivo por área (com N empregados registrados ativos)
  // b. distribui o líquido entre áreas
  // c. dentro de cada área, divide por pontos
  const cargoMapForCount = Object.fromEntries(
    cargos.map(c => [c.id, { area: c.area, tipoVinculo: c.tipoVinculo }])
  );
  const empregadosPorArea: Partial<Record<Area, number>> = {};
  AREAS.forEach(a => {
    empregadosPorArea[a] = countEmpregadosRegistradosNaArea(empregados, cargoMapForCount, a, date);
  });
  const finalPct = computeAreaPercentages(splitVersion?.percentages, empregadosPorArea);

  let totalDistribuido = 0;
  let totalPontosGeral = 0;
  for (const area of AREAS) {
    const pctArea = finalPct[area] || 0;
    const valorArea = Math.round((valorLiquido * pctArea / 100) * 100) / 100;
    if (valorArea <= 0) continue;

    const itensArea = itens.filter(i => i.area === area);
    const pontosArea = itensArea.reduce((s, i) => s + i.pontos, 0);
    if (pontosArea <= 0) continue;

    totalPontosGeral += pontosArea;
    const valorPonto = Math.floor((valorArea / pontosArea) * 100) / 100;
    for (const it of itensArea) {
      it.valor = Math.round(it.pontos * valorPonto * 100) / 100;
      totalDistribuido += it.valor;
    }
  }
  totalDistribuido = Math.round(totalDistribuido * 100) / 100;

  return {
    itens,
    totalPontos: totalPontosGeral,
    valorPonto: 0,  // varia por área
    totalDistribuido,
    resto: Math.round((valorLiquido - totalDistribuido) * 100) / 100,
  };
}

export function calcularValorLiquido(valorBruto: number, taxRate: number): number {
  const liquido = valorBruto * (1 - taxRate / 100);
  return Math.round(liquido * 100) / 100;
}


import type {
  Area, Cargo, DivisaoItem, Empregado, EscalaMes, ScheduleStatus, SplitVersion,
  Unidade,
} from "../../core/types";
import { AREAS } from "../../core/types";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
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
 * - Cargo com recebeProducao=true → recebe se trabalhou (em qualquer unidade,
 *   se multi; mesmo sem escala em single-unit)
 * - Demais → status REAL é trabalho/freela/comp_trab
 * - Empregado fora do período → fora
 *
 * Multi-unidades: se `gorjetaUnidadeId` está setado, filtra empregados que
 * trabalharam NESSA unidade (cargos normais) ou em qualquer unidade de
 * PRODUÇÃO (cargos com recebeProducao=true).
 */
export function calcularDivisaoDia(
  date: string,
  valorLiquido: number,
  empregados: Empregado[],
  cargos: Cargo[],
  escala: EscalaMes | null,
  splitVersion?: SplitVersion | null,
  gorjetaUnidadeId?: string | null,
  unidades?: Unidade[],
): DivisaoResult {
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const itens: DivisaoItem[] = [];

  // Unidades de produção (pra cargos com recebeProducao=true)
  const idsUnidadesProducao = new Set(
    (unidades || []).filter(u => u.tipo === "producao" && u.ativa).map(u => u.id)
  );
  const isMultiUnidades = !!gorjetaUnidadeId;

  // Pra cada empregado, resolve status do dia com fallback chain:
  //   1. override em escala.real (o que aconteceu)
  //   2. override em escala.prevista (planejamento — usado quando real ainda vazia)
  //   3. derivado do horário cadastrado (workSchedule)
  const [yStr, mStr] = date.split("-");
  const yNum = parseInt(yStr, 10);
  const mNum = parseInt(mStr, 10);

  function resolverStatus(emp: Empregado): ScheduleStatus | undefined {
    const real = escala?.real?.[emp.id]?.[date];
    if (real) return real;
    const prevista = escala?.prevista?.[emp.id]?.[date];
    if (prevista) return prevista;
    const derived = derivedScheduleForEmpregado(emp, yNum, mNum);
    return derived[date]?.status;
  }

  // Resolve unidade onde o empregado trabalhou no dia (usa real → prevista → padrão).
  // Só relevante quando isMultiUnidades.
  function resolverUnidade(emp: Empregado): string | null {
    if (!isMultiUnidades) return null;
    const real = escala?.unidadesReais?.[emp.id]?.[date];
    if (real) return real;
    const prev = escala?.unidadesPrevistas?.[emp.id]?.[date];
    if (prev) return prev;
    return emp.unidadePadraoId || null;
  }

  // 1) Eligibilidade — quem recebe gorjeta neste dia?
  for (const e of empregados) {
    if (!empregadoAtivoEm(e, date)) continue;
    const cargo = cargoMap[e.cargoId];
    if (!cargo || cargo.semGorjeta || cargo.pontos <= 0) continue;

    let motivo: DivisaoItem["motivo"] | null = null;
    const status = resolverStatus(e);
    const trabalhou = !!status && STATUS_RECEBE[status];

    if (cargo.recebeProducao) {
      if (isMultiUnidades) {
        // Multi: precisa ter trabalhado em alguma unidade de PRODUÇÃO no dia
        if (!trabalhou) continue;
        const unidadeDoDia = resolverUnidade(e);
        if (!unidadeDoDia || !idsUnidadesProducao.has(unidadeDoDia)) continue;
      }
      // Single-unit: comportamento antigo — recebe TODO dia (independente da escala)
      motivo = "producao";
    } else {
      // Cargo normal: precisa ter trabalhado
      if (!trabalhou) continue;
      if (isMultiUnidades) {
        // Empregado precisa ter trabalhado NESSA unidade
        const unidadeDoDia = resolverUnidade(e);
        if (unidadeDoDia !== gorjetaUnidadeId) continue;
      }
      motivo = status === "freela" ? "freela" : "trabalho";
    }

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


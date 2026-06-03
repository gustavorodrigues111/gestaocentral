import type {
  Area, Cargo, DivisaoItem, Empregado, EscalaMes, ScheduleStatus, SplitVersion,
  Unidade,
} from "../../core/types";
import { AREAS } from "../../core/types";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import { statusEfetivoComDerivado } from "../../core/escala/statusEfetivo";
import { computeAreaPercentages, countEmpregadosRegistradosNaArea } from "./splitRules";

// Re-export pra retrocompatibilidade (módulos antigos importam daqui)
export { empregadoAtivoEm };

// Status que faz o empregado RECEBER gorjeta naquele dia (se cargo tem pontos).
// Fonte: status EFETIVO (override gravado ∪ derivado do horário cadastrado).
// Diferenças intencionais entre VT e Gorjetas:
//   - "comp" (folgou compensando outro dia trabalhado) → RECEBE gorjeta porque
//     a folga é "paga" pelo trabalho que já fez antes — em VT não conta
//     (não usou transporte), mas em gorjeta sim.
//   - "freela" → NÃO recebe nem em VT nem em Gorjeta (relação não-CLT).
const STATUS_RECEBE: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  comp_trab: true,   // trabalhou compensando outro dia
  comp:      true,   // folgou compensando — recebe na divisão
  freela:    false,
  folga:     false,
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

  // Mantém referência da lista de unidades pra eventual extensão futura,
  // mas a regra atual de cargo recebeProducao não exige unidade específica.
  void unidades;
  const isMultiUnidades = !!gorjetaUnidadeId;

  const [yStr, mStr] = date.split("-");
  const yNum = parseInt(yStr, 10);
  const mNum = parseInt(mStr, 10);

  // Cache de derivados por empregado pro mês inteiro. Como esta função é
  // chamada 1× por dia, computa todos os derivados uma vez e reusa.
  const derivedCache: Record<string, ReturnType<typeof derivedScheduleForEmpregado>> = {};
  function derivadosDoEmp(emp: Empregado) {
    let cached = derivedCache[emp.id];
    if (!cached) {
      cached = derivedScheduleForEmpregado(emp, yNum, mNum);
      derivedCache[emp.id] = cached;
    }
    return cached;
  }

  // Pra cada empregado, resolve status efetivo do dia (override ∪ derivado).
  // Versão "real": tenta real → prevista → derivado.
  // Se nada disso retornar status → empregado NÃO recebe.
  function resolverStatus(emp: Empregado): ScheduleStatus | undefined {
    return statusEfetivoComDerivado(emp.id, escala, derivadosDoEmp(emp), date, "real");
  }

  // Resolve unidade onde o empregado trabalhou no dia.
  // Fallback chain:
  //   1. override em escala.unidadesReais (real)
  //   2. override em escala.unidadesPrevistas (prevista)
  //   3. workSchedule do dia da semana (HorarioDia.unidadeId — alternância recorrente)
  //   4. empregado.unidadePadraoId
  function resolverUnidade(emp: Empregado): string | null {
    if (!isMultiUnidades) return null;
    const real = escala?.unidadesReais?.[emp.id]?.[date];
    if (real) return real;
    const prev = escala?.unidadesPrevistas?.[emp.id]?.[date];
    if (prev) return prev;
    // Tenta workSchedule (alternância semanal recorrente — toda quinta na Filial, etc)
    const derived = derivedScheduleForEmpregado(emp, yNum, mNum);
    const dayUnit = derived[date]?.unidadeId;
    if (dayUnit) return dayUnit;
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
      // Cargo "recebe produção" = recebe gorjeta de TODAS as unidades de
      // atendimento, independente da unidade onde o empregado está lotado
      // ou onde trabalhou no dia. Em multi-unidade exige só que tenha
      // trabalhado; em single-unit recebe TODO dia (comportamento antigo).
      if (isMultiUnidades && !trabalhou) continue;
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
    // Distribui os centavos restantes (método do maior resto): empregados
    // com mais pontos recebem +0,01 antes, até zerar o resto. Garante que
    // totalDistribuido === valorLiquido. Resolve o sumidouro de centavos
    // que ficava por dia.
    totalDistribuido = distribuirRestoEntreItens(itens, valorLiquido, totalDistribuido);
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
  // b. classifica áreas com pct>0 em "com gente" e "órfã" (pct mas sem
  //    elegível no dia — folga/falta de todos da área). O pct das órfãs é
  //    redistribuído pras com gente proporcionalmente aos pcts originais
  //    delas. Princípio de negócio: se Limpeza (2,5%) não tem ninguém no dia,
  //    esses 2,5% "voltam" pra Cozinha+Salão+Bar conforme as %s deles. Sem
  //    isso, o valor da área órfã virava buraco e não era distribuído.
  // c. dentro de cada área com gente, divide por pontos
  const cargoMapForCount = Object.fromEntries(
    cargos.map(c => [c.id, { area: c.area, tipoVinculo: c.tipoVinculo }])
  );
  const empregadosPorArea: Partial<Record<Area, number>> = {};
  AREAS.forEach(a => {
    empregadosPorArea[a] = countEmpregadosRegistradosNaArea(empregados, cargoMapForCount, a, date);
  });
  const finalPct = computeAreaPercentages(splitVersion?.percentages, empregadosPorArea);

  // Classifica áreas em "com gente" e "órfã"
  const areasComGente: { area: Area; pct: number; itens: DivisaoItem[]; pontos: number }[] = [];
  let pctOrfaoTotal = 0;
  for (const area of AREAS) {
    const pctArea = finalPct[area] || 0;
    if (pctArea <= 0) continue;
    const itensArea = itens.filter(i => i.area === area);
    const pontosArea = itensArea.reduce((s, i) => s + i.pontos, 0);
    if (pontosArea <= 0) {
      pctOrfaoTotal += pctArea;
      continue;
    }
    areasComGente.push({ area, pct: pctArea, itens: itensArea, pontos: pontosArea });
  }

  if (areasComGente.length === 0) {
    // Sem ninguém em nenhuma área com pct>0 → todo valor vira resto
    return { itens, totalPontos: 0, valorPonto: 0, totalDistribuido: 0, resto: valorLiquido };
  }

  const somaPctComGente = areasComGente.reduce((s, a) => s + a.pct, 0);

  let totalDistribuido = 0;
  let totalPontosGeral = 0;
  for (const a of areasComGente) {
    // pctEfetivo = pct original + porção redistribuída do órfão (proporcional
    // ao peso original dessa área entre as áreas com gente). Sem órfão,
    // pctEfetivo === a.pct.
    const pctEfetivo = pctOrfaoTotal > 0
      ? a.pct + (a.pct / somaPctComGente) * pctOrfaoTotal
      : a.pct;
    const valorArea = Math.round((valorLiquido * pctEfetivo / 100) * 100) / 100;

    totalPontosGeral += a.pontos;
    const valorPonto = Math.floor((valorArea / a.pontos) * 100) / 100;
    let totalDistribuidoArea = 0;
    for (const it of a.itens) {
      it.valor = Math.round(it.pontos * valorPonto * 100) / 100;
      totalDistribuidoArea += it.valor;
    }
    totalDistribuidoArea = distribuirRestoEntreItens(a.itens, valorArea, totalDistribuidoArea);
    totalDistribuido += totalDistribuidoArea;
  }
  totalDistribuido = Math.round(totalDistribuido * 100) / 100;

  // Resíduo entre áreas (arredondamento dos valorArea de cada área não soma
  // exato com valorLiquido). Distribui os centavos finais entre TODOS os
  // itens em ordem global de pontos. Garante totalDistribuido === valorLiquido
  // sempre.
  totalDistribuido = distribuirRestoEntreItens(itens, valorLiquido, totalDistribuido);

  return {
    itens,
    totalPontos: totalPontosGeral,
    valorPonto: 0,  // varia por área
    totalDistribuido,
    resto: Math.round((valorLiquido - totalDistribuido) * 100) / 100,
  };
}

// Distribui os centavos restantes entre os elegíveis. Método do maior resto:
// quem tem mais pontos recebe +0,01 primeiro (em caso de empate, ordem
// original = a do array, que segue ordem da escala). Se sobrar mais centavos
// que itens (cenário raro), reinicia a lista. Modifica `itens` no lugar e
// retorna o novo totalDistribuido arredondado em centavos.
function distribuirRestoEntreItens(
  itens: DivisaoItem[],
  valorLiquido: number,
  totalDistribuido: number,
): number {
  let restoCentavos = Math.round((valorLiquido - totalDistribuido) * 100);
  if (restoCentavos <= 0 || itens.length === 0) {
    return Math.round(totalDistribuido * 100) / 100;
  }
  // Cópia indexada pra ordenar por pontos preservando ordem em empate
  const ordem = itens
    .map((it, i) => ({ it, i }))
    .sort((a, b) => b.it.pontos - a.it.pontos || a.i - b.i);
  let idx = 0;
  while (restoCentavos > 0) {
    ordem[idx % ordem.length].it.valor =
      Math.round((ordem[idx % ordem.length].it.valor + 0.01) * 100) / 100;
    restoCentavos--;
    idx++;
  }
  return Math.round(itens.reduce((s, it) => s + it.valor, 0) * 100) / 100;
}

export function calcularValorLiquido(valorBruto: number, taxRate: number): number {
  const liquido = valorBruto * (1 - taxRate / 100);
  return Math.round(liquido * 100) / 100;
}


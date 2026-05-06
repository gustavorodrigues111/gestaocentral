import type { Cargo, DivisaoItem, Empregado, EscalaMes, ScheduleStatus } from "../../core/types";

// Status que faz o empregado RECEBER gorjeta naquele dia (se cargo tem pontos)
const STATUS_RECEBE: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  freela:    true,
  comp_trab: true,   // trabalhou compensando outro dia
  folga:     false,
  comp:      false,  // folgou (compensação)
  ferias:    false,
  falta_j:   false,
  falta_i:   false,
};

export type DivisaoResult = {
  itens: DivisaoItem[];
  totalPontos: number;
  valorPonto: number;       // valorLiquido / totalPontos (0 se sem pontos)
  totalDistribuido: number; // soma final dos valores dos itens (pode ter centavos a menos)
  resto: number;            // valorLiquido - totalDistribuido (centavos não distribuídos)
};

/**
 * Calcula a divisão da gorjeta de UM dia.
 *
 * Quem entra:
 * - Empregados com status que recebe (trabalho, freela, comp_trab) E cargo com pontos > 0 e !semGorjeta
 * - Empregados marcados isProducao recebem TODO DIA (independente da escala)
 * - Empregados marcados isProlaborista NÃO recebem (sócio recebe pró-labore separado)
 * - Empregados inativos/demitidos no dia: filtrados
 *
 * O valor por ponto é arredondado pra centavos. O resto fica no campo `resto`.
 */
export function calcularDivisaoDia(
  date: string,                                  // YYYY-MM-DD
  valorLiquido: number,
  empregados: Empregado[],
  cargos: Cargo[],
  escala: EscalaMes | null,
): DivisaoResult {
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));
  const itens: DivisaoItem[] = [];

  for (const e of empregados) {
    if (e.isProlaborista) continue;
    if (e.demitidoEm && date >= e.demitidoEm) continue;        // primeiro dia FORA = demitidoEm
    if (e.inativa && e.inativaFrom && date >= e.inativaFrom) continue;
    if (e.admissao && date < e.admissao) continue;

    const cargo = cargoMap[e.cargoId];
    if (!cargo || cargo.semGorjeta || cargo.pontos <= 0) continue;

    let motivo: DivisaoItem["motivo"] | null = null;

    if (e.isProducao) {
      motivo = "producao";
    } else {
      const status = escala?.empregados?.[e.id]?.[date];
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
      valor: 0, // preenchido abaixo
      motivo,
    });
  }

  const totalPontos = itens.reduce((s, i) => s + i.pontos, 0);
  if (totalPontos <= 0) {
    return { itens, totalPontos: 0, valorPonto: 0, totalDistribuido: 0, resto: valorLiquido };
  }

  // valor por ponto (arredondado pra centavos)
  const valorPonto = Math.floor((valorLiquido / totalPontos) * 100) / 100;

  let totalDistribuido = 0;
  for (const it of itens) {
    it.valor = Math.round(it.pontos * valorPonto * 100) / 100;
    totalDistribuido += it.valor;
  }
  totalDistribuido = Math.round(totalDistribuido * 100) / 100;

  const resto = Math.round((valorLiquido - totalDistribuido) * 100) / 100;
  return { itens, totalPontos, valorPonto, totalDistribuido, resto };
}

export function calcularValorLiquido(valorBruto: number, taxRate: number): number {
  const liquido = valorBruto * (1 - taxRate / 100);
  return Math.round(liquido * 100) / 100;
}

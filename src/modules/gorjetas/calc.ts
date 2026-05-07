import type { Cargo, DivisaoItem, Empregado, EscalaMes, ScheduleStatus } from "../../core/types";
import { empregadoAtivoEm } from "../../core/utils/empregado";

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
 * Regras (todas no CARGO, não mais no Empregado):
 * - Cargo com `semGorjeta: true` ou `pontos <= 0` → não recebe (cobre sócio também)
 * - Cargo com `recebeProducao: true` → recebe TODO dia (independente da escala)
 * - Demais → recebem se status na escala REAL é trabalho/freela/comp_trab
 *
 * Considera também:
 * - Empregado fora do período (não admitido ou demitido) → fora
 * - Usa escala REAL (não a prevista) — gorjeta é paga em cima do que de fato aconteceu
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

  const resto = Math.round((valorLiquido - totalDistribuido) * 100) / 100;
  return { itens, totalPontos, valorPonto, totalDistribuido, resto };
}

export function calcularValorLiquido(valorBruto: number, taxRate: number): number {
  const liquido = valorBruto * (1 - taxRate / 100);
  return Math.round(liquido * 100) / 100;
}


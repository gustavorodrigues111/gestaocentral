// Datas de corte de pagamento dos freelas. A partir do momento em que o turno é
// ENCERRADO, calcula em qual pagamento ele cai, segundo as linhas de corte
// configuradas por restaurante (ex.: "encerrado até segunda 18h → pago terça").
import type { FreelasCortePagamento } from "../../core/types";

export const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const DIAS_SEMANA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DIAS_SEMANA_CAP = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

// Próxima data/hora >= `from` cujo dia-da-semana é `dow` e hora é `hhmm`.
function proxDiaHora(from: Date, dow: number, hhmm: string): Date {
  const [h, m] = (hhmm || "00:00").split(":").map(Number);
  const d = new Date(from);
  const delta = (dow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta);
  d.setHours(h || 0, m || 0, 0, 0);
  if (d.getTime() < from.getTime()) d.setDate(d.getDate() + 7);   // já passou hoje → semana que vem
  return d;
}

// Próxima data com dia-da-semana `dow` ESTRITAMENTE depois de `deadline` (o
// pagamento é sempre depois do corte). Zera a hora.
function proxDiaApos(deadline: Date, dow: number): Date {
  const d = new Date(deadline);
  let delta = (dow - d.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  d.setDate(d.getDate() + delta);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Dado o momento de encerramento (ISO) e as linhas de corte, retorna a linha
// cujo prazo vence PRIMEIRO a partir dali e a data de pagamento correspondente.
export function proximoPagamento(
  dataEncerramentoISO: string,
  cortes: FreelasCortePagamento[] | undefined,
): { corte: FreelasCortePagamento; deadline: Date; pagamento: Date } | null {
  if (!cortes || cortes.length === 0) return null;
  const from = new Date(dataEncerramentoISO);
  if (isNaN(from.getTime())) return null;
  const opcoes = cortes.map(c => {
    const deadline = proxDiaHora(from, c.corteDiaSemana, c.corteHora);
    return { corte: c, deadline, pagamento: proxDiaApos(deadline, c.pagamentoDiaSemana) };
  });
  opcoes.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
  return opcoes[0];
}

export const fmtDataBR = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

// Utilitários de data — sempre lidamos em horário local pra evitar shift de timezone.

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(n => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

export function daysInMonth(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate();
}

export function firstDayOfMonth(ano: number, mes: number): Date {
  return new Date(ano, mes - 1, 1);
}

const DOW_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function dowShort(d: Date): string {
  return DOW_SHORT[d.getDay()];
}

const MES_NOME = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
export function nomeMes(mes: number): string {
  return MES_NOME[mes - 1];
}

export function todayYmd(): string {
  return ymd(new Date());
}

// "2026-05" → { ano: 2026, mes: 5 }
export function parseAnoMes(s: string): { ano: number; mes: number } {
  const [a, m] = s.split("-").map(n => parseInt(n, 10));
  return { ano: a, mes: m };
}
export function fmtAnoMes(ano: number, mes: number): string {
  return `${ano}-${pad2(mes)}`;
}

// Avança/retrocede mês (ano vira)
export function shiftMonth(ano: number, mes: number, delta: number): { ano: number; mes: number } {
  let m = mes + delta;
  let a = ano;
  while (m < 1)  { m += 12; a -= 1; }
  while (m > 12) { m -= 12; a += 1; }
  return { ano: a, mes: m };
}

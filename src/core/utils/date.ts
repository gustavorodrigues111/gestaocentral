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

// ─── Formatação BR ────────────────────────────────────────────────────────
// Padrão do sistema: datas sempre exibidas em DD/MM/AAAA.

// "YYYY-MM-DD" ou ISO completo → "DD/MM/AAAA". Vazio/nulo → "".
export function fmtBR(s: string | null | undefined): string {
  if (!s) return "";
  // YYYY-MM-DD puro: split direto (não cria Date pra não mexer com timezone)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  // ISO ou outra string parseável: deixa Date converter pro fuso local
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ISO → "DD/MM/AAAA HH:mm". Aceita YYYY-MM-DD puro (sem hora).
export function fmtBRDateTime(s: string | null | undefined): string {
  if (!s) return "";
  // Sem hora: cai pro fmtBR puro
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtBR(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

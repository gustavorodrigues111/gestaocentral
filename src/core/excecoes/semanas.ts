// ════════════════════════════════════════════════════════════════════════════
//  Helpers de semana — usado pelo Relatório de Exceções e pelo workflow de
//  status. Convenção: segunda como 1º dia da semana.
// ════════════════════════════════════════════════════════════════════════════

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Segunda-feira da semana que contém `date` (timezone local).
export function inicioDaSemana(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0=dom..6=sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Domingo da semana que contém `date`.
export function fimDaSemana(date: Date): Date {
  const d = inicioDaSemana(date);
  d.setDate(d.getDate() + 6);
  return d;
}

export type SemanaInfo = {
  index: number;        // 1-based dentro do mês (1ª semana = 1)
  weekStart: string;    // YYYY-MM-DD — clampado ao 1º dia do mês quando truncada
  weekEnd: string;      // YYYY-MM-DD — clampado ao último dia do mês quando truncada
  label: string;        // "Sem 1 (1–3 mai)" — truncada mostra "✂" no tooltip
  containsToday: boolean;
  truncadaInicio: boolean;  // true quando a semana cronológica começa no mês anterior
  truncadaFim: boolean;     // true quando termina no mês seguinte
};

// Retorna todas as semanas que TOCAM o mês [ano, mes]. CADA SEMANA É
// CLAMPADA aos limites do mês — semana que cruza a virada de mês é cortada
// pra não atravessar fechamento de folha. Isso significa:
//   - Se 1º do mês é uma quarta, a "Sem 1" vai de qua a dom (5 dias, truncada).
//   - Se o último dia é uma terça, a última "semana" vai de seg a ter (2 dias).
//   - A mesma semana cronológica pode aparecer como 2 entradas separadas em
//     meses diferentes (1 doc de status por entrada, fechando o mês limpo).
export function semanasDoMes(ano: number, mes: number, hoje = new Date()): SemanaInfo[] {
  const primeiroDia = new Date(ano, mes - 1, 1);
  const ultimoDia = new Date(ano, mes, 0); // dia 0 do próximo mês = último dia deste
  const primeiroYmd = fmtYmd(primeiroDia);
  const ultimoYmd = fmtYmd(ultimoDia);
  const inicio = inicioDaSemana(primeiroDia);

  const out: SemanaInfo[] = [];
  let cur = new Date(inicio);
  let idx = 1;
  const todayYmd = fmtYmd(hoje);
  let guard = 0;
  while (guard < 10) {
    const start = new Date(cur);
    const end = new Date(cur);
    end.setDate(end.getDate() + 6);
    const startYmd = fmtYmd(start);
    const endYmd = fmtYmd(end);
    // Se a semana inteira ficou antes do mês, pula
    if (endYmd < primeiroYmd) {
      cur.setDate(cur.getDate() + 7);
      guard += 1;
      continue;
    }
    // Se a semana começa depois do mês, encerra
    if (startYmd > ultimoYmd) break;

    const truncadaInicio = startYmd < primeiroYmd;
    const truncadaFim    = endYmd   > ultimoYmd;
    const startClamp = truncadaInicio ? primeiroYmd : startYmd;
    const endClamp   = truncadaFim    ? ultimoYmd   : endYmd;
    out.push({
      index: idx,
      weekStart: startClamp,
      weekEnd: endClamp,
      label: fmtLabelSemana(idx, parseYmd(startClamp), parseYmd(endClamp), truncadaInicio || truncadaFim),
      containsToday: todayYmd >= startClamp && todayYmd <= endClamp,
      truncadaInicio,
      truncadaFim,
    });
    cur.setDate(cur.getDate() + 7);
    idx += 1;
    guard += 1;
  }
  return out;
}

const MESES_ABREV = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function fmtLabelSemana(idx: number, start: Date, end: Date, truncada: boolean): string {
  const d1 = start.getDate();
  const d2 = end.getDate();
  const m1 = MESES_ABREV[start.getMonth()];
  const m2 = MESES_ABREV[end.getMonth()];
  const marca = truncada ? "✂" : "";
  if (start.getMonth() === end.getMonth()) {
    return `Sem ${idx} (${d1}–${d2} ${m1})${marca}`;
  }
  return `Sem ${idx} (${d1}${m1}–${d2}${m2})${marca}`;
}

// Encontra a semana que contém hoje, dentro do array de semanas.
// Retorna o index (1-based) ou null se hoje não está em nenhuma das semanas.
export function semanaAtualIndex(semanas: SemanaInfo[]): number | null {
  const s = semanas.find((w) => w.containsToday);
  return s ? s.index : null;
}

// Calcula o ano/mês da semana que contém uma data.
// (útil quando o usuário muda a data e queremos abrir o mês correspondente)
export function mesDaSemanaContendoData(ymd: string): { ano: number; mes: number } {
  const start = inicioDaSemana(parseYmd(ymd));
  return { ano: start.getFullYear(), mes: start.getMonth() + 1 };
}

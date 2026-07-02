// Motor de recorrência das Rotinas — funções puras sobre "YYYY-MM-DD".
// Não gera docs por ocorrência: calcula se uma rotina vence numa data e qual a
// próxima/última data devida. Conclusões ficam em rotinaConclusoes.
import type { RotinaRecorrencia } from "../../core/types";

function parse(ymd: string): [number, number, number] {
  const p = ymd.split("-").map(Number);
  return [p[0], (p[1] || 1) - 1, p[2] || 1];
}
function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function addDias(ymd: string, n: number): string {
  const [y, m, d] = parse(ymd);
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + n);
  return toYmd(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function weekday(ymd: string): number {
  const [y, m, d] = parse(ymd);
  return new Date(y, m, d).getDay();
}
function diasNoMes(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}
// Dia do mês (1..31) da N-ésima ocorrência de um dia-da-semana. posicao -1 = última.
function diaDaPosicao(y: number, m: number, diaSemana: number, posicao: number): number | null {
  const total = diasNoMes(y, m);
  const dias: number[] = [];
  for (let d = 1; d <= total; d++) {
    if (new Date(y, m, d).getDay() === diaSemana) dias.push(d);
  }
  if (dias.length === 0) return null;
  if (posicao === -1) return dias[dias.length - 1];
  return dias[posicao - 1] ?? null;
}

export function venceEm(rec: RotinaRecorrencia, ymd: string): boolean {
  const [y, m, d] = parse(ymd);
  switch (rec.tipo) {
    case "semanal":
      return rec.diasSemana.includes(weekday(ymd));
    case "mensal_dia": {
      const alvo = Math.min(rec.diaDoMes, diasNoMes(y, m)); // dia 31 → último dia
      return d === alvo;
    }
    case "mensal_posicao": {
      const alvo = diaDaPosicao(y, m, rec.diaSemana, rec.posicao);
      return alvo != null && d === alvo;
    }
    case "quinzenal": {
      if (!rec.dataBase || ymd < rec.dataBase) return false;
      const [by, bm, bd] = parse(rec.dataBase);
      const diff = Math.round((new Date(y, m, d).getTime() - new Date(by, bm, bd).getTime()) / 86400000);
      return diff >= 0 && diff % 14 === 0;
    }
    default:
      return false;
  }
}

// Última data devida <= hoje (pra rotina "vencida e não feita" seguir cobrando).
export function ultimaDataDevida(rec: RotinaRecorrencia, hoje: string, lookbackDias = 90): string | null {
  let ymd = hoje;
  for (let i = 0; i <= lookbackDias; i++) {
    if (venceEm(rec, ymd)) return ymd;
    ymd = addDias(ymd, -1);
  }
  return null;
}

// Próxima data devida >= a partir de (pra exibir "próxima: dd/mm").
export function proximaData(rec: RotinaRecorrencia, apartirDe: string, lookaheadDias = 400): string | null {
  let ymd = apartirDe;
  for (let i = 0; i <= lookaheadDias; i++) {
    if (venceEm(rec, ymd)) return ymd;
    ymd = addDias(ymd, 1);
  }
  return null;
}

// Rótulo curto da recorrência pra UI.
const DIAS_SEMANA_ABREV = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const POSICAO_LABEL: Record<number, string> = { 1: "1ª", 2: "2ª", 3: "3ª", 4: "4ª", [-1]: "última" };
export function recorrenciaLabel(rec: RotinaRecorrencia): string {
  switch (rec.tipo) {
    case "semanal":
      return rec.diasSemana.length === 0
        ? "Semanal"
        : "Toda " + rec.diasSemana.slice().sort((a, b) => a - b).map(d => DIAS_SEMANA_ABREV[d]).join(", ");
    case "mensal_dia":
      return rec.diaDoMes >= 31 ? "Mensal — último dia" : `Mensal — dia ${rec.diaDoMes}`;
    case "mensal_posicao":
      return `Mensal — ${POSICAO_LABEL[rec.posicao] || rec.posicao} ${DIAS_SEMANA_ABREV[rec.diaSemana]}`;
    case "quinzenal":
      return "Quinzenal";
    default:
      return "—";
  }
}

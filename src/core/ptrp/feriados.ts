// ════════════════════════════════════════════════════════════════════════════
//  PTRP — feriados. Nacionais fixos (lei) + Sexta-feira Santa (móvel, via
//  Páscoa) + feriados MUNICIPAIS da CCT (calendarioFeriados). Alimenta o
//  ehFeriado da apuração (adicional de feriado da convenção).
// ════════════════════════════════════════════════════════════════════════════
import type { ParametrosCCT } from "./tipos";

// Nacionais FIXOS (MM-DD). Inclui Consciência Negra (nacional desde 2024).
const NACIONAIS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];

// Domingo de Páscoa (algoritmo de Gauss/Butcher, calendário gregoriano).
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const somaDias = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);

// Conjunto de feriados (YYYY-MM-DD) de um ANO, pra uma CCT (municipais inclusos).
export function feriadosDoAno(ano: number, cct?: ParametrosCCT | null): Set<string> {
  const s = new Set<string>();
  for (const md of NACIONAIS_FIXOS) s.add(`${ano}-${md}`);
  const p = pascoa(ano);
  s.add(ymd(somaDias(p, -2)));   // Sexta-feira Santa (nacional)
  // Municipais da convenção (MM-DD), ex.: Belém/PA 08-15 e 12-08.
  for (const f of cct?.calendarioFeriados?.feriados || []) if (f.data) s.add(`${ano}-${f.data}`);
  return s;
}

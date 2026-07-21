// Motor de recorrência dos Prazos — funções PURAS (testáveis). Dado o
// vencimento atual e a regra, calcula o PRÓXIMO vencimento. Dia útil = só tira
// fim de semana (feriado fica pra depois). Datas em "YYYY-MM-DD".
import type { PrazoRecorrencia } from "../../core/types";

const DIAS_SEMANA_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// ── Helpers de data (sem timezone: meio-dia local pra evitar drift) ──
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parse(ymd: string): Date {
  const [a, m, d] = ymd.split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1, 12, 0, 0);
}
function ehFimDeSemana(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}
function ultimoDiaDoMes(ano: number, mes0: number): number {
  return new Date(ano, mes0 + 1, 0).getDate();
}

// Nº-ésimo dia útil do mês (seg–sex). Se n excede os dias úteis, retorna o último.
export function nthDiaUtil(ano: number, mes0: number, n: number): Date {
  const ult = ultimoDiaDoMes(ano, mes0);
  let contados = 0, ultimoUtil = 1;
  for (let dia = 1; dia <= ult; dia++) {
    const d = new Date(ano, mes0, dia, 12, 0, 0);
    if (!ehFimDeSemana(d)) { contados++; ultimoUtil = dia; if (contados === n) return d; }
  }
  return new Date(ano, mes0, ultimoUtil, 12, 0, 0);
}
export function ultimoDiaUtil(ano: number, mes0: number): Date {
  const ult = ultimoDiaDoMes(ano, mes0);
  for (let dia = ult; dia >= 1; dia--) {
    const d = new Date(ano, mes0, dia, 12, 0, 0);
    if (!ehFimDeSemana(d)) return d;
  }
  return new Date(ano, mes0, 1, 12, 0, 0);
}

// Data do prazo num mês específico, conforme o modo (dia absoluto ou dia útil).
function dataNoMes(rec: PrazoRecorrencia, ano: number, mes0: number): Date {
  if (rec.modo === "dia_util") {
    return rec.diaUtil === "ultimo" ? ultimoDiaUtil(ano, mes0) : nthDiaUtil(ano, mes0, Math.max(1, Number(rec.diaUtil) || 1));
  }
  const dia = Math.min(Math.max(1, rec.diaDoMes || 1), ultimoDiaDoMes(ano, mes0));
  return new Date(ano, mes0, dia, 12, 0, 0);
}

// Próximo vencimento ESTRITAMENTE depois de `apartirDe` (default = vencimento atual).
// Retorna null se a regra for inválida.
export function proximoVencimento(rec: PrazoRecorrencia | null | undefined, apartirDe: string): string | null {
  if (!rec) return null;
  const base = parse(apartirDe);
  const intervalo = Math.max(1, Math.round(rec.intervalo || 1));

  if (rec.unidade === "mes") {
    // Anda de `intervalo` em `intervalo` meses a partir do mês base até passar de `apartirDe`.
    let ano = base.getFullYear(), mes0 = base.getMonth();
    for (let i = 0; i < 240; i++) {
      const cand = dataNoMes(rec, ano, mes0);
      if (cand.getTime() > base.getTime()) return toYmd(cand);
      mes0 += intervalo;
      ano += Math.floor(mes0 / 12);
      mes0 = ((mes0 % 12) + 12) % 12;
    }
    return null;
  }

  // Semana: próximo dia da semana selecionado, respeitando "a cada N semanas".
  const dias = (rec.diasSemana || []).slice().sort((a, b) => a - b);
  if (!dias.length) return null;
  // Âncora = início (domingo) da semana do vencimento atual → define as semanas "on".
  const anchorWeekStart = new Date(base);
  anchorWeekStart.setDate(base.getDate() - base.getDay());
  anchorWeekStart.setHours(12, 0, 0, 0);
  const MS_SEMANA = 7 * 24 * 3600 * 1000;
  const cursor = new Date(base);
  for (let i = 0; i < 3660; i++) {
    cursor.setDate(cursor.getDate() + 1);
    if (!dias.includes(cursor.getDay())) continue;
    const weekStart = new Date(cursor);
    weekStart.setDate(cursor.getDate() - cursor.getDay());
    weekStart.setHours(12, 0, 0, 0);
    const semanasDesde = Math.round((weekStart.getTime() - anchorWeekStart.getTime()) / MS_SEMANA);
    if (semanasDesde % intervalo === 0) return toYmd(cursor);
  }
  return null;
}

// Rótulo curto da recorrência ("Todo dia 20 do mês", "5º dia útil, a cada 2 meses"…).
export function resumoRecorrencia(rec: PrazoRecorrencia | null | undefined): string {
  if (!rec) return "Não repete";
  const n = Math.max(1, Math.round(rec.intervalo || 1));
  if (rec.unidade === "mes") {
    const base = rec.modo === "dia_util"
      ? (rec.diaUtil === "ultimo" ? "Último dia útil" : `${rec.diaUtil || 1}º dia útil`)
      : `Dia ${rec.diaDoMes || 1}`;
    return n === 1 ? `${base} do mês` : `${base}, a cada ${n} meses`;
  }
  const nomes = (rec.diasSemana || []).slice().sort((a, b) => a - b).map((d) => DIAS_SEMANA_CURTO[d]);
  if (!nomes.length) return "Semanal";
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes.slice(-1)}`;
  return n === 1 ? `Toda ${lista}` : `${lista}, a cada ${n} semanas`;
}

export { toYmd as ymd, parse as parseYmd };

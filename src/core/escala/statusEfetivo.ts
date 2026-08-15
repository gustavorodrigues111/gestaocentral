// ════════════════════════════════════════════════════════════════════════════
// Status efetivo da escala (override ∪ derivado)
// ════════════════════════════════════════════════════════════════════════════
//
// Modelo conceitual:
//   Prevista de um empregado = horário cadastrado dele, sempre.
//                              Em cima, o gestor pode editar dias pontuais
//                              (vaga, banco de horas, compensação, troca).
//                              Esses dias viram OVERRIDES gravados.
//
//   Praticada               = o que aconteceu no mês. Por default igual à
//                              prevista; gestor edita dia a dia conforme
//                              o mês acontece.
//
// VT, gorjeta e relatórios precisam ler o **status efetivo** — não só o que
// foi gravado. Caso contrário, empregado com horário cadastrado mas sem
// nenhum override gravado some do cálculo (bug Marcelo: admitido pós-fech.
// da prevista, VT zera).
//
// Este módulo centraliza essa resolução. Convenções:
//   versao="prevista" → derivado, sobrescrito por escala.prevista[empId]
//   versao="real"     → derivado, sobrescrito por escala.prevista[empId],
//                       depois por escala.real[empId]
//
// Empregados inativos em determinado dia (admitido depois / demitido antes)
// não entram nem no derivado nem no override — ficam fora.

import type { Empregado, EscalaMes, Modalidade, ScheduleStatus } from "../types";
import { derivedScheduleForEmpregado, modalidadeDerivadaDia } from "./horarios";

// Fase 2 — prevista FECHADA para um empregado específico. Se o mês usa o mapa
// por empregado (previstaFechadaPorEmp), ele é a fonte da verdade (empregado fora
// do mapa = editável, ex.: admitido no meio do mês). Meses antigos sem o mapa →
// cai no flag do doc (previstaFechadaEm) — retrocompatível.
export function previstaFechadaParaEmp(escala: EscalaMes | null, empregadoId: string): boolean {
  if (!escala) return false;
  if (escala.previstaFechadaPorEmp) return !!escala.previstaFechadaPorEmp[empregadoId];
  return !!escala.previstaFechadaEm;
}

// Modalidade EFETIVA de um dia: override real (praticada) → override prevista →
// derivado do cadastro → presencial. Afeta só o VT.
export function modalidadeEfetivaEmpDia(
  emp: Empregado, escala: EscalaMes | null, date: string, versao: "prevista" | "real",
): Modalidade {
  if (versao === "real") {
    const r = escala?.modalidadeReais?.[emp.id]?.[date];
    if (r) return r;
  }
  const p = escala?.modalidadePrevistas?.[emp.id]?.[date];
  if (p) return p;
  return modalidadeDerivadaDia(emp, date);
}

/**
 * Status efetivo de UM empregado em TODOS os dias do mês.
 *
 * Combina o derivado do horário cadastrado com os overrides gravados
 * em escala.prevista[empId] (e, se versao="real", também escala.real[empId]).
 *
 * O resultado tem entrada apenas pros dias em que o empregado estava ativo
 * (admitido ≤ dia ≤ demissão, se houver) E tinha alguma indicação de
 * status (derivado OU override).
 */
export function statusEfetivoEmpMes(
  empregado: Empregado,
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  versao: "prevista" | "real" = "prevista",
): { [date: string]: ScheduleStatus } {
  const derived = derivedScheduleForEmpregado(empregado, ano, mes);
  const overrideP = escala?.prevista?.[empregado.id] || {};
  const overrideR = versao === "real" ? (escala?.real?.[empregado.id] || {}) : {};

  const result: { [date: string]: ScheduleStatus } = {};
  // base: derivado
  for (const date of Object.keys(derived)) {
    const d = derived[date];
    if (d?.status) result[date] = d.status;
  }
  // override de prevista por cima
  for (const date of Object.keys(overrideP)) {
    const st = overrideP[date];
    if (st !== undefined) result[date] = st;
  }
  // se versao=real, override de real por cima de tudo
  if (versao === "real") {
    for (const date of Object.keys(overrideR)) {
      const st = overrideR[date];
      if (st !== undefined) result[date] = st;
    }
  }
  return result;
}

/**
 * Status efetivo de UM empregado em UM dia específico.
 *
 * Não cria mapa completo do mês — útil em hot-path tipo cálculo de gorjeta
 * (1 dia × N empregados). Internamente ainda chama derivedScheduleForEmpregado
 * (que computa o mês inteiro), então pra iterar muitos dias do mesmo
 * empregado, prefira statusEfetivoEmpMes.
 */
export function statusEfetivoEmpDia(
  empregado: Empregado,
  escala: EscalaMes | null,
  date: string,
  versao: "prevista" | "real" = "prevista",
): ScheduleStatus | undefined {
  // override tem precedência
  if (versao === "real") {
    const r = escala?.real?.[empregado.id]?.[date];
    if (r !== undefined) return r;
  }
  const p = escala?.prevista?.[empregado.id]?.[date];
  if (p !== undefined) return p;
  // fallback no derivado
  const [yStr, mStr] = date.split("-");
  const y = parseInt(yStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return undefined;
  const derived = derivedScheduleForEmpregado(empregado, y, m);
  return derived[date]?.status;
}

/**
 * Variante pra muitos empregados num único dia. Recebe o mapa de derivados
 * já calculado (1× por empregado pra todo o mês) — eficiente em loops do
 * tipo "calcular divisão de gorjeta do dia".
 */
export function statusEfetivoComDerivado(
  empregadoId: string,
  escala: EscalaMes | null,
  derivadosEmp: { [date: string]: { status: ScheduleStatus } } | undefined,
  date: string,
  versao: "prevista" | "real" = "prevista",
): ScheduleStatus | undefined {
  if (versao === "real") {
    const r = escala?.real?.[empregadoId]?.[date];
    if (r !== undefined) return r;
  }
  const p = escala?.prevista?.[empregadoId]?.[date];
  if (p !== undefined) return p;
  return derivadosEmp?.[date]?.status;
}

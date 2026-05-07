import type { Empregado } from "../types";

// Empregado estava ativo (algum período cobre essa data)?
// Período = { admissao: YYYY-MM-DD, demissao?: YYYY-MM-DD (null = vigente) }
// demissao é o PRIMEIRO dia FORA — então se demissao = "2026-05-01", o último dia
// trabalhado foi "2026-04-30". `dateStr >= demissao` significa "fora".
export function empregadoAtivoEm(emp: Empregado, dateStr: string): boolean {
  for (const p of emp.periodos || []) {
    if (dateStr < p.admissao) continue;
    if (p.demissao && dateStr >= p.demissao) continue;
    return true;
  }
  return false;
}

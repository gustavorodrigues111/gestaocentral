import type { Empregado, MudancaAgendada } from "../types";

// Projeta o estado do empregado para uma data de referência, aplicando as
// mudanças AGENDADAS (data futura) cujo `aplicarEm` <= dataRef e que ainda não
// foram aplicadas (aplicadoEm null). Usado pra que cálculos de mês futuro (VT,
// VR) já reflitam mudanças como "desligar VT a partir de 1/6" antes do dia
// chegar — caso contrário o registro ao vivo só muda na data e o lote do mês
// futuro continuaria com o valor antigo.
//
// dataRef recomendado: 1º dia do mês do lote (`YYYY-MM-01`) — assim a mudança
// vale pro mês inteiro só se entrar em vigor no começo dele.
export function projetarEmpregadoParaData(
  emp: Empregado,
  mudancas: MudancaAgendada[],
  dataRef: string,
): Empregado {
  const pendentes = mudancas
    .filter(m =>
      m.entityType === "empregado" &&
      m.entityId === emp.id &&
      !m.aplicadoEm &&
      m.aplicarEm <= dataRef,
    )
    .sort((a, b) => a.aplicarEm.localeCompare(b.aplicarEm));
  if (pendentes.length === 0) return emp;
  const proj = { ...emp } as Record<string, unknown>;
  for (const m of pendentes) proj[m.campo] = m.valorNovo;
  return proj as unknown as Empregado;
}

// Aplica a projeção a uma lista inteira de empregados.
export function projetarEmpregadosParaData(
  empregados: Empregado[],
  mudancas: MudancaAgendada[],
  dataRef: string,
): Empregado[] {
  if (mudancas.length === 0) return empregados;
  return empregados.map(e => projetarEmpregadoParaData(e, mudancas, dataRef));
}

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

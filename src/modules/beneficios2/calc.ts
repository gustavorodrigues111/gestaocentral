// ════════════════════════════════════════════════════════════════════════════
//  Motor de cálculo do PAGAMENTO de benefícios (módulo novo).
//  Regra: valor DIÁRIO × dias de trabalho na escala PREVISTA + auxílio fixo.
//  "Dias de trabalho" = statuses `trabalho` + `comp_trab` (reaproveita a contagem
//  do VT, que já aplica essa regra). Proporcionalidade de admissão/demissão sai
//  de graça: a escala só tem dias de trabalho nos dias em que a pessoa está ativa.
//  Funções PURAS (testáveis) — nada de Firestore aqui.
// ════════════════════════════════════════════════════════════════════════════
import type { Empregado, Cargo, EscalaMes, BeneficioPagLinha, ScheduleStatus } from "../../core/types";
import { contarDiasTrabalhados, round2 } from "../vt/calc";
import { derivedScheduleForEmpregado } from "../../core/escala/horarios";
import { statusEfetivoEmpMes, modalidadeEfetivaEmpDia } from "../../core/escala/statusEfetivo";
import { empregadoAtivoEm } from "../../core/utils/empregado";
import { daysInMonth, pad2 } from "../../core/utils/date";

// Empregado ativo em ALGUM dia do mês (mesma regra de /escala e do VT).
export function ativoNoMes(emp: Empregado, ano: number, mes: number): boolean {
  const inicio = `${ano}-${pad2(mes)}-01`;
  const fim = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
  for (const p of emp.periodos || []) {
    if (p.admissao > fim) continue;
    if (p.demissao && p.demissao <= inicio) continue;
    return true;
  }
  return false;
}

// VT diário do empregado: usa vtValorDiario; se ausente, cai no legado
// passagens/dia × valor da passagem (retrocompat durante a transição).
export function vtDiarioDe(e: Empregado): number {
  if (e.vtValorDiario != null) return e.vtValorDiario;
  return round2((e.vtPassagensPorDia ?? 0) * (e.vtValorPassagem ?? 0));
}

// Divisor da proporcionalidade do AUXÍLIO fixo mensal: quantos dias a pessoa
// trabalharia num MÊS CHEIO segundo o horário cadastrado (ignora admissão/
// demissão). null = sem cadastro de horário → não dá pra proporcionalizar, então
// paga o auxílio cheio (mantém o comportamento atual, sem regressão).
export function diasPrevistosMesCheio(emp: Empregado, ano: number, mes: number): number | null {
  if (!(emp.workSchedules || []).length) return null;
  const derived = derivedScheduleForEmpregado(emp, ano, mes, { ignorarVigencia: true });
  let n = 0;
  for (const k of Object.keys(derived)) if (derived[k].status === "trabalho") n++;
  return n > 0 ? n : null;
}

// Proporção do auxílio: dias efetivos ÷ mês cheio (teto 1). Sem cadastro → 1.
export function proporcaoAuxilio(emp: Empregado, dias: number, ano: number, mes: number): number {
  const cheio = diasPrevistosMesCheio(emp, ano, mes);
  return cheio ? Math.min(1, dias / cheio) : 1;
}

// VR conta dias trabalhados + ATESTADO (falta_j) — decisão: atestado paga VR.
// (o VT NÃO conta atestado; por isso VR e VT deixam de compartilhar o predicado.)
const STATUS_CONTA_VR: Record<ScheduleStatus, boolean> = {
  trabalho: true, comp_trab: true, falta_j: true,
  comp: false, freela: false, folga: false, ferias: false, falta_i: false,
};
export function contarDiasVR(emp: Empregado, escala: EscalaMes | null, ano: number, mes: number, versao: "prevista" | "real"): number {
  const dias = statusEfetivoEmpMes(emp, escala, ano, mes, versao);
  let n = 0;
  for (const k of Object.keys(dias)) if (STATUS_CONTA_VR[dias[k]]) n++;
  return n;
}

// VT diário conta trabalho/comp_trab (o mesmo que dias trabalhados).
const EH_TRABALHO_VT: Record<ScheduleStatus, boolean> = {
  trabalho: true, comp_trab: true,
  comp: false, freela: false, folga: false, ferias: false, falta_j: false, falta_i: false,
};
// VT diário: só dias trabalhados E PRESENCIAIS (home office não paga VT).
export function contarDiasVtPresencial(emp: Empregado, escala: EscalaMes | null, ano: number, mes: number, versao: "prevista" | "real"): number {
  const dias = statusEfetivoEmpMes(emp, escala, ano, mes, versao);
  let n = 0;
  for (const d of Object.keys(dias)) {
    if (EH_TRABALHO_VT[dias[d]] && modalidadeEfetivaEmpDia(emp, escala, d, versao) === "presencial") n++;
  }
  return n;
}

// Contadores por JANELA [de, ate] (usados no ajuste). respeitarDemissao = dia
// pós-demissão não conta (a praticada nasce cópia da prevista).
export function contarDiasVtPresencialRange(emp: Empregado, escala: EscalaMes | null, ano: number, mes: number, de: string, ate: string, versao: "prevista" | "real", respeitarDemissao: boolean): number {
  const dias = statusEfetivoEmpMes(emp, escala, ano, mes, versao);
  let n = 0;
  for (const d of Object.keys(dias)) {
    if (d < de || d > ate) continue;
    if (respeitarDemissao && !empregadoAtivoEm(emp, d)) continue;
    if (EH_TRABALHO_VT[dias[d]] && modalidadeEfetivaEmpDia(emp, escala, d, versao) === "presencial") n++;
  }
  return n;
}
export function contarDiasVrRange(emp: Empregado, escala: EscalaMes | null, ano: number, mes: number, de: string, ate: string, versao: "prevista" | "real", respeitarDemissao: boolean): number {
  const dias = statusEfetivoEmpMes(emp, escala, ano, mes, versao);
  let n = 0;
  for (const d of Object.keys(dias)) {
    if (d < de || d > ate) continue;
    if (respeitarDemissao && !empregadoAtivoEm(emp, d)) continue;
    if (STATUS_CONTA_VR[dias[d]]) n++;
  }
  return n;
}

// Monta as linhas do lote de pagamento a partir da escala PREVISTA do mês.
// `usaVR` = Restaurant.usaVR (algumas empresas não têm VR).
export function montarLinhasPagamento(
  empregados: Empregado[],
  cargos: Cargo[],
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  usaVR: boolean,
  ajustePorEmp: Record<string, number> = {},   // desconto/crédito do mês anterior
): BeneficioPagLinha[] {
  const cargoNomeDe = new Map(cargos.map((c) => [c.id, c.nome] as const));
  const linhas: BeneficioPagLinha[] = [];
  for (const e of empregados) {
    if (!ativoNoMes(e, ano, mes)) continue;
    const vtAtivo = !!e.vtAtivo;
    const vrAtivo = usaVR && !!e.vrAtivo;
    const auxVt = e.vtAuxilioFixoMensal ?? 0;
    const auxVr = usaVR ? (e.vrAuxilioFixoMensal ?? 0) : 0;
    // Sem nenhum benefício configurado → nem entra na lista.
    if (!vtAtivo && !vrAtivo && auxVt <= 0 && auxVr <= 0) continue;

    const dias = contarDiasTrabalhados(e, escala, ano, mes, "prevista");        // trabalhados (base do auxílio)
    const diasVT = contarDiasVtPresencial(e, escala, ano, mes, "prevista");     // presenciais (base do VT diário)
    const diasVR = contarDiasVR(e, escala, ano, mes, "prevista");               // VR conta atestado
    const vtValorDiario = vtDiarioDe(e);
    const vrValorDiario = e.vrValorDiario ?? 0;
    // Auxílio fixo PROPORCIONAL ao mês cheio (admissão/demissão/faltas).
    const prop = proporcaoAuxilio(e, dias, ano, mes);
    const auxVtProp = round2(auxVt * prop);
    const auxVrProp = round2(auxVr * prop);
    const vtTotal = round2((vtAtivo ? diasVT * vtValorDiario : 0) + auxVtProp);  // VT só nos presenciais
    const vrTotal = round2((vrAtivo ? diasVR * vrValorDiario : 0) + auxVrProp);
    const ajuste = round2(ajustePorEmp[e.id] || 0);

    const cargo = (e as { cargoId?: string }).cargoId;
    linhas.push({
      empregadoId: e.id,
      empregadoNome: e.nome,
      cargoNome: (cargo && cargoNomeDe.get(cargo)) || null,
      area: (e as { area?: string | null }).area ?? null,
      forma: e.formaBeneficio || "caju",
      chavePix: e.chavePix || null,
      diasTrabalhados: dias,
      diasVtPresencial: diasVT,
      diasVr: diasVR,
      vtAtivo,
      vtValorDiario,
      vtAuxFixo: auxVtProp,
      vtTotal,
      vrAtivo,
      vrValorDiario,
      vrAuxFixo: auxVrProp,
      vrTotal,
      ajuste,
      total: round2(vtTotal + vrTotal + ajuste),
      semConfig: (vtAtivo && vtValorDiario <= 0) || (vrAtivo && vrValorDiario <= 0),
    });
  }
  return linhas.sort((a, b) => a.empregadoNome.localeCompare(b.empregadoNome, "pt-BR"));
}

// Recalcula os totais de uma linha após edição de valor (valor-dia ou auxílio)
// por lote. Usa as bases de dias já congeladas na linha (presencial p/ VT, VR p/ VR).
export function recalcularLinha(l: BeneficioPagLinha): BeneficioPagLinha {
  const diasVT = l.diasVtPresencial ?? l.diasTrabalhados;
  const diasVR = l.diasVr ?? l.diasTrabalhados;
  const vtTotal = round2((l.vtAtivo ? diasVT * l.vtValorDiario : 0) + (l.vtAuxFixo || 0));
  const vrTotal = round2((l.vrAtivo ? diasVR * l.vrValorDiario : 0) + (l.vrAuxFixo || 0));
  return { ...l, vtTotal, vrTotal, total: round2(vtTotal + vrTotal + (l.ajuste || 0)) };
}

export function totaisDoLote(linhas: BeneficioPagLinha[]): { totalVt: number; totalVr: number; totalAjuste: number; totalGeral: number } {
  const totalVt = round2(linhas.reduce((s, l) => s + l.vtTotal, 0));
  const totalVr = round2(linhas.reduce((s, l) => s + l.vrTotal, 0));
  const totalAjuste = round2(linhas.reduce((s, l) => s + (l.ajuste || 0), 0));
  return { totalVt, totalVr, totalAjuste, totalGeral: round2(totalVt + totalVr + totalAjuste) };
}

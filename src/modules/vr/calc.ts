// Cálculo do VR (Vale Refeição) — espelho simplificado do VT.
// Diferenças do VT:
//   • Valor é diário direto (não tem "passagens por dia × valor")
//   • Falta JUSTIFICADA não gera desconto (regra de negócio da Quibebe)
//   • Sem features de parcial / ajuste / overlap por enquanto (MVP)

import type { Empregado, EscalaMes, ScheduleStatus, Cargo, Area, VRLote, VRLoteLinha } from "../../core/types";
import { daysInMonth, nomeMes, pad2 } from "../../core/utils/date";
import { statusEfetivoEmpMes } from "../../core/escala/statusEfetivo";

// Empregado ativo em algum dia do mês (mesma regra do VT)
function ativoEmAlgumDiaDoMes(emp: Empregado, ano: number, mes: number): boolean {
  const inicio = `${ano}-${pad2(mes)}-01`;
  const fim    = `${ano}-${pad2(mes)}-${pad2(daysInMonth(ano, mes))}`;
  for (const p of emp.periodos || []) {
    if (p.admissao > fim) continue;
    if (p.demissao && p.demissao <= inicio) continue;
    return true;
  }
  return false;
}

// Status que conta como dia "trabalhou" pra VR (igual VT — só dias presentes
// geram refeição paga).
const STATUS_TRABALHADO: Record<ScheduleStatus, boolean> = {
  trabalho:  true,
  comp_trab: true,
  freela:    false,
  folga:     false,
  comp:      false,
  ferias:    false,
  falta_j:   false,
  falta_i:   false,
};

// Status que GERAM DESCONTO no VR do mês seguinte (refMes = lote.mes − 2).
// REGRA VR: falta_j NÃO desconta (atestado, etc).
const STATUS_DESCONTA_VR: Record<ScheduleStatus, boolean> = {
  trabalho:  false,
  comp_trab: true,
  freela:    true,
  folga:     true,
  comp:      true,
  ferias:    true,
  falta_j:   false,  // ← diferente do VT
  falta_i:   true,
};

const STATUS_LABEL: Record<ScheduleStatus, string> = {
  trabalho:  "trabalho",
  folga:     "folga",
  freela:    "freela",
  comp:      "comp",
  comp_trab: "comp_trab",
  ferias:    "férias",
  falta_j:   "falta_j",
  falta_i:   "falta_i",
};

export function contarDiasTrabalhados(
  empregado: Empregado,
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  versao: "prevista" | "real" = "prevista",
): number {
  const dias = statusEfetivoEmpMes(empregado, escala, ano, mes, versao);
  let n = 0;
  for (const k of Object.keys(dias)) {
    if (STATUS_TRABALHADO[dias[k]]) n++;
  }
  return n;
}

export type DescontoSugeridoVR = {
  valor: number;
  justificativa: string;
  refMesYm: string;
  ocorrencias: { dia: number; status: ScheduleStatus }[];
};

export function calcularDescontoSugerido(
  empregado: Empregado,
  valorDiario: number,
  escalaRef: EscalaMes | null,
  refAno: number,
  refMes: number,
): DescontoSugeridoVR {
  const refMesYm = `${refAno}-${pad2(refMes)}`;
  const mesNomeRef = nomeMes(refMes).slice(0, 3).toLowerCase();
  const anoCurto = String(refAno).slice(2);

  if (!escalaRef) {
    return { valor: 0, justificativa: `Sem escala em ${mesNomeRef}/${anoCurto} — desconto = 0`, refMesYm, ocorrencias: [] };
  }
  const dias = statusEfetivoEmpMes(empregado, escalaRef, refAno, refMes, "real");
  if (Object.keys(dias).length === 0) {
    return { valor: 0, justificativa: `Sem lançamentos em ${mesNomeRef}/${anoCurto} — desconto = 0`, refMesYm, ocorrencias: [] };
  }
  const ocorrencias: { dia: number; status: ScheduleStatus }[] = [];
  for (const dateStr of Object.keys(dias)) {
    const st = dias[dateStr];
    if (STATUS_DESCONTA_VR[st]) {
      const dia = parseInt(dateStr.slice(-2), 10);
      ocorrencias.push({ dia, status: st });
    }
  }
  ocorrencias.sort((a, b) => a.dia - b.dia);
  const qtd = ocorrencias.length;
  const valor = Math.round(qtd * valorDiario * 100) / 100;
  let justificativa = "";
  if (qtd === 0) {
    justificativa = `Sem ocorrências em ${mesNomeRef}/${anoCurto}`;
  } else {
    const listaResumida = ocorrencias.slice(0, 6).map(o => `${o.dia} (${STATUS_LABEL[o.status]})`).join(", ");
    const sufixo = qtd > 6 ? `, +${qtd - 6}` : "";
    justificativa = `${qtd} ${qtd === 1 ? "ocorrência" : "ocorrências"} (sem faltas justificadas) em ${mesNomeRef}/${anoCurto}: ${listaResumida}${sufixo}`;
  }
  return { valor, justificativa, refMesYm, ocorrencias };
}

// Monta as linhas pro preview do lote VR.
export function montarLinhasLote(params: {
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;        // do mês do lote (pra dias trabalhados)
  escalaRefDesconto: EscalaMes | null; // mês de referência (lote.mes − 2)
  ano: number;                     // ano do lote
  mes: number;                     // mês do lote (1-12)
  refAno: number;
  refMes: number;
}): VRLoteLinha[] {
  const { empregados, cargos, escala, escalaRefDesconto, ano, mes, refAno, refMes } = params;
  const cargoMap = Object.fromEntries(cargos.map(c => [c.id, c]));

  const linhas: VRLoteLinha[] = [];

  for (const e of empregados) {
    if (!ativoEmAlgumDiaDoMes(e, ano, mes)) continue;
    if (!e.vrAtivo && !(e.vrAuxilioFixoMensal && e.vrAuxilioFixoMensal > 0)) continue;

    const cargo = cargoMap[e.cargoId];
    const cargoNome = cargo?.nome || "";
    const area: Area = cargo?.area || "Salão";

    const valorDiario = e.vrValorDiario ?? 0;
    const auxFixoMensal = e.vrAuxilioFixoMensal ?? 0;

    const diasTrabalhados = e.vrAtivo ? contarDiasTrabalhados(e, escala, ano, mes, "prevista") : 0;
    const vrBase = Math.round(diasTrabalhados * valorDiario * 100) / 100;

    const desc = calcularDescontoSugerido(e, valorDiario, escalaRefDesconto, refAno, refMes);

    const total = Math.round((auxFixoMensal + vrBase - desc.valor) * 100) / 100;

    linhas.push({
      empregadoId: e.id,
      nome: e.nome,
      cargoNome,
      area,
      valorDiario,
      diasTrabalhados,
      auxFixoMensal,
      vrBase,
      descontoSugeridoAtivo: true,
      descontoSugerido: desc.valor,
      descontoSugeridoJustificativa: desc.justificativa,
      descontoSugeridoRefMes: desc.refMesYm,
      descontoManual: 0,
      auxPontual: 0,
      total,
    });
  }

  // Ordena por área (Salão, Bar, Cozinha, Limpeza) e nome
  const ordemArea: Record<string, number> = { "Salão": 1, "Bar": 2, "Cozinha": 3, "Limpeza": 4 };
  linhas.sort((a, b) => {
    const da = (ordemArea[a.area] || 99) - (ordemArea[b.area] || 99);
    if (da !== 0) return da;
    return a.nome.localeCompare(b.nome);
  });

  return linhas;
}

// Recalcula o total de UMA linha quando descontoManual/auxPontual mudam.
export function recalcularTotal(linha: VRLoteLinha): number {
  const desconto = linha.descontoSugeridoAtivo ? linha.descontoSugerido : 0;
  return Math.round(
    (linha.auxFixoMensal + linha.vrBase - desconto - linha.descontoManual + linha.auxPontual) * 100
  ) / 100;
}

// Total geral + por área (snapshot).
export function calcularTotais(linhas: VRLoteLinha[]): { totalGeral: number; totalPorArea: Record<string, number> } {
  let totalGeral = 0;
  const totalPorArea: Record<string, number> = {};
  for (const l of linhas) {
    totalGeral += l.total;
    totalPorArea[l.area] = (totalPorArea[l.area] || 0) + l.total;
  }
  totalGeral = Math.round(totalGeral * 100) / 100;
  for (const k of Object.keys(totalPorArea)) {
    totalPorArea[k] = Math.round(totalPorArea[k] * 100) / 100;
  }
  return { totalGeral, totalPorArea };
}

// Re-export tipo pra conveniência
export type { VRLote, VRLoteLinha };

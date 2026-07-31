// ════════════════════════════════════════════════════════════════════════════
//  Motor de cálculo do PAGAMENTO de benefícios (módulo novo).
//  Regra: valor DIÁRIO × dias de trabalho na escala PREVISTA + auxílio fixo.
//  "Dias de trabalho" = statuses `trabalho` + `comp_trab` (reaproveita a contagem
//  do VT, que já aplica essa regra). Proporcionalidade de admissão/demissão sai
//  de graça: a escala só tem dias de trabalho nos dias em que a pessoa está ativa.
//  Funções PURAS (testáveis) — nada de Firestore aqui.
// ════════════════════════════════════════════════════════════════════════════
import type { Empregado, Cargo, EscalaMes, BeneficioPagLinha } from "../../core/types";
import { contarDiasTrabalhados, round2 } from "../vt/calc";
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

// Monta as linhas do lote de pagamento a partir da escala PREVISTA do mês.
// `usaVR` = Restaurant.usaVR (algumas empresas não têm VR).
export function montarLinhasPagamento(
  empregados: Empregado[],
  cargos: Cargo[],
  escala: EscalaMes | null,
  ano: number,
  mes: number,
  usaVR: boolean,
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

    const dias = contarDiasTrabalhados(e, escala, ano, mes, "prevista");
    const vtValorDiario = vtDiarioDe(e);
    const vrValorDiario = e.vrValorDiario ?? 0;
    const vtTotal = round2((vtAtivo ? dias * vtValorDiario : 0) + auxVt);
    const vrTotal = round2((vrAtivo ? dias * vrValorDiario : 0) + auxVr);

    const cargo = (e as { cargoId?: string }).cargoId;
    linhas.push({
      empregadoId: e.id,
      empregadoNome: e.nome,
      cargoNome: (cargo && cargoNomeDe.get(cargo)) || null,
      area: (e as { area?: string | null }).area ?? null,
      forma: e.formaBeneficio || "caju",
      chavePix: e.chavePix || null,
      diasTrabalhados: dias,
      vtAtivo,
      vtValorDiario,
      vtAuxFixo: auxVt,
      vtTotal,
      vrAtivo,
      vrValorDiario,
      vrAuxFixo: auxVr,
      vrTotal,
      total: round2(vtTotal + vrTotal),
      semConfig: (vtAtivo && vtValorDiario <= 0) || (vrAtivo && vrValorDiario <= 0),
    });
  }
  return linhas.sort((a, b) => a.empregadoNome.localeCompare(b.empregadoNome, "pt-BR"));
}

export function totaisDoLote(linhas: BeneficioPagLinha[]): { totalVt: number; totalVr: number; totalGeral: number } {
  const totalVt = round2(linhas.reduce((s, l) => s + l.vtTotal, 0));
  const totalVr = round2(linhas.reduce((s, l) => s + l.vrTotal, 0));
  return { totalVt, totalVr, totalGeral: round2(totalVt + totalVr) };
}

// ════════════════════════════════════════════════════════════════════════════
//  Cálculo combinado de Benefícios (VT + VR num lote único)
//
//  Reaproveita 100% os motores de VT e VR já existentes (montarLinhasLote de
//  cada um) e mescla por empregadoId. Cada linha aninha o snapshot do VT
//  (Mobilidade, já com auxílio fixo no total) e do VR (Refeição).
//
//  VR é subconjunto do VT: ambos filtram por `ativoEmAlgumDiaDoMes` (mesma
//  regra), e o VT inclui TODO empregado ativo no mês (mesmo zerado), enquanto
//  o VR só inclui quem tem VR diário ou auxílio fixo de VR. Então iterar as
//  linhas de VT cobre todo mundo; pra quem não tem VR, anexamos um VR zerado.
// ════════════════════════════════════════════════════════════════════════════

import type { Area, Cargo, Empregado, EscalaMes, VRLoteLinha } from "../../core/types";
import { montarLinhasLote as montarVT, refMesDoLote, round2, type VTLoteLinhaPreview } from "../vt/calc";
import { montarLinhasLote as montarVR } from "../vr/calc";

export type BeneficiosLinhaPreview = {
  empregadoId: string;
  nome: string;
  cargoNome: string;
  area: Area;
  vt: VTLoteLinhaPreview;   // Mobilidade
  vr: VRLoteLinha;          // Refeição
  vtRecebePeloCaju: boolean;
  vrRecebePeloCaju: boolean;
  total: number;
};

function vrZerada(vt: VTLoteLinhaPreview): VRLoteLinha {
  return {
    empregadoId: vt.empregadoId,
    nome: vt.nome,
    cargoNome: vt.cargoNome,
    area: vt.area,
    valorDiario: 0,
    diasTrabalhados: 0,
    auxFixoMensal: 0,
    vrBase: 0,
    descontoSugeridoAtivo: false,
    descontoSugerido: 0,
    descontoManual: 0,
    auxPontual: 0,
    total: 0,
  };
}

export function montarLinhasBeneficios(args: {
  empregados: Empregado[];
  cargos: Cargo[];
  escalaLote: EscalaMes | null;     // escala do mês do lote (dias trabalhados)
  escalaRef: EscalaMes | null;      // escala do mês de referência (lote − 2) p/ desconto
  ano: number;
  mes: number;
}): BeneficiosLinhaPreview[] {
  const { empregados, cargos, escalaLote, escalaRef, ano, mes } = args;
  const ref = refMesDoLote(ano, mes);

  const vtLinhas = montarVT(empregados, cargos, escalaLote, escalaRef, ano, mes);
  const vrLinhas = montarVR({
    empregados, cargos,
    escala: escalaLote,
    escalaRefDesconto: escalaRef,
    ano, mes,
    refAno: ref.ano, refMes: ref.mes,
  });
  const vrById = new Map(vrLinhas.map(l => [l.empregadoId, l]));
  const empById = new Map(empregados.map(e => [e.id, e]));

  const linhas: BeneficiosLinhaPreview[] = vtLinhas.map(vt => {
    const vr = vrById.get(vt.empregadoId) || vrZerada(vt);
    const emp = empById.get(vt.empregadoId);
    return {
      empregadoId: vt.empregadoId,
      nome: vt.nome,
      cargoNome: vt.cargoNome,
      area: vt.area,
      vt,
      vr,
      vtRecebePeloCaju: emp?.vtRecebePeloCaju !== false,
      vrRecebePeloCaju: emp?.vrRecebePeloCaju !== false,
      total: round2(vt.total + vr.total),
    };
  });

  const ordemArea: Record<string, number> = { "Salão": 1, "Bar": 2, "Cozinha": 3, "Limpeza": 4 };
  linhas.sort((a, b) => {
    const da = (ordemArea[a.area] || 99) - (ordemArea[b.area] || 99);
    if (da !== 0) return da;
    return a.nome.localeCompare(b.nome);
  });
  return linhas;
}

// Totais do lote: geral, Mobilidade (Caju), Refeição (Caju) e por área.
export function totaisBeneficios(linhas: BeneficiosLinhaPreview[]): {
  totalGeral: number;
  totalMobilidade: number;
  totalRefeicao: number;
  totalPorArea: Record<string, number>;
} {
  let totalGeral = 0;
  let totalMobilidade = 0;
  let totalRefeicao = 0;
  const totalPorArea: Record<string, number> = {};
  for (const l of linhas) {
    totalGeral = round2(totalGeral + l.total);
    totalMobilidade = round2(totalMobilidade + l.vt.total);
    totalRefeicao = round2(totalRefeicao + l.vr.total);
    totalPorArea[l.area] = round2((totalPorArea[l.area] || 0) + l.total);
  }
  return { totalGeral, totalMobilidade, totalRefeicao, totalPorArea };
}

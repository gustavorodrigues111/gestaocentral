// Cálculo do fechamento de freela MENSALISTA.
//  • lista mensalistas ativos num mês-competência;
//  • soma a gorjeta do mês usando a MESMA lógica da Divisão do Mês
//    (snapshot se publicada, senão recalcula ao vivo) — líquido + bruto;
//  • conta os dias na escala (praticada, com fallback pra prevista).
import type { Cargo, DivisaoItem, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade } from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "../gorjetas/calc";
import { getActiveSplitVersion } from "../gorjetas/splitRules";

const STATUS_TRABALHADO_MENSALISTA = new Set(["trabalho", "comp_trab", "freela"]);

export function diasNoMes(ano: number, mes: number): number {
  return new Date(ano, mes, 0).getDate(); // mes 1-12
}

function periodoCobreMes(emp: Empregado, ini: string, fim: string): boolean {
  // fim = último dia do mês (inclusive). Período: [admissao, demissao) — demissao é 1º dia FORA.
  for (const p of emp.periodos || []) {
    const admOk = p.admissao <= fim;
    const demOk = !p.demissao || p.demissao > ini;
    if (admOk && demOk) return true;
  }
  return false;
}

export function mensalistasAtivosNoMes(empregados: Empregado[], ano: number, mes: number): Empregado[] {
  const mm = String(mes).padStart(2, "0");
  const ini = `${ano}-${mm}-01`;
  const fim = `${ano}-${mm}-${String(diasNoMes(ano, mes)).padStart(2, "0")}`;
  return empregados
    .filter(e => e.freelaMensalista === true && periodoCobreMes(e, ini, fim))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Soma da gorjeta do empregado no mês — mesma lógica da DivisaoMesTab:
// snapshot se publicada, senão recalcula a divisão do dia ao vivo.
export function gorjetaMensalDe(
  empId: string,
  gorjetas: Gorjeta[],
  empregados: Empregado[],
  cargos: Cargo[],
  escala: EscalaMes | null,
  splitVersions: SplitVersion[],
  unidades: Unidade[],
): { liquido: number; bruto: number; dias: number } {
  let liquido = 0, bruto = 0, dias = 0;
  for (const g of gorjetas) {
    const splitVersion = getActiveSplitVersion(splitVersions, g.date);
    const taxRate = (g.publicada && g.divisaoSnapshot) ? (g.taxRate || 0) : (splitVersion?.taxRate ?? 0);
    const fator = 1 - taxRate / 100;
    let itens: DivisaoItem[];
    if (g.publicada && g.divisaoSnapshot) {
      itens = g.divisaoSnapshot;
    } else {
      const liq = calcularValorLiquido(g.valorBruto, taxRate);
      itens = calcularDivisaoDia(g.date, liq, empregados, cargos, escala, splitVersion, g.unidadeId || null, unidades).itens;
    }
    const it = itens.find(i => i.empregadoId === empId);
    if (!it || !it.valor) continue;
    const liqEmp = it.valor;
    liquido += liqEmp;
    bruto += fator > 0 ? liqEmp / fator : liqEmp;
    dias++;
  }
  return { liquido: Math.round(liquido * 100) / 100, bruto: Math.round(bruto * 100) / 100, dias };
}

// Dias na escala no mês — praticada (real) com fallback pra prevista. Base do rateio.
export function diasTrabalhadosMensalista(empId: string, escala: EscalaMes | null, ano: number, mes: number): number {
  if (!escala) return 0;
  const real = escala.real?.[empId] || {};
  const prevista = escala.prevista?.[empId] || {};
  const mm = String(mes).padStart(2, "0");
  let n = 0;
  for (let d = 1; d <= diasNoMes(ano, mes); d++) {
    const date = `${ano}-${mm}-${String(d).padStart(2, "0")}`;
    const status = real[date] ?? prevista[date];   // real sobrepõe; senão prevista
    if (status && STATUS_TRABALHADO_MENSALISTA.has(String(status))) n++;
  }
  return n;
}

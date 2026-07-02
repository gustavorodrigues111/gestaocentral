// Cálculo do fechamento de freela MENSALISTA.
//  • lista mensalistas ativos num mês-competência;
//  • soma a gorjeta do mês (do divisaoSnapshot das gorjetas publicadas) —
//    líquido e bruto (bruto = liquido / (1 − taxRate/100));
//  • conta os dias trabalhados na escala praticada (base do rateio da remuneração).
import type { Empregado, EscalaMes, Gorjeta } from "../../core/types";

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

// Soma da gorjeta do empregado no mês, a partir do snapshot das gorjetas
// publicadas (líquido por pessoa já congelado). Bruto derivado pelo taxRate.
export function gorjetaMensalDe(empId: string, gorjetasDoMes: Gorjeta[]): { liquido: number; bruto: number; dias: number } {
  let liquido = 0, bruto = 0, dias = 0;
  for (const g of gorjetasDoMes) {
    const item = g.divisaoSnapshot?.find(i => i.empregadoId === empId);
    if (!item || !item.valor) continue;
    liquido += item.valor;
    const tax = typeof g.taxRate === "number" ? g.taxRate : 0;
    bruto += tax >= 100 ? item.valor : item.valor / (1 - tax / 100);
    dias++;
  }
  return {
    liquido: Math.round(liquido * 100) / 100,
    bruto: Math.round(bruto * 100) / 100,
    dias,
  };
}

// Dias trabalhados na PRATICADA (escala.real) no mês — base do rateio.
export function diasTrabalhadosMensalista(empId: string, escala: EscalaMes | null, ano: number, mes: number): number {
  if (!escala?.real?.[empId]) return 0;
  const mm = String(mes).padStart(2, "0");
  const prefixo = `${ano}-${mm}-`;
  let n = 0;
  for (const [date, status] of Object.entries(escala.real[empId])) {
    if (!date.startsWith(prefixo)) continue;
    if (STATUS_TRABALHADO_MENSALISTA.has(String(status))) n++;
  }
  return n;
}

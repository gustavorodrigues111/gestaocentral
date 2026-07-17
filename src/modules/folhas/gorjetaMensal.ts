// Agrega a gorjeta do MÊS por CPF, a partir dos docs DIÁRIOS já publicados da
// coleção `gorjetas`. Usa o divisaoSnapshot CONGELADO (o que de fato foi
// reportado/pago), não recalcula a divisão. Reconstrói o BRUTO por dia a partir
// do líquido distribuído: bruto = liquido / (1 − taxRate/100) — a mesma conta
// que a tela "Divisão do Mês" mostra. Some os dias e mapeia empregadoId → CPF.
//
// Por que bruto: o briefing (Bloco D) compara o BRUTO do app contra o bruto da
// verba 154/155 da folha. Tolerância de ±R$20 absorve o arredondamento diário.
import type { Gorjeta, Empregado } from "../../core/types";
import { cpfDigits } from "./tipos";

export type GorjetaMensalCpf = { cpf: string; nome: string; bruto: number; liquido: number; dias: number };

// competencia = "YYYY-MM". Considera só docs dessa competência, publicados,
// com snapshot e que não sejam "sem gorjeta".
export function gorjetaMensalPorCpf(
  gorjetas: Gorjeta[],
  empregados: Empregado[],
  competencia: string,
): { porCpf: Record<string, GorjetaMensalCpf>; semCpf: Array<{ empregadoId: string; nome: string; bruto: number }> } {
  const cpfDe = new Map<string, string>();       // empregadoId → cpf (dígitos)
  for (const e of empregados) { const c = cpfDigits(e.cpf); if (c) cpfDe.set(e.id, c); }

  const acc = new Map<string, { nome: string; bruto: number; liquido: number; dias: Set<string> }>();
  const semCpfAcc = new Map<string, { nome: string; bruto: number }>();

  for (const g of gorjetas) {
    if (!g.date || !g.date.startsWith(competencia)) continue;
    if (g.semGorjeta) continue;
    const snap = g.divisaoSnapshot;
    if (!snap || snap.length === 0) continue;
    const taxa = typeof g.taxRate === "number" ? g.taxRate : 0;
    const fator = 1 - taxa / 100;                // líquido = bruto × fator
    for (const it of snap) {
      const liquido = it.valor || 0;
      const bruto = fator > 0 ? liquido / fator : liquido;
      const cpf = cpfDe.get(it.empregadoId);
      if (!cpf) {
        const s = semCpfAcc.get(it.empregadoId) || { nome: it.empregadoNome || "", bruto: 0 };
        s.bruto += bruto; semCpfAcc.set(it.empregadoId, s);
        continue;
      }
      const a = acc.get(cpf) || { nome: it.empregadoNome || "", bruto: 0, liquido: 0, dias: new Set<string>() };
      a.bruto += bruto; a.liquido += liquido; a.dias.add(g.date);
      if (it.empregadoNome) a.nome = it.empregadoNome;
      acc.set(cpf, a);
    }
  }

  const porCpf: Record<string, GorjetaMensalCpf> = {};
  for (const [cpf, a] of acc) {
    porCpf[cpf] = { cpf, nome: a.nome, bruto: Math.round(a.bruto * 100) / 100, liquido: Math.round(a.liquido * 100) / 100, dias: a.dias.size };
  }
  const semCpf = [...semCpfAcc.entries()].map(([empregadoId, s]) => ({ empregadoId, nome: s.nome, bruto: Math.round(s.bruto * 100) / 100 }));
  return { porCpf, semCpf };
}

import { describe, it, expect } from "vitest";
import { ultimoDiaPraticada, apuracaoPraticada, proximaJanela, montarLinhasAjuste, ajustePorEmpregadoPendente } from "./ajuste";
import type { Empregado, EscalaMes, BeneficioPagLote, ScheduleStatus, BeneficioAjusteLote } from "../../core/types";

function emp(id: string, nome: string, over: Partial<Empregado> = {}): Empregado {
  return { id, nome, restaurantId: "r1", cargoId: "c1", vtAtivo: true, vtValorDiario: 10,
    periodos: [{ admissao: "2020-01-01", demissao: null, registradoEm: "2020-01-01", registradoPor: "x" }],
    ...over } as unknown as Empregado;
}
// Escala com prevista, praticada (real) e realAjustes (marca de apuração) por empregado.
function escala(prevista: Record<string, Record<string, ScheduleStatus>>, real: Record<string, Record<string, ScheduleStatus>>, realAjustes: Record<string, Record<string, { origem?: string }>> = {}): EscalaMes {
  return { id: "r1_2026-07", restaurantId: "r1", ano: 2026, mes: 7, prevista, real, realAjustes, previstaFechadaEm: "2026-06-30" } as unknown as EscalaMes;
}
// Gera N dias "trabalho" começando no dia `ini`.
function trabalho(ini: number, n: number): Record<string, ScheduleStatus> {
  const d: Record<string, ScheduleStatus> = {};
  for (let i = 0; i < n; i++) d[`2026-07-${String(ini + i).padStart(2, "0")}`] = "trabalho";
  return d;
}
// Marca N dias como apurados (solides_sync) começando em `ini`.
function apurado(ini: number, n: number): Record<string, { origem?: string }> {
  const d: Record<string, { origem?: string }> = {};
  for (let i = 0; i < n; i++) d[`2026-07-${String(ini + i).padStart(2, "0")}`] = { origem: "solides_sync" };
  return d;
}

describe("ultimoDiaPraticada / apuracaoPraticada", () => {
  it("último dia apurado (solides_sync), não a cópia da praticada", () => {
    // real tem o mês todo (cópia), mas só 1-10 estão apurados
    const esc = escala({}, { e1: trabalho(1, 31) }, { e1: apurado(1, 10) });
    expect(ultimoDiaPraticada(esc, "e1")).toBe("2026-07-10");
    expect(ultimoDiaPraticada(esc, "e2")).toBe(null);
  });
  it("sugere o mínimo entre todos e lista os pendentes", () => {
    const esc = escala({}, {}, { e1: apurado(1, 30), e2: apurado(1, 25) });
    const info = apuracaoPraticada([emp("e1", "Ana"), emp("e2", "Bia")], esc, 2026, 7);
    expect(info.sugerido).toBe("2026-07-25");            // mínimo (Bia atrasa)
    expect(info.pendentes.map((p) => p.empregadoId)).toEqual(["e2"]);
  });
  it("sem apuração de alguém → sem data sugerida, ele fica pendente", () => {
    const esc = escala({}, {}, { e1: apurado(1, 30) });
    const info = apuracaoPraticada([emp("e1", "Ana"), emp("e2", "Bia")], esc, 2026, 7);
    expect(info.sugerido).toBe(null);
    expect(info.pendentes.map((p) => p.empregadoId)).toContain("e2");
  });
});

describe("montarLinhasAjuste", () => {
  const pagamento = {
    id: "pg1", restaurantId: "r1", ano: 2026, mes: 7, status: "pago",
    linhas: [{ empregadoId: "e1", empregadoNome: "Ana", vtAtivo: true, vtValorDiario: 10, vrAtivo: false, vrValorDiario: 0 } as never],
  } as unknown as BeneficioPagLote;

  it("faltou 2 dias na janela → desconto negativo", () => {
    // prevista 1-20 trabalho; praticada 1-18 trabalho + 19/20 falta (apurado até 20)
    const esc = escala(
      { e1: trabalho(1, 20) },
      { e1: { ...trabalho(1, 18), "2026-07-19": "falta_i", "2026-07-20": "falta_i" } },
    );
    const linhas = montarLinhasAjuste({ pagamento, empregados: [emp("e1", "Ana")], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-20", usaVR: false });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].ajusteDias).toBe(-2);
    expect(linhas[0].ajusteVt).toBe(-20);               // -2 × 10
    expect(linhas[0].ajusteTotal).toBe(-20);
  });

  it("trabalhou 1 dia a mais → crédito positivo", () => {
    // prevista 1-20 trabalho + 21 folga; praticada 1-21 trabalho (veio no dia de folga)
    const esc = escala(
      { e1: { ...trabalho(1, 20), "2026-07-21": "folga" } },
      { e1: trabalho(1, 21) },
    );
    const linhas = montarLinhasAjuste({ pagamento, empregados: [emp("e1", "Ana")], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-21", usaVR: false });
    expect(linhas[0].ajusteDias).toBe(1);
    expect(linhas[0].ajusteVt).toBe(10);
  });

  it("sem diferença → não gera linha", () => {
    const esc = escala({ e1: trabalho(1, 20) }, { e1: trabalho(1, 20) });
    const linhas = montarLinhasAjuste({ pagamento, empregados: [emp("e1", "Ana")], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-20", usaVR: false });
    expect(linhas).toHaveLength(0);
  });
});

describe("proximaJanela (cursor)", () => {
  const pg = { id: "pg1", ano: 2026, mes: 7 } as BeneficioPagLote;
  it("sem ajustes anteriores → começa no dia 01", () => {
    expect(proximaJanela(pg, [])).toEqual({ de: "2026-07-01" });
  });
  it("com ajuste até dia 25 → próxima janela começa no 26", () => {
    const ajustes = [{ pagamentoLoteId: "pg1", status: "pendente", janelaAte: "2026-07-25" }] as unknown as BeneficioAjusteLote[];
    expect(proximaJanela(pg, ajustes)).toEqual({ de: "2026-07-26" });
  });
});

describe("ajustePorEmpregadoPendente", () => {
  it("soma os ajustes pendentes por empregado (aplicado/cancelado ignorados)", () => {
    const ajustes = [
      { status: "pendente", linhas: [{ empregadoId: "e1", ajusteTotal: -20 }, { empregadoId: "e2", ajusteTotal: 10 }] },
      { status: "pendente", linhas: [{ empregadoId: "e1", ajusteTotal: -5 }] },
      { status: "aplicado", linhas: [{ empregadoId: "e1", ajusteTotal: -100 }] },
    ] as unknown as BeneficioAjusteLote[];
    expect(ajustePorEmpregadoPendente(ajustes)).toEqual({ e1: -25, e2: 10 });
  });
});

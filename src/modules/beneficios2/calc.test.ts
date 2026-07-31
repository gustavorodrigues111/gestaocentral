import { describe, it, expect } from "vitest";
import { montarLinhasPagamento, vtDiarioDe, ativoNoMes, totaisDoLote } from "./calc";
import type { Empregado, EscalaMes, Cargo, ScheduleStatus } from "../../core/types";

// Empregado sem horário → derivedSchedule vazio → os dias vêm só do override `prevista`,
// o que deixa os testes determinísticos.
function emp(over: Partial<Empregado>): Empregado {
  return {
    id: "e1", nome: "Fulano", restaurantId: "r1", cargoId: "c1",
    periodos: [{ admissao: "2020-01-01", demissao: null, registradoEm: "2020-01-01", registradoPor: "x" }],
    ...over,
  } as unknown as Empregado;
}

function escala(empId: string, dias: Record<string, ScheduleStatus>): EscalaMes {
  return { id: "r1_2026-07", restaurantId: "r1", ano: 2026, mes: 7, prevista: { [empId]: dias }, real: {} } as unknown as EscalaMes;
}

// 21 dias de trabalho (20 "trabalho" + 1 "comp_trab") + dias que NÃO contam.
function diasPadrao(): Record<string, ScheduleStatus> {
  const d: Record<string, ScheduleStatus> = {};
  for (let i = 1; i <= 20; i++) d[`2026-07-${String(i).padStart(2, "0")}`] = "trabalho";
  d["2026-07-21"] = "comp_trab"; // trabalho por compensação → conta
  d["2026-07-22"] = "comp";      // folga por compensação → NÃO conta
  d["2026-07-23"] = "folga";     // NÃO conta
  d["2026-07-24"] = "falta_i";   // NÃO conta
  d["2026-07-25"] = "freela";    // NÃO conta
  // Preenche o resto do mês como folga (senão o dia cai no derivado do horário).
  for (let i = 26; i <= 31; i++) d[`2026-07-${i}`] = "folga";
  return d;
}

const cargos: Cargo[] = [{ id: "c1", nome: "Garçom" } as unknown as Cargo];

describe("vtDiarioDe", () => {
  it("usa vtValorDiario quando presente", () => {
    expect(vtDiarioDe(emp({ vtValorDiario: 12.5 }))).toBe(12.5);
  });
  it("cai no legado passagens×valor quando não tem valor diário", () => {
    expect(vtDiarioDe(emp({ vtPassagensPorDia: 2, vtValorPassagem: 4.4 }))).toBe(8.8);
  });
});

describe("ativoNoMes", () => {
  it("ativo no mês inteiro", () => {
    expect(ativoNoMes(emp({}), 2026, 7)).toBe(true);
  });
  it("admitido depois do fim do mês → fora", () => {
    expect(ativoNoMes(emp({ periodos: [{ admissao: "2026-08-10", demissao: null }] as never }), 2026, 7)).toBe(false);
  });
  it("demitido antes do mês → fora", () => {
    expect(ativoNoMes(emp({ periodos: [{ admissao: "2020-01-01", demissao: "2026-06-30" }] as never }), 2026, 7)).toBe(false);
  });
});

describe("montarLinhasPagamento", () => {
  it("VT = dias de trabalho × valor diário + auxílio fixo", () => {
    const e = emp({ vtAtivo: true, vtValorDiario: 10, vtAuxilioFixoMensal: 50 });
    const linhas = montarLinhasPagamento([e], cargos, escala("e1", diasPadrao()), 2026, 7, false);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].diasTrabalhados).toBe(21);          // 20 trabalho + 1 comp_trab
    expect(linhas[0].vtTotal).toBe(260);                 // 21×10 + 50
    expect(linhas[0].vrTotal).toBe(0);                   // sem VR
    expect(linhas[0].total).toBe(260);
  });

  it("VR só entra quando a empresa usa VR (usaVR=true)", () => {
    const e = emp({ vtAtivo: false, vrAtivo: true, vrValorDiario: 20 });
    const semVR = montarLinhasPagamento([e], cargos, escala("e1", diasPadrao()), 2026, 7, false);
    expect(semVR).toHaveLength(0);                       // sem VT e VR desligado (usaVR=false) → não entra
    const comVR = montarLinhasPagamento([e], cargos, escala("e1", diasPadrao()), 2026, 7, true);
    expect(comVR).toHaveLength(1);
    expect(comVR[0].vrTotal).toBe(420);                  // 21×20
    expect(comVR[0].vtTotal).toBe(0);
  });

  it("empregado sem nenhum benefício configurado é ignorado", () => {
    const e = emp({});
    expect(montarLinhasPagamento([e], cargos, escala("e1", diasPadrao()), 2026, 7, true)).toHaveLength(0);
  });

  it("empregado inativo no mês é ignorado", () => {
    const e = emp({ vtAtivo: true, vtValorDiario: 10, periodos: [{ admissao: "2026-08-01", demissao: null }] as never });
    expect(montarLinhasPagamento([e], cargos, escala("e1", diasPadrao()), 2026, 7, false)).toHaveLength(0);
  });

  it("badge da forma de recebimento (caju/pix) e chave", () => {
    const e = emp({ vtAtivo: true, vtValorDiario: 10, formaBeneficio: "pix", chavePix: "fulano@x.com" });
    const l = montarLinhasPagamento([e], cargos, escala("e1", diasPadrao()), 2026, 7, false)[0];
    expect(l.forma).toBe("pix");
    expect(l.chavePix).toBe("fulano@x.com");
  });

  it("só auxílio fixo (sem dias/valor diário) ainda paga o auxílio", () => {
    const e = emp({ vtAuxilioFixoMensal: 30 });
    const l = montarLinhasPagamento([e], cargos, escala("e1", {}), 2026, 7, false)[0];
    expect(l.vtTotal).toBe(30);
    expect(l.total).toBe(30);
  });
});

describe("totaisDoLote", () => {
  it("soma VT, VR e geral", () => {
    const linhas = [
      { vtTotal: 100, vrTotal: 50 },
      { vtTotal: 200, vrTotal: 0 },
    ] as never;
    expect(totaisDoLote(linhas)).toEqual({ totalVt: 300, totalVr: 50, totalGeral: 350 });
  });
});

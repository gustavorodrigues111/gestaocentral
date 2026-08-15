import { describe, it, expect } from "vitest";
import { montarLinhasPagamento, vtDiarioDe, ativoNoMes, totaisDoLote, diasPrevistosMesCheio, proporcaoAuxilio, contarDiasVR, recalcularLinha } from "./calc";
import type { Empregado, EscalaMes, Cargo, ScheduleStatus, WorkSchedule } from "../../core/types";

// Horário com todos os 7 dias ativos → mês cheio = todos os dias do mês.
function wsTodosDias(): WorkSchedule {
  const day = { active: true, in: "08:00", out: "16:00" };
  const days: Record<number, unknown> = {};
  for (let i = 0; i <= 6; i++) days[i] = day;
  return { validFrom: "2020-01-01", type: "single", totalContract: 0, days, registradoEm: "2020-01-01", registradoPor: "x" } as unknown as WorkSchedule;
}

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

describe("diasPrevistosMesCheio (divisor da proporcionalidade)", () => {
  it("sem cadastro de horário → null (não proporcionaliza)", () => {
    expect(diasPrevistosMesCheio(emp({}), 2026, 7)).toBeNull();
  });
  it("com horário de todos os dias → mês cheio = dias do mês (jul=31)", () => {
    expect(diasPrevistosMesCheio(emp({ workSchedules: [wsTodosDias()] as never }), 2026, 7)).toBe(31);
  });
  it("ignora admissão no meio do mês (conta o mês inteiro)", () => {
    const e = emp({ workSchedules: [wsTodosDias()] as never, periodos: [{ admissao: "2026-07-16", demissao: null }] as never });
    expect(diasPrevistosMesCheio(e, 2026, 7)).toBe(31);   // mês cheio, não os 16 dias ativos
  });
});

describe("proporcaoAuxilio", () => {
  it("sem cadastro → 1 (paga cheio)", () => {
    expect(proporcaoAuxilio(emp({}), 12, 2026, 7)).toBe(1);
  });
  it("proporcional aos dias ÷ mês cheio", () => {
    expect(proporcaoAuxilio(emp({ workSchedules: [wsTodosDias()] as never }), 16, 2026, 7)).toBeCloseTo(16 / 31, 6);
  });
  it("teto em 1 (dias > mês cheio)", () => {
    expect(proporcaoAuxilio(emp({ workSchedules: [wsTodosDias()] as never }), 40, 2026, 7)).toBe(1);
  });
});

describe("auxílio proporcional no pagamento", () => {
  it("admissão dia 16 com horário → auxílio proporcional ao mês cheio", () => {
    // 310 × 16/31 = 160. VT diário desligado; só o auxílio (proporcional).
    const e = emp({ vtAtivo: false, vtAuxilioFixoMensal: 310, workSchedules: [wsTodosDias()] as never,
      periodos: [{ admissao: "2026-07-16", demissao: null }] as never });
    const l = montarLinhasPagamento([e], cargos, escala("e1", {}), 2026, 7, false)[0];
    expect(l.diasTrabalhados).toBe(16);       // dias 16..31
    expect(l.vtTotal).toBe(160);              // auxílio proporcional
  });
  it("sem cadastro de horário → auxílio cheio (sem regressão)", () => {
    const e = emp({ vtAtivo: false, vtAuxilioFixoMensal: 250,
      periodos: [{ admissao: "2026-07-16", demissao: null }] as never });
    const l = montarLinhasPagamento([e], cargos, escala("e1", {}), 2026, 7, false)[0];
    expect(l.vtTotal).toBe(250);              // cheio — não dá pra proporcionalizar
  });
});

describe("VR conta atestado (falta_j)", () => {
  it("VR paga o dia de atestado; VT não conta", () => {
    const dias: Record<string, ScheduleStatus> = {};
    for (let i = 1; i <= 20; i++) dias[`2026-07-${String(i).padStart(2, "0")}`] = "trabalho";
    dias["2026-07-21"] = "falta_j"; dias["2026-07-22"] = "falta_j";  // 2 atestados
    for (let i = 23; i <= 31; i++) dias[`2026-07-${i}`] = "folga";
    const e = emp({ vtAtivo: true, vtValorDiario: 10, vrAtivo: true, vrValorDiario: 20 });
    expect(contarDiasVR(e, escala("e1", dias), 2026, 7, "prevista")).toBe(22);  // 20 + 2 atestado
    const l = montarLinhasPagamento([e], cargos, escala("e1", dias), 2026, 7, true)[0];
    expect(l.diasTrabalhados).toBe(20);       // VT não conta atestado
    expect(l.vtTotal).toBe(200);              // 20 × 10
    expect(l.vrTotal).toBe(440);              // 22 × 20 (atestado paga VR)
  });
});

describe("VT presencial × home office", () => {
  it("dia home office na prevista → não paga VT diário, mas paga VR e conta como trabalhado", () => {
    const dias: Record<string, ScheduleStatus> = {};
    for (let i = 1; i <= 22; i++) dias[`2026-07-${String(i).padStart(2, "0")}`] = "trabalho";
    for (let i = 23; i <= 31; i++) dias[`2026-07-${i}`] = "folga";
    const esc = {
      id: "r1_2026-07", restaurantId: "r1", ano: 2026, mes: 7, prevista: { e1: dias }, real: {},
      modalidadePrevistas: { e1: { "2026-07-01": "home_office", "2026-07-02": "home_office" } },
    } as unknown as EscalaMes;
    const e = emp({ vtAtivo: true, vtValorDiario: 10, vrAtivo: true, vrValorDiario: 20 });
    const l = montarLinhasPagamento([e], cargos, esc, 2026, 7, true)[0];
    expect(l.diasTrabalhados).toBe(22);      // home office continua trabalhado
    expect(l.diasVtPresencial).toBe(20);     // 2 dias home office fora do VT
    expect(l.diasVr).toBe(22);               // VR paga home office
    expect(l.vtTotal).toBe(200);             // 20 × 10 (presenciais)
    expect(l.vrTotal).toBe(440);             // 22 × 20
  });
});

describe("recalcularLinha (valor editável por lote)", () => {
  it("recomputa VT/VR/total ao editar valor-dia e auxílio", () => {
    const base = { empregadoId: "e1", empregadoNome: "Ana", forma: "caju", diasTrabalhados: 20,
      diasVtPresencial: 20, diasVr: 20, vtAtivo: true, vtValorDiario: 10, vtAuxFixo: 0,
      vrAtivo: true, vrValorDiario: 20, vrAuxFixo: 0, ajuste: 0 } as unknown as import("../../core/types").BeneficioPagLinha;
    const editada = recalcularLinha({ ...base, vtValorDiario: 12, vrValorDiario: 25, vtAuxFixo: 50 });
    expect(editada.vtTotal).toBe(290);   // 20×12 + 50
    expect(editada.vrTotal).toBe(500);   // 20×25
    expect(editada.total).toBe(790);
  });
});

describe("totaisDoLote", () => {
  it("soma VT, VR e geral", () => {
    const linhas = [
      { vtTotal: 100, vrTotal: 50 },
      { vtTotal: 200, vrTotal: 0 },
    ] as never;
    expect(totaisDoLote(linhas)).toEqual({ totalVt: 300, totalVr: 50, totalAjuste: 0, totalGeral: 350 });
  });
});

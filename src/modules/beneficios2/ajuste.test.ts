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
  it("demitido não trava a apuração: fora das pendências e não puxa o cursor", () => {
    // Bia demitida dia 02 (sem sync); Ana apurada até 30. Só a Ana vale pro cursor.
    const bia = emp("e2", "Bia", { periodos: [{ admissao: "2020-01-01", demissao: "2026-07-02", registradoEm: "x", registradoPor: "x" }] });
    const esc = escala({}, {}, { e1: apurado(1, 30) });
    const info = apuracaoPraticada([emp("e1", "Ana"), bia], esc, 2026, 7, "2026-07-30");
    expect(info.pendentes.map((p) => p.empregadoId)).not.toContain("e2");
    expect(info.sugerido).toBe("2026-07-30");   // só a Ana; Bia não zera o cursor
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

  it("demitido: acerto do mês PAGO inteiro, descontando tudo após a demissão", () => {
    // Camila demitida dia 02 (último dia trabalhado = 01). Prevista+praticada = cópia
    // do mês (trabalho 1-20), mas ela só esteve ativa no dia 01. Pago = 20 dias.
    const camila = emp("e1", "Camila", { periodos: [{ admissao: "2020-01-01", demissao: "2026-07-02", registradoEm: "x", registradoPor: "x" }] });
    const pg = { id: "pg1", restaurantId: "r1", ano: 2026, mes: 7, status: "pago",
      linhas: [{ empregadoId: "e1", empregadoNome: "Camila", vtAtivo: true, vtValorDiario: 10, vrAtivo: false, vrValorDiario: 0, diasTrabalhados: 20 } as never],
    } as unknown as BeneficioPagLote;
    const esc = escala({ e1: trabalho(1, 20) }, { e1: trabalho(1, 20) });
    // Janela apurada dos ATIVOS é curta (10-15); o demitido ignora isso e fecha o mês.
    const linhas = montarLinhasAjuste({ pagamento: pg, empregados: [camila], escala: esc, ano: 2026, mes: 7, de: "2026-07-10", ate: "2026-07-15", usaVR: false });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].demissao).toBe(true);
    expect(linhas[0].diasPrevista).toBe(20);        // dias pagos (frozen)
    expect(linhas[0].diasPraticada).toBe(1);        // só o dia 01, ativo
    expect(linhas[0].ajusteDias).toBe(-19);
    expect(linhas[0].ajusteVt).toBe(-190);
    expect(linhas[0].diasDesconto).toHaveLength(19);  // dias 02..20
  });

  it("aux fixo mensal: falta desconta aux/dias-previstos × dias faltados", () => {
    // aux 250; prevista 22 dias de trabalho (23-31 folga); faltou 2 (dias 21-22).
    const prev = { ...trabalho(1, 22), "2026-07-23": "folga", "2026-07-24": "folga", "2026-07-25": "folga", "2026-07-26": "folga", "2026-07-27": "folga", "2026-07-28": "folga", "2026-07-29": "folga", "2026-07-30": "folga", "2026-07-31": "folga" } as Record<string, ScheduleStatus>;
    const real = { ...trabalho(1, 20), "2026-07-21": "falta_i", "2026-07-22": "falta_i", ...Object.fromEntries(Object.entries(prev).filter(([d]) => d >= "2026-07-23")) } as Record<string, ScheduleStatus>;
    const esc = escala({ e1: prev }, { e1: real });
    const pg = { id: "pg1", restaurantId: "r1", ano: 2026, mes: 7, status: "pago",
      linhas: [{ empregadoId: "e1", empregadoNome: "Ana", vtAtivo: true, vtValorDiario: 10, vtAuxFixo: 250, vrAtivo: false, vrValorDiario: 0, diasTrabalhados: 22 } as never],
    } as unknown as BeneficioPagLote;
    const linhas = montarLinhasAjuste({ pagamento: pg, empregados: [emp("e1", "Ana")], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-22", usaVR: false });
    expect(linhas[0].ajusteDias).toBe(-2);
    expect(linhas[0].ajusteAuxVt).toBe(-22.73);       // 250/22 × -2
    expect(linhas[0].ajusteVt).toBe(-42.73);          // -20 (VT) + -22.73 (aux)
  });

  it("aux fixo mensal: demissão desconta aux/30 proporcional aos dias trabalhados", () => {
    // Camila demitida dia 02, trabalhou só 01; aux 250 pago cheio.
    const camila = emp("e1", "Camila", { periodos: [{ admissao: "2020-01-01", demissao: "2026-07-02", registradoEm: "x", registradoPor: "x" }] });
    const esc = escala({ e1: trabalho(1, 20) }, { e1: trabalho(1, 20) });
    const pg = { id: "pg1", restaurantId: "r1", ano: 2026, mes: 7, status: "pago",
      linhas: [{ empregadoId: "e1", empregadoNome: "Camila", vtAtivo: true, vtValorDiario: 10, vtAuxFixo: 250, vrAtivo: false, vrValorDiario: 0, diasTrabalhados: 20 } as never],
    } as unknown as BeneficioPagLote;
    const linhas = montarLinhasAjuste({ pagamento: pg, empregados: [camila], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-31", usaVR: false });
    expect(linhas[0].demissao).toBe(true);
    expect(linhas[0].ajusteAuxVt).toBe(-241.67);      // 250/30 × 1 − 250
    expect(linhas[0].ajusteVt).toBe(-431.67);         // -190 (VT) + -241.67 (aux)
  });

  it("demitido já acertado não gera nova linha (evita desconto em dobro)", () => {
    const camila = emp("e1", "Camila", { periodos: [{ admissao: "2020-01-01", demissao: "2026-07-02", registradoEm: "x", registradoPor: "x" }] });
    const pg = { id: "pg1", restaurantId: "r1", ano: 2026, mes: 7, status: "pago",
      linhas: [{ empregadoId: "e1", empregadoNome: "Camila", vtAtivo: true, vtValorDiario: 10, vrAtivo: false, vrValorDiario: 0, diasTrabalhados: 20 } as never],
    } as unknown as BeneficioPagLote;
    const esc = escala({ e1: trabalho(1, 20) }, { e1: trabalho(1, 20) });
    const anteriores = [{ pagamentoLoteId: "pg1", status: "pendente", linhas: [{ empregadoId: "e1", demissao: true, ajusteTotal: -190 }] }] as unknown as BeneficioAjusteLote[];
    const linhas = montarLinhasAjuste({ pagamento: pg, empregados: [camila], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-31", usaVR: false, ajustesAnteriores: anteriores });
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

describe("home office no ajuste (eixo do VT)", () => {
  it("home office na praticada → desconta só o VT do dia; dias trabalhados e VR ficam", () => {
    const esc = {
      id: "r1_2026-07", restaurantId: "r1", ano: 2026, mes: 7,
      prevista: { e1: trabalho(1, 10) }, real: { e1: trabalho(1, 10) }, realAjustes: { e1: apurado(1, 10) },
      modalidadeReais: { e1: { "2026-07-05": "home_office" } }, previstaFechadaEm: "2026-06-30",
    } as unknown as EscalaMes;
    const pg = { id: "pg1", ano: 2026, mes: 7, linhas: [
      { empregadoId: "e1", empregadoNome: "Ana", vtAtivo: true, vtValorDiario: 10, vrAtivo: true, vrValorDiario: 20, diasTrabalhados: 10, diasVtPresencial: 10, diasVr: 10 } as never,
    ] } as unknown as BeneficioPagLote;
    const linhas = montarLinhasAjuste({ pagamento: pg, empregados: [emp("e1", "Ana")], escala: esc, ano: 2026, mes: 7, de: "2026-07-01", ate: "2026-07-10", usaVR: true });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].ajusteDias).toBe(0);    // trabalhou os mesmos 10 dias
    expect(linhas[0].ajusteVt).toBe(-10);    // −1 dia presencial × 10
    expect(linhas[0].ajusteVr).toBe(0);      // VR não muda (home office paga VR)
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

import { describe, expect, it } from "vitest";
import { proximoVencimento, resumoRecorrencia, nthDiaUtil, ultimoDiaUtil } from "./recorrencia";
import type { PrazoRecorrencia } from "../../core/types";

describe("proximoVencimento — mensal por dia absoluto", () => {
  it("todo dia 20, a cada 1 mês", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes: 20 };
    expect(proximoVencimento(r, "2026-07-20")).toBe("2026-08-20");
  });
  it("dia 20, a cada 3 meses", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 3, modo: "dia_absoluto", diaDoMes: 20 };
    expect(proximoVencimento(r, "2026-07-20")).toBe("2026-10-20");
  });
  it("dia 31 clampa ao último dia de meses curtos", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes: 31 };
    expect(proximoVencimento(r, "2026-01-31")).toBe("2026-02-28"); // fev/2026 não é bissexto
  });
  it("vira o ano", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes: 15 };
    expect(proximoVencimento(r, "2026-12-15")).toBe("2027-01-15");
  });
});

describe("proximoVencimento — anual", () => {
  it("todo ano no mesmo dia: 03/09/2026 → 03/09/2027", () => {
    const r: PrazoRecorrencia = { unidade: "ano", intervalo: 1 };
    expect(proximoVencimento(r, "2026-09-03")).toBe("2027-09-03");
  });
  it("a cada 2 anos", () => {
    const r: PrazoRecorrencia = { unidade: "ano", intervalo: 2 };
    expect(proximoVencimento(r, "2026-09-03")).toBe("2028-09-03");
  });
  it("29/02 clampa pra 28/02 em ano não bissexto", () => {
    const r: PrazoRecorrencia = { unidade: "ano", intervalo: 1 };
    expect(proximoVencimento(r, "2028-02-29")).toBe("2029-02-28");
  });
});

describe("proximoVencimento — mensal por dia útil", () => {
  it("5º dia útil de agosto/2026", () => {
    // Ago/2026: 01=sáb,02=dom,03=seg(1),04(2),05(3),06(4),07(5) → 5º útil = 07/08
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: 5 };
    expect(proximoVencimento(r, "2026-07-31")).toBe("2026-08-07");
  });
  it("último dia útil de agosto/2026 (31=seg)", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: "ultimo" };
    expect(proximoVencimento(r, "2026-07-31")).toBe("2026-08-31");
  });
  it("último dia útil de maio/2026 (31=dom → 29=sex)", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: "ultimo" };
    expect(proximoVencimento(r, "2026-04-30")).toBe("2026-05-29");
  });
});

describe("proximoVencimento — dia útil com sábado contando", () => {
  it("1º dia útil de ago/2026 SEM sábado = seg 03/08", () => {
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: 1, contaSabado: false };
    expect(proximoVencimento(r, "2026-07-31")).toBe("2026-08-03");
  });
  it("1º dia útil de ago/2026 COM sábado = sáb 01/08", () => {
    // Ago/2026: 01=sáb. Com sábado contando, o 1º dia útil é o próprio sábado.
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: 1, contaSabado: true };
    expect(proximoVencimento(r, "2026-07-31")).toBe("2026-08-01");
  });
  it("último dia útil de maio/2026 COM sábado = sáb 30/05", () => {
    // Mai/2026: 31=dom, 30=sáb. Sem sábado → 29 (sex). Com sábado → 30 (sáb).
    const r: PrazoRecorrencia = { unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: "ultimo", contaSabado: true };
    expect(proximoVencimento(r, "2026-04-30")).toBe("2026-05-30");
  });
});

describe("proximoVencimento — semanal", () => {
  it("toda segunda (2026-07-20 é segunda → próxima 27/07)", () => {
    const r: PrazoRecorrencia = { unidade: "semana", intervalo: 1, diasSemana: [1] };
    expect(proximoVencimento(r, "2026-07-20")).toBe("2026-07-27");
  });
  it("segunda e quinta: de segunda 20/07 → quinta 23/07", () => {
    const r: PrazoRecorrencia = { unidade: "semana", intervalo: 1, diasSemana: [1, 4] };
    expect(proximoVencimento(r, "2026-07-20")).toBe("2026-07-23");
  });
  it("a cada 2 semanas na segunda: 20/07 → 03/08 (pula 27/07)", () => {
    const r: PrazoRecorrencia = { unidade: "semana", intervalo: 2, diasSemana: [1] };
    expect(proximoVencimento(r, "2026-07-20")).toBe("2026-08-03");
  });
});

describe("helpers de dia útil", () => {
  it("nthDiaUtil satura no último se n excede", () => {
    // Fev/2026 tem 20 dias úteis; pedir o 30º → último útil (27/02, sexta)
    expect(nthDiaUtil(2026, 1, 30).getDate()).toBe(27);
  });
  it("ultimoDiaUtil de maio/2026 = 29", () => {
    expect(ultimoDiaUtil(2026, 4).getDate()).toBe(29);
  });
});

describe("resumoRecorrencia", () => {
  it("dia absoluto mensal", () => {
    expect(resumoRecorrencia({ unidade: "mes", intervalo: 1, modo: "dia_absoluto", diaDoMes: 20 })).toBe("Dia 20 do mês");
  });
  it("dia útil a cada 2 meses", () => {
    expect(resumoRecorrencia({ unidade: "mes", intervalo: 2, modo: "dia_util", diaUtil: 5 })).toBe("5º dia útil, a cada 2 meses");
  });
  it("último dia útil", () => {
    expect(resumoRecorrencia({ unidade: "mes", intervalo: 1, modo: "dia_util", diaUtil: "ultimo" })).toBe("Último dia útil do mês");
  });
  it("semanal com dois dias", () => {
    expect(resumoRecorrencia({ unidade: "semana", intervalo: 1, diasSemana: [1, 4] })).toBe("Toda seg e qui");
  });
  it("nulo", () => {
    expect(resumoRecorrencia(null)).toBe("Não repete");
  });
});

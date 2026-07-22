import { describe, it, expect } from "vitest";
import { ymdExibicao, ehFimDeSemana, diaSemanaCurto } from "./logic";

// Referência: julho/2026 — 23=qui, 24=sex, 25=sáb, 26=dom, 27=seg.
describe("ymdExibicao — fim de semana volta pra sexta", () => {
  it("sábado → sexta anterior", () => expect(ymdExibicao("2026-07-25")).toBe("2026-07-24"));
  it("domingo → sexta anterior", () => expect(ymdExibicao("2026-07-26")).toBe("2026-07-24"));
  it("dia útil não muda (quinta)", () => expect(ymdExibicao("2026-07-23")).toBe("2026-07-23"));
  it("dia útil não muda (segunda)", () => expect(ymdExibicao("2026-07-27")).toBe("2026-07-27"));
  it("vira o mês: sábado 01/08 → sexta 31/07", () => expect(ymdExibicao("2026-08-01")).toBe("2026-07-31"));
});

describe("ehFimDeSemana / diaSemanaCurto", () => {
  it("sábado é fim de semana", () => expect(ehFimDeSemana("2026-07-25")).toBe(true));
  it("domingo é fim de semana", () => expect(ehFimDeSemana("2026-07-26")).toBe(true));
  it("quinta não é", () => expect(ehFimDeSemana("2026-07-23")).toBe(false));
  it("rótulo curto", () => { expect(diaSemanaCurto("2026-07-25")).toBe("sáb"); expect(diaSemanaCurto("2026-07-26")).toBe("dom"); });
});

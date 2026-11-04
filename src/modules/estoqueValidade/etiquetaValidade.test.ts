import { describe, expect, it } from "vitest";
import { blocosValidade, dataBR, diaSemana, novoCodigoLote, validadeDe } from "./etiquetaValidade";

describe("etiqueta de validade", () => {
  it("soma os dias do método à data de manipulação", () => {
    const manip = new Date(2026, 10, 3, 18, 30);
    expect(dataBR(validadeDe(manip, 3))).toBe("06/11/2026");
    expect(dataBR(validadeDe(manip, 0))).toBe("03/11/2026");
  });

  it("vira o mês e o ano", () => {
    expect(dataBR(validadeDe(new Date(2026, 11, 30), 5))).toBe("04/01/2027");
  });

  it("não altera a data de manipulação", () => {
    const manip = new Date(2026, 10, 3);
    validadeDe(manip, 10);
    expect(dataBR(manip)).toBe("03/11/2026");
  });

  it("dia da semana em português", () => {
    expect(diaSemana(new Date(2026, 10, 6))).toBe("sexta");
  });

  it("gera lote AAMMDD-XXXX", () => {
    expect(novoCodigoLote(new Date(2026, 10, 3), () => 0.123456789)).toMatch(/^261103-[0-9A-Z]{4}$/);
  });

  it("traz os campos obrigatórios na etiqueta (produto, manipulação, validade, responsável)", () => {
    const b = blocosValidade({
      produto: "Abóbora cozida", metodo: "Refrigerado", dias: 3, manipulacao: new Date(2026, 10, 3, 9, 5),
      validade: new Date(2026, 10, 6), responsavel: "Maria", lote: "261103-AB12", empresa: "Lobozó", cnpj: null, qr: "x",
    });
    const texto = JSON.stringify(b);
    for (const t of ["Abóbora cozida", "06/11", "sexta · 2026", "03/11", "09:05 · 2026", "Refrigerado", "3 dias", "Maria", "261103-AB12"]) expect(texto).toContain(t);
  });
});

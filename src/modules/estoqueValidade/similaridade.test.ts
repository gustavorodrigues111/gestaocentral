import { describe, expect, it } from "vitest";
import { mesmoNome, normalizarNome, parecidos, similaridade } from "./similaridade";

const base = [
  { id: "1", nome: "Caldo de peixe" },
  { id: "2", nome: "Molho de tucupi" },
  { id: "3", nome: "Abóbora cabotiá cozida" },
  { id: "4", nome: "Arroz branco" },
  { id: "5", nome: "Feijão-de-corda cozido" },
  { id: "6", nome: "Peixe porcionado" },
];

describe("produtos parecidos", () => {
  it("normaliza acento, caixa, ligação e plural", () => {
    expect(normalizarNome("Caldos de Peixe")).toEqual(["caldo", "peixe"]);
    expect(normalizarNome("Abóbora  CABOTIÁ")).toEqual(["abobora", "cabotia"]);
  });

  it("reconhece o mesmo nome escrito diferente", () => {
    expect(mesmoNome("caldo peixe", "Caldo de Peixe")).toBe(true);
    expect(mesmoNome("Caldos de peixe", "Caldo de peixe")).toBe(true);
    expect(mesmoNome("Caldo de peixe", "Caldo de camarão")).toBe(false);
  });

  it("acha parecidos enquanto digita", () => {
    expect(parecidos("caldo de peixe", base)[0].id).toBe("1");
    expect(parecidos("abobora", base).map((p) => p.id)).toContain("3");
    expect(parecidos("tucupi", base).map((p) => p.id)).toContain("2");
    expect(parecidos("feijao corda", base).map((p) => p.id)).toContain("5");
  });

  it("tolera erro de digitação", () => {
    expect(parecidos("caldo de peixee", base)[0].id).toBe("1");
    expect(parecidos("abobra cabotia", base).map((p) => p.id)).toContain("3");
  });

  it("não sugere coisa diferente", () => {
    expect(parecidos("farofa de dendê", base)).toEqual([]);
    expect(parecidos("ar", base)).toEqual([]);
    expect(similaridade("Arroz branco", "Peixe porcionado")).toBeLessThan(0.6);
  });

  it("ignora o próprio produto na edição", () => {
    expect(parecidos("Caldo de peixe", base, "1").map((p) => p.id)).not.toContain("1");
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("../../core/firebase/config", () => ({ db: {} }));
import { diasAteValidade, faixaDe, textoPrazo, tokenDaCopia, tokenDoQr, urlEtiqueta } from "./etiquetasRepo";

describe("etiquetas emitidas", () => {
  it("cada cópia tem token próprio dentro do mesmo lote", () => {
    expect(tokenDaCopia("261103-K7Q2", 1)).toBe("et_261103-K7Q2-1");
    expect(tokenDaCopia("261103-K7Q2", 2)).not.toBe(tokenDaCopia("261103-K7Q2", 1));
  });

  it("lê o token tanto da URL do QR quanto digitado", () => {
    const t = tokenDaCopia("261103-K7Q2", 3);
    expect(tokenDoQr(urlEtiqueta(t))).toBe(t);
    expect(tokenDoQr(t)).toBe(t);
    expect(tokenDoQr("  " + t + " ")).toBe(t);
  });

  it("não confunde com o QR fixo de estoque", () => {
    expect(tokenDoQr("qr_ab12cd34xyz")).toBeNull();
    expect(tokenDoQr("")).toBeNull();
  });

  it("conta os dias até a validade", () => {
    expect(diasAteValidade("2026-11-06", "2026-11-04")).toBe(2);
    expect(diasAteValidade("2026-11-03", "2026-11-04")).toBe(-1);
    expect(diasAteValidade("2026-12-01", "2026-11-30")).toBe(1);
  });

  it("classifica por faixa e descreve o prazo", () => {
    expect(faixaDe(-2)).toBe("vencida");
    expect(faixaDe(0)).toBe("hoje");
    expect(faixaDe(1)).toBe("amanha");
    expect(faixaDe(7)).toBe("semana");
    expect(faixaDe(8)).toBe("depois");
    expect(textoPrazo(-1)).toBe("venceu ontem");
    expect(textoPrazo(-3)).toBe("venceu há 3 dias");
    expect(textoPrazo(0)).toBe("vence hoje");
    expect(textoPrazo(4)).toBe("vence em 4 dias");
  });
});

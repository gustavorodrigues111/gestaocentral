import { describe, expect, it } from "vitest";
import { agruparPorAmbiente, compativel, diasNoLocal, ehAmbiente, limparVinculos, nomeCompleto, produtosDoLocal } from "./compatibilidade";

const geladeira = { id: "g1", nome: "Geladeira 1", ativo: true, metodoConservacao: "refrigerado" };
const freezer = { id: "f1", nome: "Freezer", ativo: true, metodoConservacao: "congelado" };
const semMetodo = { id: "x", nome: "Bancada", ativo: true, metodoConservacao: null };
const caldo = { id: "p1", ativo: true, conservacao: { refrigerado: 3, congelado: 30 }, locais: ["g1", "f1"] };
const arroz = { id: "p2", ativo: true, conservacao: { refrigerado: 2 }, locais: ["g1", "f1"] };

describe("produto x local", () => {
  it("só é compatível se a matriz tem o método do local", () => {
    expect(compativel(caldo, freezer)).toBe(true);
    expect(compativel(arroz, freezer)).toBe(false);
    expect(compativel(caldo, semMetodo)).toBe(false);
  });

  it("a validade vem do método do local", () => {
    expect(diasNoLocal(caldo, geladeira)).toBe(3);
    expect(diasNoLocal(caldo, freezer)).toBe(30);
    expect(diasNoLocal(arroz, freezer)).toBeNull();
  });

  it("lista do local traz só vinculados e compatíveis", () => {
    expect(produtosDoLocal([caldo, arroz], freezer).map((p) => p.id)).toEqual(["p1"]);
    expect(produtosDoLocal([caldo, arroz], geladeira).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(produtosDoLocal([{ ...caldo, ativo: false }], geladeira)).toEqual([]);
  });

  it("remove vínculo que ficou incompatível", () => {
    expect(limparVinculos(["g1", "f1"], { refrigerado: 3 }, [geladeira, freezer])).toEqual(["g1"]);
    expect(limparVinculos(["apagado"], { refrigerado: 3 }, [geladeira])).toEqual([]);
  });
});

describe("ambientes e equipamentos", () => {
  const laje = { id: "a1", nome: "Laje", tipo: "ambiente", ativo: true };
  const baixo = { id: "a2", nome: "Cozinha de baixo", tipo: "ambiente", ativo: true };
  const fz = { id: "e1", nome: "Freezer", tipo: "freezer", paiId: "a1", ativo: true, metodoConservacao: "congelado" };
  const gel = { id: "e2", nome: "Geladeira", tipo: "geladeira", paiId: "a2", ativo: true, metodoConservacao: "refrigerado" };
  const solto = { id: "e3", nome: "Estante", tipo: "prateleira", ativo: true, metodoConservacao: "seco" };
  const todos = [laje, baixo, fz, gel, solto];

  it("nome completo inclui o ambiente", () => {
    expect(nomeCompleto(fz, todos)).toBe("Laje · Freezer");
    expect(nomeCompleto(solto, todos)).toBe("Estante");
  });

  it("agrupa equipamentos dentro dos ambientes e separa os soltos", () => {
    const g = agruparPorAmbiente(todos);
    expect(g.map((x) => x.ambiente?.nome ?? "sem")).toEqual(["Cozinha de baixo", "Laje", "sem"]);
    expect(g[1].equipamentos.map((e) => e.id)).toEqual(["e1"]);
    expect(g[2].equipamentos.map((e) => e.id)).toEqual(["e3"]);
    expect(ehAmbiente(laje)).toBe(true);
    expect(ehAmbiente(fz)).toBe(false);
  });
});

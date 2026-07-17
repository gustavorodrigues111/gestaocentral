// Golden dataset (briefing seção 8) como rede de regressão. O motor DEVE achar
// os P0/P1 reais e NÃO pode gerar falso positivo nos casos "explicados".
import { describe, expect, it } from "vitest";
import { conferir, findingsReportaveis } from "./index";
import type { FolhaColaborador, FolhaEspelho } from "../tipos";
import type { GorjetaMensalCpf } from "../gorjetaMensal";

// Helper: monta um colaborador com líquido coerente (Bloco A não deve reclamar).
function colab(p: Partial<FolhaColaborador> & { nome: string; cpf: string }): FolhaColaborador {
  const proventos = p.proventos || [];
  const descontos = p.descontos || [];
  const liquido = p.liquido ?? Math.round((proventos.reduce((s, l) => s + l.valor, 0) - descontos.reduce((s, l) => s + l.valor, 0)) * 100) / 100;
  return { proventos, descontos, liquido, ...p };
}

const g = (cpf: string, nome: string, bruto: number, dias = 20): GorjetaMensalCpf => ({ cpf, nome, bruto, liquido: bruto * 0.9, dias });

describe("Conferência de folha — Sororoca jun/2026 (golden dataset)", () => {
  const amanda = colab({ nome: "Amanda Ferreira dos Santos", cpf: "42791864806", proventos: [{ codigo: "155", descricao: "Gorjeta LP-LR", valor: 1043.48 }] });
  const joana = colab({ nome: "Joana Zanon", cpf: "10000000001", proventos: [{ codigo: "155", descricao: "Gorjeta LP-LR", valor: 598.07 }] });
  const matheus = colab({ nome: "Matheus Aguillera", cpf: "10000000002", situacao: { tipo: "demitido", inicio: "2026-06-24" }, proventos: [{ codigo: "70005", descricao: "Saldo salário", valor: 500 }] });
  const bianca = colab({ nome: "Bianca", cpf: "10000000003", proventos: [{ codigo: "155", descricao: "Gorjeta LP-LR", valor: 110 }] });
  const vinicius = colab({ nome: "Vinícius Henrique Gualberto", cpf: "47529668838", proventos: [{ codigo: "83005", descricao: "Acidente trabalho", valor: 1000 }], descontos: [{ codigo: "89305", descricao: "Desconto acidente", valor: 1000 }] });
  const fulanoP0 = colab({ nome: "Fulano Sem 953", cpf: "10000000004", proventos: [{ codigo: "5", descricao: "Salário", valor: 2000 }] });
  const ciclanoOk = colab({ nome: "Ciclano Reconciliado", cpf: "10000000005", proventos: [{ codigo: "5", descricao: "Salário", valor: 2000 }], descontos: [{ codigo: "953", descricao: "Adiantamento c/ IR", valor: 800 }] });

  const colaboradores = [amanda, joana, matheus, bianca, vinicius, fulanoP0, ciclanoOk];
  const somaLiq = Math.round(colaboradores.reduce((s, c) => s + c.liquido, 0) * 100) / 100;

  const folha: FolhaEspelho = { tipo: "folha", empresa: "SOROROCA", competencia: "2026-06", colaboradores, resumoGeral: { liquido: somaLiq } };
  const adiantamento: FolhaEspelho = {
    tipo: "adiantamento", competencia: "2026-06",
    colaboradores: [
      colab({ nome: "Fulano Sem 953", cpf: "10000000004", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial", valor: 800 }] }),
      colab({ nome: "Ciclano Reconciliado", cpf: "10000000005", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial", valor: 800 }] }),
    ],
  };
  const gorjetaApp: Record<string, GorjetaMensalCpf> = {
    "42791864806": g("42791864806", "Amanda", 1400.43),
    "10000000001": g("10000000001", "Joana", 663.49),
    "10000000002": g("10000000002", "Matheus", 1608.22),
    "10000000003": g("10000000003", "Bianca", 100.00),
  };

  const findings = conferir({ folha, adiantamento, gorjetaApp, competencia: "2026-06", whitelist: [] });
  const rep = findingsReportaveis(findings);
  const acha = (cpf: string, tipo: string) => rep.find((f) => f.cpf === cpf && f.tipo === tipo);

  it("DETECTA Amanda: gorjeta −356,95 (P1)", () => {
    const f = acha("42791864806", "gorjeta_divergente");
    expect(f).toBeTruthy();
    expect(f!.severidade).toBe("P1");
    expect(f!.delta).toBe(-356.95);
  });

  it("DETECTA Joana: gorjeta −65,42 (P1)", () => {
    const f = acha("10000000001", "gorjeta_divergente");
    expect(f).toBeTruthy();
    expect(f!.delta).toBe(-65.42);
  });

  it("DETECTA adiantamento sem 953 (P0)", () => {
    const f = acha("10000000004", "adiantamento_sem_953");
    expect(f).toBeTruthy();
    expect(f!.severidade).toBe("P0");
  });

  it("NÃO alerta Matheus (demitido → gorjeta foi p/ rescisão)", () => {
    expect(rep.some((f) => f.cpf === "10000000002")).toBe(false);
  });

  it("NÃO alerta Bianca (ruído de R$10 < R$20)", () => {
    expect(rep.some((f) => f.cpf === "10000000003")).toBe(false);
  });

  it("NÃO alerta Vinícius (líquido 0 por acidente, holerite íntegro)", () => {
    expect(rep.some((f) => f.cpf === "47529668838")).toBe(false);
  });

  it("NÃO alerta Ciclano (adiantamento reconciliado com 953)", () => {
    expect(rep.some((f) => f.cpf === "10000000005")).toBe(false);
  });

  it("Bloco A não gera falso positivo de integridade em holerites coerentes", () => {
    expect(rep.some((f) => f.tipo === "integridade_holerite" || f.tipo === "resumo_geral_divergente")).toBe(false);
  });
});

describe("Whitelist silencia o CPF certo", () => {
  const folha: FolhaEspelho = {
    tipo: "folha", competencia: "2026-06",
    colaboradores: [colab({ nome: "Fulano", cpf: "10000000004", proventos: [{ codigo: "5", descricao: "Salário", valor: 2000 }] })],
    resumoGeral: { liquido: 2000 },
  };
  const adiantamento: FolhaEspelho = { tipo: "adiantamento", competencia: "2026-06", colaboradores: [colab({ nome: "Fulano", cpf: "10000000004", proventos: [{ codigo: "20504", descricao: "Adiant", valor: 800 }] })] };

  it("exceção sem_adiantamento silencia o P0 de 953", () => {
    const findings = conferir({
      folha, adiantamento, gorjetaApp: {}, competencia: "2026-06",
      whitelist: [{ id: "w1", restaurantId: "r", cpf: "100.000.000-04", tipo: "sem_adiantamento", motivo: "opta por não receber adiantamento" }],
    });
    expect(findingsReportaveis(findings).length).toBe(0);
    expect(findings.some((f) => f.whitelisted && f.cpf === "10000000004")).toBe(true);
  });
});

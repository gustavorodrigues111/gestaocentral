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

describe("Adiantamento Sororoca jul/2026 — dados REAIS (integridade)", () => {
  // Transcrição fiel de 7 colaboradores do espelho real (com arredondamento 90011
  // e 20904 'Ad. sal. Créd. Trabalhador' como DESCONTO). Prova que o Bloco A não
  // falsopositiva no formato do Senador.
  const cs: FolhaColaborador[] = [
    colab({ nome: "ALLAN LOPES TERRABUIO", cpf: "39791690812", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 1040.00 }], descontos: [], totalProventos: 1040.00, totalDescontos: 0, liquido: 1040.00 }),
    colab({ nome: "AMANDA FERREIRA DOS SANTOS", cpf: "42791864806", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 960.00 }], descontos: [], totalProventos: 960.00, totalDescontos: 0, liquido: 960.00 }),
    colab({ nome: "ANTONIO FLAVIO DA SILVA VIEIRA", cpf: "07332654300", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 852.00 }, { codigo: "90011", descricao: "Arredondamento provento adiant. salarial", valor: 0.04 }], descontos: [{ codigo: "20904", descricao: "Ad. sal. Créd. Trabalhador com IR", valor: 391.04 }], totalProventos: 852.04, totalDescontos: 391.04, liquido: 461.00 }),
    colab({ nome: "BIANCA OLIVEIRA COSTA", cpf: "43745472829", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 988.80 }, { codigo: "90011", descricao: "Arredondamento provento adiant. salarial", valor: 0.87 }], descontos: [{ codigo: "91555", descricao: "IR adiantamento", valor: 90.48 }, { codigo: "20904", descricao: "Ad. sal. Créd. Trabalhador com IR", valor: 741.19 }], totalProventos: 989.67, totalDescontos: 831.67, liquido: 158.00 }),
    colab({ nome: "BRUNA DIAS DOS SANTOS", cpf: "46729358840", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 862.80 }, { codigo: "90011", descricao: "Arredondamento provento adiant. salarial", valor: 0.20 }], descontos: [], totalProventos: 863.00, totalDescontos: 0, liquido: 863.00 }),
    colab({ nome: "CARLOS EDUARDO ESQUILLARO SIMOES AUGUSTO", cpf: "40940820854", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 1460.80 }, { codigo: "90011", descricao: "Arredondamento provento adiant. salarial", valor: 0.06 }], descontos: [{ codigo: "91555", descricao: "IR adiantamento", valor: 480.86 }], totalProventos: 1460.86, totalDescontos: 480.86, liquido: 980.00 }),
    colab({ nome: "CAUÃ RAMSÉS MARTINEZ DE OLIVEIRA", cpf: "11924741555", proventos: [{ codigo: "20504", descricao: "Adiantamento salarial com IR", valor: 721.60 }, { codigo: "90011", descricao: "Arredondamento provento adiant. salarial", valor: 0.40 }], descontos: [], totalProventos: 722.00, totalDescontos: 0, liquido: 722.00 }),
  ];
  const somaLiq = Math.round(cs.reduce((s, c) => s + c.liquido, 0) * 100) / 100; // 5184.00
  const folha: FolhaEspelho = { tipo: "adiantamento", empresa: "SOROROCA BAR LTDA", competencia: "2026-07", colaboradores: cs, resumoGeral: { liquido: somaLiq } };

  it("Bloco A não acusa nada (holerites e resumo íntegros)", () => {
    const rep = findingsReportaveis(conferir({ folha, gorjetaApp: {}, competencia: "2026-07", whitelist: [] }));
    expect(rep).toEqual([]);
  });

  it("Soma dos líquidos do subconjunto = 5.184,00", () => {
    expect(somaLiq).toBe(5184.00);
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

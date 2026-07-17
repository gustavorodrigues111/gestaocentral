// Motor de regras da conferência de folha — Blocos A/B/D do briefing (seção 6).
// FUNÇÕES PURAS: recebem dados, devolvem Finding[]. Zero I/O, zero LLM. Toda
// comparação é laço de código (nunca "olhar a tabela").
import type { FolhaEspelho, FolhaColaborador, Finding, VerbaLinha } from "../tipos";
import { cpfDigits } from "../tipos";
import type { GorjetaMensalCpf } from "../gorjetaMensal";

// ── Constantes de verba (dicionário do briefing, seção 4) ──
export const VERBAS_GORJETA = new Set(["154", "155"]);   // 154 SN (optante) / 155 LP-LR (não-optante)
export const VERBA_953 = "953";                          // adiantamento c/ ded. IR (reconciliação)
export const VERBAS_ADIANTAMENTO = new Set(["20504"]);   // adiantamento salarial (espelho de adiant.)
export const VERBAS_INSS_FOLHA = new Set(["91005", "91006", "91025", "91205"]);

// ── Tolerâncias (seção 13) ──
export const TOL_HOLERITE = 0.01;   // dentro do holerite
export const TOL_FOLHA = 1.00;      // entre folhas / arredondamento de líquido
export const TOL_GORJETA = 20.00;   // rateio de gorjeta

// ── Helpers ──
const soma = (linhas: VerbaLinha[]) => linhas.reduce((s, l) => s + (l.valor || 0), 0);
const somaCod = (linhas: VerbaLinha[], cods: Set<string>) => linhas.filter((l) => cods.has(String(l.codigo))).reduce((s, l) => s + (l.valor || 0), 0);
const temCod = (linhas: VerbaLinha[], cod: string) => linhas.some((l) => String(l.codigo) === cod);
const ehDemitido = (c: FolhaColaborador) => c.situacao?.tipo === "demitido";
const r2 = (n: number) => Math.round(n * 100) / 100;

// ════════════════════════════════════════════════════════════════════════════
// Bloco A — Integridade intra-holerite (determinístico)
// ════════════════════════════════════════════════════════════════════════════
export function blocoA(folha: FolhaEspelho): Finding[] {
  const out: Finding[] = [];
  let somaLiquidos = 0;
  for (const c of folha.colaboradores) {
    const p = soma(c.proventos), d = soma(c.descontos);
    const calc = r2(p - d);
    somaLiquidos += c.liquido;
    // Σ verbas vs TOTAL IMPRESSO no espelho → pega o parser perdendo uma verba.
    if (typeof c.totalProventos === "number" && c.totalProventos > 0 && Math.abs(r2(p) - c.totalProventos) > TOL_HOLERITE) {
      out.push({
        bloco: "A", severidade: "P2", tipo: "proventos_vs_total_impresso",
        cpf: cpfDigits(c.cpf), colaborador: c.nome, esperado: c.totalProventos, encontrado: r2(p), delta: r2(p - c.totalProventos),
        explicacao: `Σ das verbas de provento (${r2(p)}) ≠ 'Total de proventos' impresso (${c.totalProventos}). Provável verba não lida pelo parser.`,
        acao: "Reprocessar o PDF; conferir se alguma verba de provento ficou de fora.",
      });
    }
    if (typeof c.totalDescontos === "number" && c.totalDescontos > 0 && Math.abs(r2(d) - c.totalDescontos) > TOL_HOLERITE) {
      out.push({
        bloco: "A", severidade: "P2", tipo: "descontos_vs_total_impresso",
        cpf: cpfDigits(c.cpf), colaborador: c.nome, esperado: c.totalDescontos, encontrado: r2(d), delta: r2(d - c.totalDescontos),
        explicacao: `Σ das verbas de desconto (${r2(d)}) ≠ 'Total de descontos' impresso (${c.totalDescontos}). Provável verba não lida pelo parser.`,
        acao: "Reprocessar o PDF; conferir se algum desconto ficou de fora.",
      });
    }
    if (Math.abs(calc - c.liquido) > TOL_HOLERITE) {
      out.push({
        bloco: "A", severidade: "P1", tipo: "integridade_holerite",
        cpf: cpfDigits(c.cpf), colaborador: c.nome,
        esperado: c.liquido, encontrado: calc, delta: r2(calc - c.liquido),
        fonteEsperado: "espelho/líquido", fonteEncontrado: "Σ proventos − Σ descontos",
        explicacao: `Σ proventos (${r2(p)}) − Σ descontos (${r2(d)}) = ${calc}, mas o líquido impresso é ${c.liquido}.`,
        acao: "Conferir se o parser leu todas as verbas; se o PDF diverge de si mesmo, acionar o Senador.",
      });
    }
    // INSS presente quando há base de INSS > 0
    if ((c.bases?.inss || 0) > 0 && somaCod(c.descontos, VERBAS_INSS_FOLHA) <= 0) {
      out.push({
        bloco: "A", severidade: "P2", tipo: "inss_ausente",
        cpf: cpfDigits(c.cpf), colaborador: c.nome,
        explicacao: `Base de INSS ${c.bases?.inss} mas nenhuma verba de INSS (9100x) no holerite.`,
        acao: "Confirmar se é isento (ex.: pró-labore já descontado em outra rubrica).",
      });
    }
  }
  const resumo = folha.resumoGeral?.liquido;
  if (typeof resumo === "number" && Math.abs(r2(somaLiquidos) - resumo) > TOL_FOLHA) {
    out.push({
      bloco: "A", severidade: "P1", tipo: "resumo_geral_divergente",
      esperado: resumo, encontrado: r2(somaLiquidos), delta: r2(somaLiquidos - resumo),
      fonteEsperado: "espelho/RESUMO GERAL", fonteEncontrado: "Σ líquidos dos colaboradores",
      explicacao: `Σ dos líquidos (${r2(somaLiquidos)}) ≠ RESUMO GERAL (${resumo}). Parser possivelmente incompleto — NÃO confiar na conferência desta folha.`,
      acao: "Reprocessar o PDF; se persistir, revisar o parser antes de conferir.",
    });
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Bloco B — Reconciliação adiantamento → folha (verba 953) — P0
// ════════════════════════════════════════════════════════════════════════════
export function blocoB(folha: FolhaEspelho, adiantamento?: FolhaEspelho): Finding[] {
  if (!adiantamento) return [];
  const out: Finding[] = [];
  const folhaByCpf = new Map<string, FolhaColaborador>();
  for (const c of folha.colaboradores) folhaByCpf.set(cpfDigits(c.cpf), c);

  for (const a of adiantamento.colaboradores) {
    const cpf = cpfDigits(a.cpf);
    const valorAdiant = somaCod(a.proventos, VERBAS_ADIANTAMENTO);
    if (valorAdiant <= 0) continue;                 // não recebeu adiantamento
    const naFolha = folhaByCpf.get(cpf);
    const tem953 = naFolha ? temCod(naFolha.descontos, VERBA_953) : false;
    if (tem953) continue;                            // reconciliado ✓
    if (naFolha && ehDemitido(naFolha)) {
      out.push({
        bloco: "B", severidade: "P2", tipo: "adiantamento_demitido_conferir_rescisao",
        cpf, colaborador: a.nome, esperado: r2(valorAdiant),
        fonteEsperado: "espelho de adiantamento/verba 20504",
        explicacao: `Recebeu adiantamento (${r2(valorAdiant)}) e foi demitido — sem verba 953 na folha. Deve ter sido descontado na RESCISÃO.`,
        acao: "Confirmar o desconto do adiantamento no termo de rescisão.",
      });
    } else {
      out.push({
        bloco: "B", severidade: "P0", tipo: "adiantamento_sem_953",
        cpf, colaborador: a.nome, esperado: r2(valorAdiant), encontrado: 0, delta: r2(-valorAdiant),
        fonteEsperado: "espelho de adiantamento/verba 20504", fonteEncontrado: "folha/verba 953",
        explicacao: `Recebeu adiantamento de ${r2(valorAdiant)} mas NÃO há verba 953 na folha nem está demitido — adiantamento não descontado (dinheiro perdido).`,
        acao: "Acionar o Senador para lançar a verba 953 antes do fechamento.",
      });
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// Bloco D — Gorjeta app × folha (verba 154/155), por CPF — o de maior valor
// ════════════════════════════════════════════════════════════════════════════
export function blocoD(folha: FolhaEspelho, gorjetaApp: Record<string, GorjetaMensalCpf>): Finding[] {
  const out: Finding[] = [];
  const folhaByCpf = new Map<string, FolhaColaborador>();
  for (const c of folha.colaboradores) folhaByCpf.set(cpfDigits(c.cpf), c);

  // 1) Para cada colaborador da folha: compara verba 154/155 vs bruto do app
  for (const c of folha.colaboradores) {
    const cpf = cpfDigits(c.cpf);
    const folhaGorjeta = r2(somaCod(c.proventos, VERBAS_GORJETA));
    const app = gorjetaApp[cpf];
    const appBruto = app ? app.bruto : 0;
    // Demitido: a gorjeta vai pra rescisão, não pra 154/155 — não comparar.
    if (ehDemitido(c)) continue;
    if (!app && folhaGorjeta <= 0) continue;        // não tem gorjeta em lugar nenhum
    const delta = r2(folhaGorjeta - appBruto);      // encontrado(folha) − esperado(app)
    if (Math.abs(delta) <= TOL_GORJETA) continue;   // ruído de rateio
    out.push({
      bloco: "D", severidade: "P1", tipo: "gorjeta_divergente",
      cpf, colaborador: c.nome,
      esperado: appBruto, encontrado: folhaGorjeta, delta,
      fonteEsperado: "planejamento.app/gorjetas (bruto do mês)", fonteEncontrado: "espelho/verba 154-155",
      explicacao: delta < 0
        ? `Folha lançou gorjeta R$ ${Math.abs(delta)} MENOR que o rateio apurado no app (app ${appBruto} × folha ${folhaGorjeta}).`
        : `Folha lançou gorjeta R$ ${delta} MAIOR que o rateio do app (app ${appBruto} × folha ${folhaGorjeta}).`,
      acao: "Conferir o rateio com o Senador; se o app é a fonte da verdade, complementar/estornar a diferença.",
    });
  }

  // 2) Quem tem gorjeta no app mas NÃO aparece na folha (e não é demitido)
  for (const cpf of Object.keys(gorjetaApp)) {
    const app = gorjetaApp[cpf];
    if (app.bruto <= TOL_GORJETA) continue;
    const c = folhaByCpf.get(cpf);
    if (c && ehDemitido(c)) continue;               // foi pra rescisão
    const folhaGorjeta = c ? r2(somaCod(c.proventos, VERBAS_GORJETA)) : 0;
    if (folhaGorjeta > 0) continue;                 // já tratado no laço 1
    out.push({
      bloco: "D", severidade: "P1", tipo: "gorjeta_faltante",
      cpf, colaborador: app.nome,
      esperado: app.bruto, encontrado: 0, delta: r2(-app.bruto),
      fonteEsperado: "planejamento.app/gorjetas (bruto do mês)", fonteEncontrado: "espelho/verba 154-155",
      explicacao: `Recebeu ${app.bruto} de gorjeta no app (${app.dias} dias) mas não há verba 154/155 na folha e não consta demitido.`,
      acao: "Confirmar com o Senador se a gorjeta foi lançada; se não, incluir.",
    });
  }

  return out;
}

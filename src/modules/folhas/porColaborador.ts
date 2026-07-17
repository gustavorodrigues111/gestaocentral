// Visão POR COLABORADOR: lista TODOS os empregados do espelho e, pra cada um,
// todas as observações — inclusive as que estão OK ("Holerite íntegro",
// "Gorjeta confere"). Complementa a lista de pendências (que só mostra erro).
// Reusa o resultado de conferir() pros problemas e adiciona os "ok" onde não há
// finding daquele aspecto.
import type { FolhaEspelho, Finding, Severidade } from "./tipos";
import { cpfDigits } from "./tipos";
import type { GorjetaMensalCpf } from "./gorjetaMensal";
import { VERBAS_GORJETA, VERBAS_ADIANTAMENTO } from "./regras/blocos";

export type ObsColab = { severidade: Severidade; texto: string };
export type LinhaColab = { cpf: string; nome: string; situacao?: string; liquido: number; observacoes: ObsColab[]; pior: Severidade };

const ORDEM: Record<Severidade, number> = { P0: 0, P1: 1, P2: 2, OK: 3 };
const somaCod = (linhas: { codigo: string; valor: number }[], cods: Set<string>) => linhas.filter((l) => cods.has(String(l.codigo))).reduce((s, l) => s + (l.valor || 0), 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Aspecto de cada tipo de finding → pra saber se já cobrimos aquele aspecto.
const ASPECTO: Record<string, "integridade" | "gorjeta" | "reconciliacao"> = {
  integridade_holerite: "integridade", proventos_vs_total_impresso: "integridade", descontos_vs_total_impresso: "integridade", inss_ausente: "integridade",
  gorjeta_divergente: "gorjeta", gorjeta_faltante: "gorjeta",
  adiantamento_sem_953: "reconciliacao", adiantamento_demitido_conferir_rescisao: "reconciliacao",
};
const SIT_LABEL: Record<string, string> = { ferias: "Férias", demitido: "Demitido", afastado: "Afastado" };

// Texto curto de um finding pra caber na linha do colaborador.
function curto(f: Finding): string {
  if (f.whitelisted) return `${f.explicacao}`;
  switch (f.tipo) {
    case "gorjeta_divergente": return `Gorjeta diverge Δ ${brl(f.delta || 0)} (app ${brl(f.esperado || 0)} · folha ${brl(f.encontrado || 0)})`;
    case "gorjeta_faltante": return `Gorjeta no app (${brl(f.esperado || 0)}) mas sem verba 154/155 na folha`;
    case "adiantamento_sem_953": return `Adiantamento ${brl(f.esperado || 0)} sem verba 953 (dinheiro perdido)`;
    case "adiantamento_demitido_conferir_rescisao": return `Adiantamento ${brl(f.esperado || 0)} — conferir desconto na rescisão`;
    case "integridade_holerite": return `Holerite não fecha (Δ ${brl(f.delta || 0)})`;
    case "proventos_vs_total_impresso": return `Σ proventos ≠ total impresso (Δ ${brl(f.delta || 0)})`;
    case "descontos_vs_total_impresso": return `Σ descontos ≠ total impresso (Δ ${brl(f.delta || 0)})`;
    case "inss_ausente": return `INSS ausente com base > 0`;
    default: return f.explicacao;
  }
}

export function linhasPorColaborador(params: {
  folha?: FolhaEspelho | null;
  adiantamento?: FolhaEspelho | null;
  gorjetaApp: Record<string, GorjetaMensalCpf>;
  findings: Finding[];
}): LinhaColab[] {
  const { folha, adiantamento, gorjetaApp, findings } = params;
  const base = folha || adiantamento;
  if (!base) return [];
  const temFolha = !!folha;

  const findByCpf = new Map<string, Finding[]>();
  for (const f of findings) { if (!f.cpf) continue; const k = cpfDigits(f.cpf); const a = findByCpf.get(k) || []; a.push(f); findByCpf.set(k, a); }
  const aspectosComFinding = (cpf: string, asp: string) => (findByCpf.get(cpf) || []).some((f) => ASPECTO[f.tipo] === asp && !f.whitelisted);

  // Adiantamento (verba 20504) por CPF.
  const adiantByCpf = new Map<string, number>();
  for (const c of adiantamento?.colaboradores || []) adiantByCpf.set(cpfDigits(c.cpf), somaCod(c.proventos, VERBAS_ADIANTAMENTO));

  const linhas: LinhaColab[] = base.colaboradores.map((c) => {
    const cpf = cpfDigits(c.cpf);
    const obs: ObsColab[] = [];
    const demitido = c.situacao?.tipo === "demitido";

    // Findings deste CPF entram primeiro (problemas + whitelisted como OK).
    for (const f of findByCpf.get(cpf) || []) obs.push({ severidade: f.severidade, texto: curto(f) });

    // Situação (informativa).
    if (c.situacao && c.situacao.tipo !== "normal") obs.push({ severidade: "OK", texto: SIT_LABEL[c.situacao.tipo] || c.situacao.tipo });

    // Integridade OK (se não houve finding de integridade).
    if (!aspectosComFinding(cpf, "integridade")) obs.push({ severidade: "OK", texto: "Holerite íntegro" });

    // Gorjeta OK (só faz sentido com a folha).
    if (temFolha && !aspectosComFinding(cpf, "gorjeta")) {
      const app = gorjetaApp[cpf]?.bruto || 0;
      const folhaG = r2(somaCod(c.proventos, VERBAS_GORJETA));
      if (demitido && app > 0) obs.push({ severidade: "OK", texto: `Gorjeta na rescisão (${brl(app)} no app)` });
      else if (app > 0 || folhaG > 0) obs.push({ severidade: "OK", texto: `Gorjeta confere · app ${brl(app)} · folha ${brl(folhaG)} (Δ ${brl(r2(folhaG - app))})` });
    }

    // Reconciliação do adiantamento (só se subiu o espelho de adiantamento).
    if (adiantamento && !aspectosComFinding(cpf, "reconciliacao")) {
      const adiant = adiantByCpf.get(cpf) || 0;
      if (adiant > 0) obs.push({ severidade: "OK", texto: temFolha ? `Adiantamento ${brl(adiant)} reconciliado (953)` : `Adiantamento ${brl(adiant)}` });
    }

    const pior = obs.reduce<Severidade>((p, o) => (ORDEM[o.severidade] < ORDEM[p] ? o.severidade : p), "OK");
    return { cpf, nome: c.nome, situacao: c.situacao?.tipo, liquido: c.liquido, observacoes: obs, pior };
  });

  // Pior severidade primeiro; dentro do mesmo nível, por nome.
  return linhas.sort((a, b) => (ORDEM[a.pior] - ORDEM[b.pior]) || a.nome.localeCompare(b.nome));
}

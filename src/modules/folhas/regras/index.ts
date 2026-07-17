// Orquestra os blocos e aplica a whitelist. Ponto de entrada do motor.
import type { FolhaEspelho, Finding, FolhaWhitelistItem, Severidade } from "../tipos";
import { cpfDigits } from "../tipos";
import type { GorjetaMensalCpf } from "../gorjetaMensal";
import { blocoA, blocoB, blocoD } from "./blocos";

export { blocoA, blocoB, blocoD } from "./blocos";

// Que tipos de finding cada tipo de exceção da whitelist silencia. "geral"
// silencia tudo pra aquele CPF. Mantido explícito pra não silenciar demais.
const SILENCIA: Record<string, Set<string> | "todos"> = {
  geral: "todos",
  tudo: "todos",
  sem_adiantamento: new Set(["adiantamento_sem_953", "adiantamento_demitido_conferir_rescisao"]),
  acidente: new Set(["integridade_holerite", "variacao_mes", "gorjeta_faltante"]),
  cadastral: new Set(["cadastral_divergente", "lote_nome_divergente"]),
  prolabore_duplo: new Set(["duplicidade_prolabore"]),
};

function ativaNaCompetencia(item: FolhaWhitelistItem, competencia: string): boolean {
  const ini = `${competencia}-01`, fim = `${competencia}-31`;
  if (item.inicio && item.inicio > fim) return false;   // começa depois do mês
  if (item.fim && item.fim < ini) return false;         // terminou antes do mês
  return true;
}

export type ConferirInput = {
  folha: FolhaEspelho;
  adiantamento?: FolhaEspelho;
  gorjetaApp: Record<string, GorjetaMensalCpf>;
  whitelist?: FolhaWhitelistItem[];
  competencia: string;
};

const ORDEM: Record<Severidade, number> = { P0: 0, P1: 1, P2: 2, OK: 3 };

export function conferir(input: ConferirInput): Finding[] {
  const { folha, adiantamento, gorjetaApp, whitelist = [], competencia } = input;
  let findings: Finding[] = [
    ...blocoA(folha),
    ...blocoB(folha, adiantamento),
    ...blocoD(folha, gorjetaApp),
  ];

  // Whitelist: marca (não remove) os silenciados, pra ficar auditável.
  const wlAtiva = whitelist.filter((w) => ativaNaCompetencia(w, competencia));
  findings = findings.map((f) => {
    if (!f.cpf) return f;
    const cpf = cpfDigits(f.cpf);
    for (const w of wlAtiva) {
      if (cpfDigits(w.cpf) !== cpf) continue;
      const regra = SILENCIA[w.tipo];
      if (regra === "todos" || (regra && regra.has(f.tipo))) {
        return { ...f, whitelisted: true, severidade: "OK" as Severidade, explicacao: `${f.explicacao} [exceção: ${w.motivo}]` };
      }
    }
    return f;
  });

  return findings.sort((a, b) => (ORDEM[a.severidade] - ORDEM[b.severidade]) || a.bloco.localeCompare(b.bloco));
}

// Só os findings que devem ser REPORTADOS (não-OK, não-whitelisted).
export function findingsReportaveis(findings: Finding[]): Finding[] {
  return findings.filter((f) => f.severidade !== "OK" && !f.whitelisted);
}

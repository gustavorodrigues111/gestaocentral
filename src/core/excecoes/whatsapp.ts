// ════════════════════════════════════════════════════════════════════════════
//  Helpers de envio dos apontamentos via WhatsApp. Centralizado pra
//  InconformidadesTab e AjustesEscalaTab usarem a mesma mensagem.
// ════════════════════════════════════════════════════════════════════════════

import type { ApontamentoFuncionario } from "../types";

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

// Monta número internacional pra wa.me. Brasil → 55. Aceita whatsapp já
// com ou sem código do país. Retorna null se não conseguir.
export function whatsLink(whatsapp: string | undefined, texto: string): string | null {
  if (!whatsapp) return null;
  let d = onlyDigits(whatsapp);
  if (!d) return null;
  // Se já vier com 55 + DDD (13 dígitos com 9, 12 sem 9), deixa. Senão,
  // assume Brasil e prefixa 55.
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}

// Mensagem padrão de envio: apresentação + período + lista + urgência.
export function montarMensagemAjustes(opts: {
  empregadoNome: string;
  restNome?: string;
  weekStart: string;
  weekEnd: string;
  apontamentos: ApontamentoFuncionario[];
}): string {
  const { empregadoNome, restNome, weekStart, weekEnd, apontamentos } = opts;
  const primeiroNome = empregadoNome.split(" ")[0] || empregadoNome;
  const periodo = `${fmtDataBr(weekStart)} a ${fmtDataBr(weekEnd)}`;
  const restPart = restNome ? `, da equipe de gestão do ${restNome}` : "";
  const linhas = [
    `Olá, ${primeiroNome}! Tudo bem?`,
    "",
    `Aqui é${restPart}. Identifiquei alguns ajustes a fazer no seu ponto referente à semana de ${periodo}:`,
    "",
    ...apontamentos.map(
      (a, i) => `${i + 1}. ${a.texto}${a.data ? ` (${fmtDataBr(a.data)})` : ""}`,
    ),
    "",
    "Por favor, faça os ajustes *ainda hoje* — é urgente pro fechamento da folha.",
    "Se algum desses pontos tiver justificativa ou estiver errado, me avisa por aqui.",
    "",
    "Obrigado!",
  ];
  return linhas.join("\n");
}

// Versão cross-semana — junta apontamentos de várias semanas numa mensagem só,
// com bloco separado por período. Usado pela view "Por Empregado".
export type GrupoSemana = {
  weekStart: string;
  weekEnd: string;
  apontamentos: ApontamentoFuncionario[];
};

export function montarMensagemAjustesCrossSemana(opts: {
  empregadoNome: string;
  restNome?: string;
  grupos: GrupoSemana[]; // só semanas com apontamentos
}): string {
  const { empregadoNome, restNome, grupos } = opts;
  const primeiroNome = empregadoNome.split(" ")[0] || empregadoNome;
  const restPart = restNome ? `, da equipe de gestão do ${restNome}` : "";
  const total = grupos.reduce((s, g) => s + g.apontamentos.length, 0);
  const linhas: string[] = [
    `Olá, ${primeiroNome}! Tudo bem?`,
    "",
    `Aqui é${restPart}. Identifiquei ${total} ajuste(s) a fazer no seu ponto:`,
    "",
  ];
  let counter = 0;
  for (const g of grupos) {
    if (g.apontamentos.length === 0) continue;
    linhas.push(`📅 *Semana de ${fmtDataBr(g.weekStart)} a ${fmtDataBr(g.weekEnd)}*`);
    for (const a of g.apontamentos) {
      counter += 1;
      linhas.push(`${counter}. ${a.texto}${a.data ? ` (${fmtDataBr(a.data)})` : ""}`);
    }
    linhas.push("");
  }
  linhas.push("Por favor, faça os ajustes *ainda hoje* — é urgente pro fechamento da folha.");
  linhas.push("Se algum desses pontos tiver justificativa ou estiver errado, me avisa por aqui.");
  linhas.push("");
  linhas.push("Obrigado!");
  return linhas.join("\n");
}

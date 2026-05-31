// ════════════════════════════════════════════════════════════════════════════
//  Helpers de envio dos apontamentos via WhatsApp. Centralizado pra
//  InconformidadesTab e AjustesEscalaTab usarem a mesma mensagem.
// ════════════════════════════════════════════════════════════════════════════

import type { ApontamentoFuncionario } from "../types";
import { REGRA_CATEGORIA_DEFAULT, type ApontamentoCategoria, type ExceptionRuleId } from "./types";

function categoriaDoApontamento(a: ApontamentoFuncionario): ApontamentoCategoria {
  const rid = a.ruleId as ExceptionRuleId | undefined;
  if (rid && REGRA_CATEGORIA_DEFAULT[rid]) return REGRA_CATEGORIA_DEFAULT[rid];
  // Default conservador: apontamento sem ruleId vira "ajuste"
  // (era esse o comportamento implícito antes da categorização).
  return "ajuste";
}

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

// Mensagem padrão de envio. Agora delega ao formato por categoria —
// quando os apontamentos têm ruleId, separa Ajuste de batida vs
// Alinhamento em 2 blocos distintos.
export function montarMensagemAjustes(opts: {
  empregadoNome: string;
  restNome?: string;
  weekStart: string;
  weekEnd: string;
  apontamentos: ApontamentoFuncionario[];
}): string {
  return montarMensagemPorCategoria(opts);
}

// ─── NOVO: mensagens por CATEGORIA ───────────────────────────────────────
//
// Modelo:
//   - "Ajuste de batida": tom direto, urgência — empregado precisa CORRIGIR
//     no Sólides (batida a menos, ponto aberto etc).
//   - "Alinhamento": tom conversacional — comportamento a ser alinhado pra
//     não se repetir (atraso, jornada > 10h, falta de intervalo etc).
//
// Quando o líder envia o WhatsApp, o front escolhe qual usar com base no
// ruleId de cada apontamento. Se houver itens das 2 categorias, monta
// uma mensagem com 2 BLOCOS (um por categoria), pra ficar didático.

function montarBlocoAjuste(apontamentos: ApontamentoFuncionario[], periodoLabel: string): string[] {
  const linhas: string[] = [];
  linhas.push(`✏️ *Ajustes de batida que precisam ser corrigidos no Sólides — ${periodoLabel}:*`);
  apontamentos.forEach((a, i) => {
    linhas.push(`${i + 1}. ${a.texto}${a.data ? ` (${fmtDataBr(a.data)})` : ""}`);
  });
  linhas.push("");
  linhas.push("Por favor, faça os ajustes *ainda hoje* — é urgente pro fechamento da folha.");
  return linhas;
}

function montarBlocoAlinhamento(apontamentos: ApontamentoFuncionario[], periodoLabel: string): string[] {
  const linhas: string[] = [];
  linhas.push(`🗣️ *Pontos pra alinharmos — ${periodoLabel}:*`);
  apontamentos.forEach((a, i) => {
    linhas.push(`${i + 1}. ${a.texto}${a.data ? ` (${fmtDataBr(a.data)})` : ""}`);
  });
  linhas.push("");
  linhas.push("Esses pontos não precisam ser corrigidos no Sólides — quero só te dar ciência e alinharmos pra não se repetir.");
  return linhas;
}

export function montarMensagemPorCategoria(opts: {
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

  const ajuste = apontamentos.filter(a => categoriaDoApontamento(a) === "ajuste");
  const alinhamento = apontamentos.filter(a => categoriaDoApontamento(a) === "alinhamento");

  const linhas: string[] = [`Olá, ${primeiroNome}! Tudo bem?`, ""];
  linhas.push(`Aqui é${restPart}. Sobre o seu ponto da semana de ${periodo}:`);
  linhas.push("");

  if (ajuste.length > 0) {
    linhas.push(...montarBlocoAjuste(ajuste, periodo));
    if (alinhamento.length > 0) linhas.push("");
  }
  if (alinhamento.length > 0) {
    linhas.push(...montarBlocoAlinhamento(alinhamento, periodo));
  }

  linhas.push("");
  linhas.push("Se algum desses pontos tiver justificativa ou estiver errado, me avisa por aqui.");
  linhas.push("");
  linhas.push("Obrigado!");
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

  // Achata todos os apontamentos pra separar por categoria
  const todos: ApontamentoFuncionario[] = [];
  grupos.forEach(g => todos.push(...g.apontamentos));
  const ajuste = todos.filter(a => categoriaDoApontamento(a) === "ajuste");
  const alinhamento = todos.filter(a => categoriaDoApontamento(a) === "alinhamento");

  const linhas: string[] = [
    `Olá, ${primeiroNome}! Tudo bem?`,
    "",
    `Aqui é${restPart}. Sobre o seu ponto:`,
    "",
  ];

  if (ajuste.length > 0) {
    linhas.push("✏️ *Ajustes de batida que precisam ser corrigidos no Sólides:*");
    let c = 0;
    for (const g of grupos) {
      const itens = g.apontamentos.filter(a => categoriaDoApontamento(a) === "ajuste");
      if (itens.length === 0) continue;
      linhas.push(`📅 _Semana de ${fmtDataBr(g.weekStart)} a ${fmtDataBr(g.weekEnd)}_`);
      itens.forEach(a => {
        c += 1;
        linhas.push(`${c}. ${a.texto}${a.data ? ` (${fmtDataBr(a.data)})` : ""}`);
      });
    }
    linhas.push("");
    linhas.push("Por favor, faça os ajustes *ainda hoje* — é urgente pro fechamento da folha.");
    if (alinhamento.length > 0) linhas.push("");
  }

  if (alinhamento.length > 0) {
    linhas.push("🗣️ *Pontos pra alinharmos:*");
    let c = 0;
    for (const g of grupos) {
      const itens = g.apontamentos.filter(a => categoriaDoApontamento(a) === "alinhamento");
      if (itens.length === 0) continue;
      linhas.push(`📅 _Semana de ${fmtDataBr(g.weekStart)} a ${fmtDataBr(g.weekEnd)}_`);
      itens.forEach(a => {
        c += 1;
        linhas.push(`${c}. ${a.texto}${a.data ? ` (${fmtDataBr(a.data)})` : ""}`);
      });
    }
    linhas.push("");
    linhas.push("Esses pontos não precisam ser corrigidos no Sólides — quero só te dar ciência e alinharmos pra não se repetir.");
  }

  linhas.push("");
  linhas.push("Se algum desses pontos tiver justificativa ou estiver errado, me avisa por aqui.");
  linhas.push("");
  linhas.push("Obrigado!");
  return linhas.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
//  Helpers pra montar a mensagem WhatsApp do LOTE de solicitação de ajuste.
//
//  Líder seleciona vários apontamentos de "Ajuste de batida" de um mesmo
//  empregado, envia tudo numa só mensagem listando data + regra + detalhes.
//  Apontamentos viram status "aguardando_ajuste" (não-terminal — empregado
//  ainda tem que agir; quando ele corrige na Sólides e a próxima atualização
//  detectar que sumiu, vira "corrigido_solides" automático).
// ════════════════════════════════════════════════════════════════════════════

import { RULES_META } from "./rules";

function fmtDataBr(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  if (!a || !m || !d) return ymd;
  return `${d}/${m}/${a}`;
}

export type ApontamentoLote = {
  date: string;
  ruleId: string;
  description: string;
  detail?: string;
};

export function montarMensagemLoteAjuste(opts: {
  empregadoNome: string;
  restNome: string;
  apontamentos: ApontamentoLote[];
}): string {
  const { empregadoNome, restNome, apontamentos } = opts;
  const linhas: string[] = [];
  const primeiroNome = empregadoNome.split(/\s+/)[0];
  linhas.push(`Oi ${primeiroNome}, tudo bem? Preciso que você ajuste estes pontos na Sólides (${restNome}):`);
  linhas.push("");
  apontamentos.forEach((a, i) => {
    const meta = RULES_META[a.ruleId as keyof typeof RULES_META];
    const label = meta?.label || a.ruleId;
    const det = a.detail ? ` — ${a.detail}` : a.description ? ` — ${a.description}` : "";
    linhas.push(`${i + 1}. ${fmtDataBr(a.date)} · ${label}${det}`);
  });
  linhas.push("");
  linhas.push("Quando ajustar, me avisa que eu reviso aqui. Obrigado!");
  return linhas.join("\n");
}

export function montarLinkWhats(whatsapp: string, mensagem: string): string {
  const numero = (whatsapp || "").replace(/\D/g, "");
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

// Pra uso "Alinhei presencialmente" — não abre wa.me, só registra.

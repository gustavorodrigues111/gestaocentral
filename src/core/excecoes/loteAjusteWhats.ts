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

// Extrai apenas as horas "HH:MM" da description do batidasImpares
// (formato gerado em generateReport.ts: "N batidas registradas (esperado M):
// HH:MM · HH:MM · HH:MM. ..."). Retorna lista de horas no formato original.
function extrairHorasBatidas(description: string): string[] {
  const m = description.match(/:\s*((?:\d{2}:\d{2})(?:\s*·\s*\d{2}:\d{2})*)\s*\./);
  if (!m) return [];
  return m[1].split("·").map((s) => s.trim()).filter(Boolean);
}

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

    // Tratamento especial pra batidasImpares: em vez de despejar a description
    // completa (que tem hipóteses internas pro líder), monta uma linha pedindo
    // pro empregado confirmar qual ponta faltou.
    if (a.ruleId === "batidasImpares") {
      const horas = extrairHorasBatidas(a.description || "");
      const horasTxt = horas.length > 0 ? ` (${horas.join(", ")})` : "";
      const qtd = horas.length;
      const qtdTxt = qtd > 0 ? `${qtd} batidas registradas` : "Batidas registradas";
      linhas.push(
        `${i + 1}. ${fmtDataBr(a.date)} · ${label} — ${qtdTxt}${horasTxt}. Confere com a gente qual ponta faltou: a entrada inicial ou a saída final?`,
      );
      return;
    }

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

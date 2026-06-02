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
  batidas?: string;
};

// Extrai apenas as horas "HH:MM" da description do batidasImpares
// (formato gerado em generateReport.ts: "N batidas registradas (esperado M):
// HH:MM · HH:MM · HH:MM. ..."). Retorna lista de horas no formato original.
function extrairHorasBatidas(description: string): string[] {
  const m = description.match(/:\s*((?:\d{2}:\d{2})(?:\s*·\s*\d{2}:\d{2})*)\s*\./);
  if (!m) return [];
  return m[1].split("·").map((s) => s.trim()).filter(Boolean);
}

// Extrai TODAS as horas "HH:MM" do snapshot de batidas
// ("E1 11:39 → S1 17:11 · E2 17:59 → S2 22:51") em ordem cronológica.
// Usado pra montar uma representação concisa no WhatsApp (lista de horas
// crua é mais útil pro empregado conferir).
function extrairHorasDeBatidasSnap(batidas: string): string[] {
  const m = batidas.match(/\d{2}:\d{2}/g);
  return m ? Array.from(m) : [];
}

// Descrição curta da regra pra usar como bullet — só o "X de Y" relevante,
// não a frase completa que repete contexto do dia.
function bulletCurto(a: ApontamentoLote): string {
  const meta = RULES_META[a.ruleId as keyof typeof RULES_META];
  const label = meta?.label || a.ruleId;
  // Pra batidasImpares dentro de grupo já com batidas no header, basta dizer
  // que falta uma batida — o líder/empregado conferem com as horas listadas.
  if (a.ruleId === "batidasImpares") {
    return `${label} — confere qual ponta faltou (entrada inicial ou saída final).`;
  }
  // Pra outras regras, a description já é compacta o suficiente
  // ("Trabalhou 10h24 no dia (máx. 10h).", "Jornada de 10h24 com intervalo
  // de apenas 48min..."). Usa direto.
  return `${label} — ${a.description || ""}`.trim();
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

  // ── Agrupamento: chave = `${date}|${batidas || ""}`. Apontamentos do
  // mesmo dia com as MESMAS batidas viram 1 entrada com bullets. Quando
  // batidas é vazio (legado / dia sem marcação), cada item fica solo
  // pra preservar formato antigo.
  type Grupo = { date: string; batidas?: string; itens: ApontamentoLote[] };
  const grupos: Grupo[] = [];
  const grupoIndex = new Map<string, number>();
  for (const a of apontamentos) {
    const k = a.batidas ? `${a.date}|${a.batidas}` : "";
    if (k && grupoIndex.has(k)) {
      grupos[grupoIndex.get(k) as number].itens.push(a);
    } else {
      const g: Grupo = { date: a.date, batidas: a.batidas, itens: [a] };
      if (k) grupoIndex.set(k, grupos.length);
      grupos.push(g);
    }
  }

  grupos.forEach((g, i) => {
    if (g.itens.length === 1 && !g.batidas) {
      // Sem batidas (legado) → formato antigo
      const a = g.itens[0];
      const meta = RULES_META[a.ruleId as keyof typeof RULES_META];
      const label = meta?.label || a.ruleId;
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
      return;
    }
    // Com batidas no grupo: 1 entrada com bullets
    const horas = g.batidas ? extrairHorasDeBatidasSnap(g.batidas) : [];
    const horasTxt = horas.length > 0 ? ` — Batidas: ${horas.join(", ")}.` : "";
    if (g.itens.length === 1) {
      // 1 item + batidas → bullet inline pra ficar limpo
      const a = g.itens[0];
      linhas.push(`${i + 1}. ${fmtDataBr(g.date)}${horasTxt}`);
      linhas.push(`   • ${bulletCurto(a)}`);
    } else {
      linhas.push(`${i + 1}. ${fmtDataBr(g.date)}${horasTxt}`);
      for (const a of g.itens) {
        linhas.push(`   • ${bulletCurto(a)}`);
      }
    }
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

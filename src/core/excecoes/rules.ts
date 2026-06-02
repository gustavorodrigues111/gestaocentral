// ════════════════════════════════════════════════════════════════════════════
//  rules — motor de regras de não-conformidade. Cada regra é uma função PURA
//  (DayContext) => ExceptionRecord | null. `runAllRules` orquestra todas.
//
//  Pra adicionar uma regra nova: cria a função, registra em RULES_META e
//  adiciona em ALL_RULES.
// ════════════════════════════════════════════════════════════════════════════

import type {
  DayContext,
  ExceptionRecord,
  ExceptionRuleId,
  ExceptionSeverity,
  SolidesPunch,
} from "./types";

export type RuleMeta = {
  id: ExceptionRuleId;
  label: string;
  severity: ExceptionSeverity;
  icon: string;
  descricaoRegra: string; // explicação da regra (pra UI / tooltip)
};

export const RULES_META: Record<ExceptionRuleId, RuleMeta> = {
  jornadaAcimaDe10h: {
    id: "jornadaAcimaDe10h",
    label: "Jornada acima de 10h",
    severity: "grave",
    icon: "⏰",
    descricaoRegra: "Total trabalhado no dia ultrapassa 10h (CLT Art. 59).",
  },
  intervaloMenorQueLegal: {
    id: "intervaloMenorQueLegal",
    label: "Intervalo abaixo do legal",
    severity: "grave",
    icon: "🍽️",
    descricaoRegra: "Jornada acima de 6h com intervalo menor que 55min (CLT Art. 71 — tolerância 5min sobre 60min legais).",
  },
  interjornadaCurta: {
    id: "interjornadaCurta",
    label: "Interjornada curta",
    severity: "grave",
    icon: "🌙",
    descricaoRegra: "Menos de 11h entre a saída de um dia e a entrada do próximo (CLT Art. 66).",
  },
  setePlusDiasSemFolga: {
    id: "setePlusDiasSemFolga",
    label: "7+ dias sem folga",
    severity: "grave",
    icon: "📆",
    descricaoRegra: "7 ou mais dias consecutivos com marcação de ponto (CLT Art. 67 / DSR).",
  },
  pontoAberto: {
    id: "pontoAberto",
    label: "Ponto aberto",
    severity: "aviso",
    icon: "🚪",
    descricaoRegra: "Bloco de trabalho sem saída registrada (ou saída igual à entrada).",
  },
  faltaSemAjuste: {
    id: "faltaSemAjuste",
    label: "Falta sem ajuste",
    severity: "aviso",
    icon: "❓",
    descricaoRegra: "Dia escalado como trabalho, sem marcação e sem motivo de ajuste.",
  },
  faltaJustificadaSolides: {
    id: "faltaJustificadaSolides",
    label: "Justificado no Sólides",
    severity: "info",
    icon: "✓",
    descricaoRegra: "Dia escalado como trabalho, sem marcação, MAS o Sólides tem um ajuste aprovado (atestado, óbito, inversão de folga, etc). Não é inconformidade — só dê ciência.",
  },
  marcacaoForaDaEscala: {
    id: "marcacaoForaDaEscala",
    label: "Marcação fora da escala",
    severity: "aviso",
    icon: "📍",
    descricaoRegra: "Marcação de ponto num dia não escalado pra trabalho, sem motivo de ajuste.",
  },
  blocoSuspeito: {
    id: "blocoSuspeito",
    label: "Bloco suspeito",
    severity: "info",
    icon: "🔍",
    descricaoRegra: "Bloco de trabalho com duração menor que 10 minutos.",
  },
  atrasoEntrada: {
    id: "atrasoEntrada",
    label: "Atraso na entrada",
    severity: "aviso",
    icon: "⏱️",
    descricaoRegra: "Primeira entrada do dia mais de 10min após o horário previsto no quadro da Sólides.",
  },
  entradaProvavelFaltante: {
    id: "entradaProvavelFaltante",
    label: "Entrada provavelmente faltante",
    severity: "aviso",
    icon: "🚧",
    descricaoRegra: "Primeira batida do dia muito depois do horário previsto (>3h). Provavelmente o empregado esqueceu de bater a entrada inicial e o sistema confundiu a batida seguinte com 'entrada'.",
  },
  batidasImpares: {
    id: "batidasImpares",
    label: "Batida faltando",
    severity: "aviso",
    icon: "🚧",
    descricaoRegra: "Quantidade ímpar de batidas no dia — uma batida (entrada ou saída) está faltando.",
  },
  divergenciaSolidesEscala: {
    id: "divergenciaSolidesEscala",
    label: "Sólides ≠ Planejamento",
    severity: "aviso",
    icon: "🏢",
    descricaoRegra: "A escala da Sólides difere do Planejamento naquele dia (típico em empregados com escala alternada A/B — a Sólides só aceita uma semana fixa). Empregado cumpriu o combinado no Planejamento, mas a Sólides vai cobrar errado — ajuste manual lá.",
  },
};

const MIN_INTERJORNADA = 11 * 60; // 660 min
// Intervalo intrajornada legal é 60min (CLT Art. 71). Aceitamos uma tolerância
// de 5min — só faz apontamento abaixo de 55min de intervalo.
const MIN_INTERVALO = 55; // min
const JORNADA_MAX = 10 * 60; // 600 min
const JORNADA_EXIGE_INTERVALO = 6 * 60; // 360 min
// Atraso na entrada: tolerância de 10min sobre o horário previsto no quadro
// Sólides — só vira apontamento acima disso.
const TOLERANCIA_ATRASO = 10; // min
// Acima desse limiar, "atraso" deixa de fazer sentido — é quase certo que
// o empregado esqueceu de bater a entrada inicial. Dispara a regra
// `entradaProvavelFaltante` em vez de `atrasoEntrada`.
const ATRASO_MAX_PROVAVEL = 3 * 60; // 3h

// minutos → "8h30"
function fmtH(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, "0")}`;
}

// epoch ms (UTC) → "HH:MM" em BRT (UTC-3, sem horário de verão).
function fmtHora(ms: number | undefined | null): string {
  if (typeof ms !== "number" || ms <= 0) return "—";
  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const brtMin = (utcMin - 180 + 1440) % 1440;
  const h = Math.floor(brtMin / 60);
  const m = brtMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Formata todas as batidas do dia: "E1 08:00 → S1 12:00 · E2 13:00 → S2 17:30".
// Bloco sem saída fica como "aberto".
export function formatarBatidas(blocks: SolidesPunch[]): string {
  if (!blocks || blocks.length === 0) return "sem batidas";
  return blocks
    .map((b, i) => {
      const ent = fmtHora(b.dateIn);
      const sai = b.dateOut && b.dateOut > b.dateIn ? fmtHora(b.dateOut) : "aberto";
      return `E${i + 1} ${ent} → S${i + 1} ${sai}`;
    })
    .join(" · ");
}

// Helper pra montar um ExceptionRecord a partir do contexto. O resumo dos
// blocos do dia vai num campo dedicado `batidas` (UI mostra UMA vez no header
// do dia, não repetido em cada apontamento). `detail` fica reservado pro
// contexto específico da regra (ex: "escala = folga" em marcacaoForaDaEscala).
function mk(
  ruleId: ExceptionRuleId,
  ctx: DayContext,
  description: string,
  detail?: string,
): ExceptionRecord {
  const meta = RULES_META[ruleId];
  const blocks = ctx.metrics.blocks;
  const batidas = blocks && blocks.length > 0 ? formatarBatidas(blocks) : undefined;
  const rec: ExceptionRecord = {
    ruleId,
    severity: meta.severity,
    date: ctx.metrics.date,
    employeeId: ctx.metrics.employeeId,
    cpf: ctx.metrics.cpf,
    employeeName: ctx.metrics.employeeName,
    description,
  };
  if (detail) rec.detail = detail;
  if (batidas) rec.batidas = batidas;
  return rec;
}

type Rule = (ctx: DayContext) => ExceptionRecord | null;

// 1) Jornada contratual acima de 10h
const ruleJornadaAcimaDe10h: Rule = (ctx) => {
  const { totalMinutes } = ctx.metrics;
  if (totalMinutes > JORNADA_MAX) {
    return mk("jornadaAcimaDe10h", ctx, `Trabalhou ${fmtH(totalMinutes)} no dia (máx. 10h).`);
  }
  return null;
};

// 2) Intervalo intrajornada abaixo do mínimo legal (com tolerância de 5min
//    sobre os 60min do Art. 71 — só dispara abaixo de 55min)
const ruleIntervaloMenorQueLegal: Rule = (ctx) => {
  const { totalMinutes, maxGapMinutes, blocks } = ctx.metrics;
  if (blocks.length === 0) return null;
  if (totalMinutes > JORNADA_EXIGE_INTERVALO && maxGapMinutes < MIN_INTERVALO) {
    return mk(
      "intervaloMenorQueLegal",
      ctx,
      `Jornada de ${fmtH(totalMinutes)} com intervalo de apenas ${maxGapMinutes}min (mínimo 60min, tolerância 5min).`,
    );
  }
  return null;
};

// 3) Interjornada curta — menos de 11h entre o fim de ontem e o início de hoje
const ruleInterjornadaCurta: Rule = (ctx) => {
  const { firstIn } = ctx.metrics;
  if (firstIn == null || ctx.prevDayLastOut == null) return null;
  const gapMin = Math.round((firstIn - ctx.prevDayLastOut) / 60_000);
  if (gapMin >= 0 && gapMin < MIN_INTERJORNADA) {
    return mk(
      "interjornadaCurta",
      ctx,
      `Apenas ${fmtH(gapMin)} de descanso desde a saída do dia anterior (mínimo 11h).`,
    );
  }
  return null;
};

// 4) 7+ dias consecutivos com marcação de ponto (sem DSR)
const ruleSetePlusDiasSemFolga: Rule = (ctx) => {
  if (ctx.consecutiveWorkDays >= 7) {
    return mk(
      "setePlusDiasSemFolga",
      ctx,
      `${ctx.consecutiveWorkDays}º dia consecutivo com marcação de ponto, sem folga.`,
    );
  }
  return null;
};

// 5) Ponto aberto — bloco sem saída
const rulePontoAberto: Rule = (ctx) => {
  if (ctx.metrics.hasOpenPunch) {
    return mk("pontoAberto", ctx, "Há bloco de trabalho sem saída registrada.");
  }
  return null;
};

// 6) Falta sem ajuste — escalado pra trabalhar, sem punch e sem adjustmentReason
const ruleFaltaSemAjuste: Rule = (ctx) => {
  const { blocks, hasAdjustment } = ctx.metrics;
  if (ctx.escalaStatus === "trabalho" && blocks.length === 0 && !hasAdjustment) {
    return mk(
      "faltaSemAjuste",
      ctx,
      "Escalado como trabalho, mas sem marcação de ponto e sem motivo de ajuste.",
    );
  }
  return null;
};

// 6b) Justificado no Sólides — dia originalmente previsto pra trabalho que
// virou folga por causa de um ajuste APROVADO no Sólides (atestado, óbito,
// inversão de folga, etc). aplicarAjustesNaEscala() já marca o dia como
// folga, mas o usuário quer VER essa linha pra confirmar "vi e tá certo"
// em vez dela simplesmente sumir. Esta regra dispara quando o sinal
// `ajusteSolidesAplicado` está presente E o status anterior era "trabalho".
const ruleFaltaJustificadaSolides: Rule = (ctx) => {
  const ajuste = ctx.ajusteSolidesAplicado;
  if (!ajuste) return null;
  if (ajuste.statusAnterior !== "trabalho") return null;
  if (ctx.metrics.blocks.length > 0) return null; // bateu ponto = não é falta justificada
  return mk(
    "faltaJustificadaSolides",
    ctx,
    `Ajuste no Sólides: ${ajuste.tipo}.`,
    `Previsto era trabalho; o Sólides registrou ${ajuste.tipo.toLowerCase()} — não bateu ponto.`,
  );
};

// 7) Marcação fora da escala — dia não escalado pra trabalho, com punch, sem ajuste
const ruleMarcacaoForaDaEscala: Rule = (ctx) => {
  const { blocks, hasAdjustment } = ctx.metrics;
  const escaladoTrabalho = ctx.escalaStatus === "trabalho";
  if (!escaladoTrabalho && blocks.length > 0 && !hasAdjustment) {
    const statusTxt = ctx.escalaStatus
      ? `escala = "${ctx.escalaStatus}"`
      : "dia sem escala registrada";
    return mk(
      "marcacaoForaDaEscala",
      ctx,
      "Marcou ponto num dia não escalado pra trabalho, sem motivo de ajuste.",
      statusTxt,
    );
  }
  return null;
};

// 8) Bloco suspeito — duração < 10min
const ruleBlocoSuspeito: Rule = (ctx) => {
  if (ctx.metrics.shortBlocks > 0) {
    return mk(
      "blocoSuspeito",
      ctx,
      `${ctx.metrics.shortBlocks} bloco(s) com menos de 10min de duração.`,
    );
  }
  return null;
};

// 9) Atraso na entrada — firstIn > horário previsto + 10min de tolerância.
// Compara a primeira entrada real (epoch ms) com o `in` do quadro cadastrado
// na Sólides (HH:MM). Não usa escala prevista do Planejamento. Suprime-se
// quando o atraso passa de 3h — esse caso vira `entradaProvavelFaltante`
// (caso clássico: empregado esqueceu de bater a entrada inicial, e o que o
// sistema vê como "E1" é na verdade a saída do almoço ou similar).
const ruleAtrasoEntrada: Rule = (ctx) => {
  const { firstIn, blocks } = ctx.metrics;
  const previsto = ctx.horarioPrevisto;
  if (!previsto || firstIn == null || blocks.length === 0) return null;
  const realMin = brtMinutesFromEpoch(firstIn);
  const previstoMin = parseHHMM(previsto.in);
  if (realMin == null || previstoMin == null) return null;
  const diff = realMin - previstoMin;
  if (diff > TOLERANCIA_ATRASO && diff <= ATRASO_MAX_PROVAVEL) {
    return mk(
      "atrasoEntrada",
      ctx,
      `Entrada às ${fmtHora(firstIn)} (previsto ${previsto.in}) — ${diff}min de atraso.`,
    );
  }
  return null;
};

// 10) Entrada provavelmente faltante — atraso "absurdo" (>3h) indica que o
// empregado esqueceu de bater a entrada inicial. A linha do tempo tipicamente
// fica: [batida no meio do dia → saída do almoço → entrada do almoço → saída].
// Sólides interpreta como [E1 → S1 → E2 → S2 aberto] e dispara "atraso" +
// "ponto aberto". Mais útil pro líder é uma exceção dedicada apontando que
// PRECISA AJUSTAR MANUALMENTE a primeira batida.
const ruleEntradaProvavelFaltante: Rule = (ctx) => {
  const { firstIn, blocks } = ctx.metrics;
  const previsto = ctx.horarioPrevisto;
  if (!previsto || firstIn == null || blocks.length === 0) return null;
  const realMin = brtMinutesFromEpoch(firstIn);
  const previstoMin = parseHHMM(previsto.in);
  if (realMin == null || previstoMin == null) return null;
  const diff = realMin - previstoMin;
  if (diff > ATRASO_MAX_PROVAVEL) {
    return mk(
      "entradaProvavelFaltante",
      ctx,
      `Primeira batida só às ${fmtHora(firstIn)} (previsto ${previsto.in}) — ${fmtH(diff)} depois. Provavelmente faltou bater a entrada inicial; ajustar manualmente.`,
    );
  }
  return null;
};

// epoch ms (UTC) → minutos desde 00:00 em BRT (UTC-3, sem horário de verão)
function brtMinutesFromEpoch(ms: number): number | null {
  if (typeof ms !== "number" || ms <= 0) return null;
  const d = new Date(ms);
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMin - 180 + 1440) % 1440;
}

// "HH:MM" → minutos desde 00:00. Retorna null se inválido.
function parseHHMM(s: string): number | null {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export const ALL_RULES: Rule[] = [
  ruleJornadaAcimaDe10h,
  ruleIntervaloMenorQueLegal,
  ruleInterjornadaCurta,
  ruleSetePlusDiasSemFolga,
  rulePontoAberto,
  ruleFaltaSemAjuste,
  ruleFaltaJustificadaSolides,
  ruleMarcacaoForaDaEscala,
  ruleBlocoSuspeito,
  ruleAtrasoEntrada,
  ruleEntradaProvavelFaltante,
];

// Roda todas as regras sobre um contexto e devolve as exceções encontradas.
export function runAllRules(ctx: DayContext): ExceptionRecord[] {
  const out: ExceptionRecord[] = [];
  for (const rule of ALL_RULES) {
    const r = rule(ctx);
    if (r) out.push(r);
  }
  return out;
}

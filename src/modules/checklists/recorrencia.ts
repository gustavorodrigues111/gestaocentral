// Recorrência POR ITEM de checklist. Cada item pode ser diário (opcional em
// certos dias da semana), semanal (dia fixo), quinzenal (semana sim/não) ou
// mensal (dia do mês). O "checklist do dia" mostra só os itens do dia.
//
// Quinzenal usa a PARIDADE da semana ISO: semana 1 = "A" (ímpar = A, par = B).
import type { ChecklistItemTemplate } from "../../core/types";

// Número da semana ISO-8601 (segunda = início; semana 1 contém a 1ª quinta).
export function isoWeek(dateYmd: string): number {
  const d = new Date(dateYmd + "T12:00:00");
  const dayNr = (d.getDay() + 6) % 7;             // seg=0 .. dom=6
  d.setDate(d.getDate() - dayNr + 3);             // quinta desta semana
  const firstThursday = d.getTime();
  d.setMonth(0, 1);                                // 1º de janeiro
  if (d.getDay() !== 4) d.setMonth(0, 1 + ((4 - d.getDay()) + 7) % 7); // 1ª quinta do ano
  return 1 + Math.round((firstThursday - d.getTime()) / (7 * 24 * 3600 * 1000));
}

// Semana 1 = A (ímpar → A, par → B).
export function semanaParidade(dateYmd: string): "A" | "B" {
  return isoWeek(dateYmd) % 2 === 1 ? "A" : "B";
}

// Âncora padrão da recorrência "dia alternado" quando o item não define uma.
const ALTERNADA_ANCORA = "2026-01-01";

// Um item aparece na data? (freq ausente = diário todo dia — retrocompat.)
export function itemDoDia(item: Pick<ChecklistItemTemplate, "freq" | "diasSemana" | "semanaParidade" | "diaDoMes" | "intervaloDias" | "dataInicio">, dateYmd: string): boolean {
  const d = new Date(dateYmd + "T12:00:00");
  const dow = d.getDay();                          // 0=Dom..6=Sáb
  const freq = item.freq || "diaria";
  if (freq === "diaria") {
    return !item.diasSemana?.length || item.diasSemana.includes(dow);
  }
  if (freq === "semanal") {
    return !!item.diasSemana?.length && item.diasSemana.includes(dow);
  }
  if (freq === "quinzenal") {
    if (!item.diasSemana?.length || !item.diasSemana.includes(dow)) return false;
    return semanaParidade(dateYmd) === (item.semanaParidade || "A");
  }
  if (freq === "mensal") {
    const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(item.diaDoMes || 1, ultimoDia);
  }
  if (freq === "alternada") {
    const n = item.intervaloDias && item.intervaloDias > 1 ? item.intervaloDias : 2;
    const a = new Date((item.dataInicio || ALTERNADA_ANCORA) + "T12:00:00");
    const diff = Math.round((d.getTime() - a.getTime()) / 86400000);
    return diff >= 0 && diff % n === 0;
  }
  return true;
}

// Template optou por frequência-por-item? (senão usa a lógica antiga do template.)
export function temFreqPorItem(itens: Pick<ChecklistItemTemplate, "freq">[]): boolean {
  return itens.some(i => !!i.freq);
}

// Rótulo curto da frequência de um item (pro card/editor).
const DOW_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function freqItemLabel(item: Pick<ChecklistItemTemplate, "freq" | "diasSemana" | "semanaParidade" | "diaDoMes" | "intervaloDias">): string {
  const freq = item.freq || "diaria";
  const dias = (item.diasSemana || []).map(d => DOW_CURTO[d]).join("/");
  if (freq === "diaria") return item.diasSemana?.length ? `Todo ${dias}` : "Todo dia";
  if (freq === "semanal") return dias ? `Toda ${dias}` : "Semanal";
  if (freq === "quinzenal") return `Quinzenal ${dias} (sem. ${item.semanaParidade || "A"})`;
  if (freq === "mensal") return `Todo dia ${item.diaDoMes || 1}`;
  if (freq === "alternada") { const n = item.intervaloDias || 2; return n === 2 ? "Dia sim, dia não" : `A cada ${n} dias`; }
  return "Todo dia";
}

// Campos de frequência que o mapeador de periodicidade produz.
export type FreqParcial = Partial<Pick<ChecklistItemTemplate, "freq" | "diasSemana" | "semanaParidade" | "diaDoMes" | "intervaloDias">>;

// Mapeia uma PERIODICIDADE escrita à mão (ex.: "SEMANAL", "DIA SIM DIA NÃO",
// "QUINZENAL", "2X NA SEMANA", "MENSAL") para os campos de frequência por item.
// Retorna {} quando não reconhece (item fica sem freq própria). Quando o dia da
// semana não é dado no papel, escolhe padrões espaçados pra você ajustar depois.
export function parsePeriodicidade(textoRaw: string): FreqParcial {
  const t = (textoRaw || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!t) return {};
  // dia sim / dia não  → alternada (a cada 2 dias)
  if (/dia\s*sim.*dia\s*n|dia\s*n.*dia\s*sim|alternad/.test(t)) return { freq: "alternada", intervaloDias: 2 };
  // mensal / 1x mês
  if (/mensal|(\d+\s*x?\s*(por|no|ao|\/)?\s*me(s|ses))|uma?\s*vez.*me/.test(t)) return { freq: "mensal", diaDoMes: 1 };
  // quinzenal / a cada 15 dias / 2x mês
  if (/quinzen|cada\s*15\s*dias|2\s*x?\s*(por|no|ao|\/)?\s*me/.test(t)) return { freq: "quinzenal", diasSemana: [1], semanaParidade: "A" };
  // diária / todo dia
  if (/diari|todo\s*dia|todos\s*os\s*dias|di[aá]rio/.test(t)) return { freq: "diaria" };
  // N vezes na semana / semanal
  const mVezes = t.match(/(\d+)\s*x?\s*(vezes?)?\s*(por|na|no|ao|\/)?\s*semana/);
  const vezes = mVezes ? parseInt(mVezes[1]) : (/semanal|uma?\s*vez.*semana|1\s*x?\s*semana/.test(t) ? 1 : 0);
  if (vezes > 0) {
    const defaults: Record<number, number[]> = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };
    return { freq: "semanal", diasSemana: defaults[Math.min(vezes, 7)] || [1] };
  }
  return {};
}

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

// Um item aparece na data? (freq ausente = diário todo dia — retrocompat.)
export function itemDoDia(item: Pick<ChecklistItemTemplate, "freq" | "diasSemana" | "semanaParidade" | "diaDoMes">, dateYmd: string): boolean {
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
  return true;
}

// Template optou por frequência-por-item? (senão usa a lógica antiga do template.)
export function temFreqPorItem(itens: Pick<ChecklistItemTemplate, "freq">[]): boolean {
  return itens.some(i => !!i.freq);
}

// Rótulo curto da frequência de um item (pro card/editor).
const DOW_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function freqItemLabel(item: Pick<ChecklistItemTemplate, "freq" | "diasSemana" | "semanaParidade" | "diaDoMes">): string {
  const freq = item.freq || "diaria";
  const dias = (item.diasSemana || []).map(d => DOW_CURTO[d]).join("/");
  if (freq === "diaria") return item.diasSemana?.length ? `Todo ${dias}` : "Todo dia";
  if (freq === "semanal") return dias ? `Toda ${dias}` : "Semanal";
  if (freq === "quinzenal") return `Quinzenal ${dias} (sem. ${item.semanaParidade || "A"})`;
  if (freq === "mensal") return `Todo dia ${item.diaDoMes || 1}`;
  return "Todo dia";
}

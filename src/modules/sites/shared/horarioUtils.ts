import type { HorarioFuncionamentoDia, ExcecaoHorarioSite } from "../../../core/types";

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONGOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// Agrupa dias com horário idêntico ("Seg–Qui • 19h–23h").
// Útil pra mostrar horário compacto no site público.
export function agruparHorarios(horarios: HorarioFuncionamentoDia[]): {
  diasLabel: string;
  turnosLabel: string;
  fechado: boolean;
}[] {
  // Ordena dom→sáb
  const ordenados = [...horarios].sort((a, b) => a.dia - b.dia);
  const grupos: {
    diasLabel: string;
    turnosLabel: string;
    fechado: boolean;
    diasIdx: number[];
  }[] = [];

  for (const h of ordenados) {
    const key = h.fechado ? "fechado" : h.turnos.map(t => `${t.abre}-${t.fecha}`).join("|");
    const ultimo = grupos[grupos.length - 1];
    const ultimaKey = ultimo
      ? (ultimo.fechado ? "fechado" : ultimo.turnosLabel.replace(/ /g, ""))
      : null;
    // Junta se for consecutivo E mesmo horário
    if (ultimo && ultimaKey === key && ultimo.diasIdx[ultimo.diasIdx.length - 1] === h.dia - 1) {
      ultimo.diasIdx.push(h.dia);
    } else {
      grupos.push({
        diasLabel: "",
        turnosLabel: h.fechado ? "" : h.turnos.map(t => `${t.abre}–${t.fecha}`).join(" / "),
        fechado: h.fechado,
        diasIdx: [h.dia],
      });
    }
  }
  // Monta diasLabel
  for (const g of grupos) {
    if (g.diasIdx.length === 1) {
      g.diasLabel = DIAS_LONGOS[g.diasIdx[0]];
    } else if (g.diasIdx.length === 2) {
      g.diasLabel = `${DIAS_CURTOS[g.diasIdx[0]]}, ${DIAS_CURTOS[g.diasIdx[1]]}`;
    } else {
      g.diasLabel = `${DIAS_CURTOS[g.diasIdx[0]]} – ${DIAS_CURTOS[g.diasIdx[g.diasIdx.length - 1]]}`;
    }
  }
  return grupos.map(g => ({
    diasLabel: g.diasLabel,
    turnosLabel: g.turnosLabel,
    fechado: g.fechado,
  }));
}

// Próximas exceções (futuras + hoje), dentro de uma janela de N dias.
// Default: janela de 30 dias + máximo 6 itens. Exceções muito distantes
// não aparecem no site (poluem) — só quando ficarem perto da data.
export function proximasExcecoes(
  excecoes: ExcecaoHorarioSite[] | undefined,
  limit = 6,
  diasJanela = 30,
): ExcecaoHorarioSite[] {
  if (!excecoes) return [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limiteSuperior = new Date(hoje);
  limiteSuperior.setDate(limiteSuperior.getDate() + diasJanela);
  const hojeYmd = isoLocalDate(hoje);
  const limiteYmd = isoLocalDate(limiteSuperior);
  return excecoes
    .filter(e => e.data >= hojeYmd && e.data <= limiteYmd)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, limit);
}

function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Formata data YYYY-MM-DD → DD/MM ou "hoje", "amanhã"
export function formatarDataCurta(ymd: string): string {
  const d = new Date(ymd + "T12:00:00");
  const hoje = new Date(); hoje.setHours(12, 0, 0, 0);
  const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
  if (d.getTime() === hoje.getTime()) return "hoje";
  if (d.getTime() === amanha.getTime()) return "amanhã";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

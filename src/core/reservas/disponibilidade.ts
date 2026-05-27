// ════════════════════════════════════════════════════════════════════════════
//  Resolução de disponibilidade de Reservas
//
//  Combina 3 fontes de verdade pra decidir o que está disponível em cada
//  data específica:
//
//    1. `ConfiguracaoReservas.janelas` — padrão semanal (recorrente por dia
//       da semana). É o ponto de partida.
//
//    2. `SiteConfig.excecoes` — exceções de horário do funcionamento normal
//       (feriados, datas especiais). Quando `fechado=true` o dia está fora
//       do ar pra qualquer reserva. Quando `slotsReservaCustom` está
//       preenchido, esses substituem a janela semanal.
//
//    3. `ExcecaoReserva[]` (coleção `excecoesReserva`) — exceções granulares
//       criadas pela aba Agenda. Sobrescrevem 1 e 2:
//         - tipo=bloqueio escopo=dia_inteiro → bloqueia o dia
//         - tipo=bloqueio escopo=slot        → remove esse slot do dia
//         - tipo=personalizacao              → marca slot como personalizado
//                                              (override salões/pax)
//         - tipo=janela_extra                → adiciona slot novo
//
//  A função principal é `resolverDisponibilidadeDia(data, config, siteConfig,
//  excecoes)` que devolve um `DiaResolvido` pronto pra:
//   - UI da Agenda (cores por status)
//   - Form público (só mostra slots não-bloqueados, respeitando overrides)
// ════════════════════════════════════════════════════════════════════════════

import type {
  ConfiguracaoReservas,
  DiaResolvido,
  ExcecaoHorarioSite,
  ExcecaoReserva,
  SlotResolvido,
  SlotReserva,
  StatusSlotResolvido,
} from "../types";

// ─── INPUTS ──────────────────────────────────────────────────────────

export type ResolverInput = {
  /** Doc de ConfiguracaoReservas do restaurante (pode ser null). */
  config: ConfiguracaoReservas | null;
  /** Exceções legadas vindas do SiteConfig (fechado/slotsReservaCustom). */
  excecoesSite?: ExcecaoHorarioSite[];
  /** Exceções granulares novas (coleção `excecoesReserva`). */
  excecoesReserva: ExcecaoReserva[];
};

// ─── HELPERS ─────────────────────────────────────────────────────────

function diaSemanaDe(dataYmd: string): number {
  // "YYYY-MM-DD" — adiciona T12 pra evitar fuso horário virar dia anterior
  return new Date(dataYmd + "T12:00:00").getDay();
}

function compararHorario(a: string, b: string): number {
  // "HH:MM" é zero-padded → comparação lexicográfica funciona
  return a < b ? -1 : a > b ? 1 : 0;
}

function ordenarSlots<T extends { horario: string }>(slots: T[]): T[] {
  return [...slots].sort((a, b) => compararHorario(a.horario, b.horario));
}

// ─── RESOLUÇÃO POR DIA ───────────────────────────────────────────────

/**
 * Resolve a disponibilidade de UM dia, combinando padrão semanal +
 * exceções (site + reserva). Determinístico — mesmo input → mesmo output.
 *
 * @param dataYmd   "YYYY-MM-DD"
 * @param input     fontes (config + excecoesSite + excecoesReserva)
 */
export function resolverDisponibilidadeDia(
  dataYmd: string,
  input: ResolverInput,
): DiaResolvido {
  const dow = diaSemanaDe(dataYmd);
  const { config, excecoesSite, excecoesReserva } = input;

  // Excecoes legadas (SiteConfig) específicas dessa data
  const excSite = excecoesSite?.find(e => e.data === dataYmd) || null;
  // Excecoes novas dessa data
  const excecoesDia = excecoesReserva.filter(e => e.data === dataYmd);

  // ─── Caso 1: dia inteiro bloqueado via SiteConfig (fechado=true) ───
  if (excSite?.fechado) {
    return {
      data: dataYmd,
      diaSemana: dow,
      diaBloqueado: true,
      motivoDiaBloqueado: excSite.motivo || "Fechado",
      slots: [],
    };
  }

  // ─── Caso 2: dia inteiro bloqueado via excecaoReserva ───
  const excDiaInteiroBlock = excecoesDia.find(
    e => e.escopo === "dia_inteiro" && e.tipo === "bloqueio",
  );
  if (excDiaInteiroBlock) {
    return {
      data: dataYmd,
      diaSemana: dow,
      diaBloqueado: true,
      motivoDiaBloqueado: excDiaInteiroBlock.motivo || "Bloqueado",
      slots: [],
    };
  }

  // ─── Slots base ───
  // Prioridade: slotsReservaCustom (SiteConfig) > janela semanal padrão.
  let slotsBase: SlotReserva[] = [];
  let baseEhCustom = false;
  if (excSite?.slotsReservaCustom !== undefined) {
    slotsBase = excSite.slotsReservaCustom;
    baseEhCustom = true;
  } else {
    const janela = config?.janelas?.find(j => j.dia === dow);
    slotsBase = janela?.slots || [];
  }

  // Indexa exceções de slot pra lookup rápido por horário
  const excecoesPorHorario = new Map<string, ExcecaoReserva[]>();
  for (const exc of excecoesDia) {
    if (exc.escopo !== "slot" || !exc.horario) continue;
    const arr = excecoesPorHorario.get(exc.horario) || [];
    arr.push(exc);
    excecoesPorHorario.set(exc.horario, arr);
  }

  // ─── Constrói lista de slots resolvidos ───
  const resolved: SlotResolvido[] = [];

  // Slots vindos do base (semana padrão ou custom do SiteConfig)
  for (const slot of slotsBase) {
    const excecoesNesse = excecoesPorHorario.get(slot.horario) || [];
    const bloqueio       = excecoesNesse.find(e => e.tipo === "bloqueio");
    const personalizacao = excecoesNesse.find(e => e.tipo === "personalizacao");

    if (bloqueio) {
      // Bloqueado — entra na lista pra UI da Agenda (vermelho), mas
      // o consumidor pode filtrar. Form público filtra status≠bloqueado.
      resolved.push({
        horario: slot.horario,
        salaoIds: slot.salaoIds,
        status: "bloqueado",
        excecoesIds: [bloqueio.id],
        motivos: bloqueio.motivo ? [bloqueio.motivo] : [],
      });
      continue;
    }

    if (personalizacao) {
      resolved.push({
        horario: slot.horario,
        salaoIds: personalizacao.salaoIds ?? slot.salaoIds,
        status: "personalizado",
        paxMaxOverride: personalizacao.paxMaxOverride,
        excecoesIds: [personalizacao.id],
        motivos: personalizacao.motivo ? [personalizacao.motivo] : [],
      });
      continue;
    }

    // Slot normal — vindo do padrão semanal ou de custom do SiteConfig.
    // Se base é custom do SiteConfig (slotsReservaCustom), trato como
    // "personalizado" porque é override do padrão. Senão é "normal".
    resolved.push({
      horario: slot.horario,
      salaoIds: slot.salaoIds,
      status: baseEhCustom ? "personalizado" : "normal",
      excecoesIds: baseEhCustom && excSite?.id ? [excSite.id] : [],
      motivos: baseEhCustom && excSite?.motivo ? [excSite.motivo] : [],
    });
  }

  // Janelas extras — adiciona slots que não existem no base
  const horariosExistentes = new Set(resolved.map(r => r.horario));
  for (const exc of excecoesDia) {
    if (exc.escopo !== "slot" || exc.tipo !== "janela_extra" || !exc.horario) continue;
    if (horariosExistentes.has(exc.horario)) {
      // Conflito: já existe um slot nesse horário (vindo do padrão).
      // Estratégia: ignora a janela_extra — o slot existente prevalece.
      // (Caso seja personalização disfarçada, o admin deve usar tipo=personalizacao.)
      continue;
    }
    resolved.push({
      horario: exc.horario,
      salaoIds: exc.salaoIds ?? [],
      status: "extra",
      paxMaxOverride: exc.paxMaxOverride,
      excecoesIds: [exc.id],
      motivos: exc.motivo ? [exc.motivo] : [],
    });
    horariosExistentes.add(exc.horario);
  }

  // Se não tem slot nenhum e não tem padrão, dia "naturalmente bloqueado"
  // (restaurante fechado nesse dia da semana e ninguém abriu extra).
  if (resolved.length === 0 && slotsBase.length === 0) {
    return {
      data: dataYmd,
      diaSemana: dow,
      diaBloqueado: true,
      motivoDiaBloqueado: "Sem janela de reservas configurada",
      slots: [],
    };
  }

  return {
    data: dataYmd,
    diaSemana: dow,
    diaBloqueado: false,
    slots: ordenarSlots(resolved),
  };
}

// ─── RESOLUÇÃO DE PERÍODO ────────────────────────────────────────────

/**
 * Resolve disponibilidade pros próximos N dias a partir de uma data inicial.
 * Útil pra a aba Agenda listar tudo de uma vez.
 *
 * @param dataInicialYmd  Primeiro dia a resolver (default = hoje)
 * @param qtdDias         Quantos dias resolver (ex: 30, 60, 90)
 */
export function resolverDisponibilidadePeriodo(
  dataInicialYmd: string,
  qtdDias: number,
  input: ResolverInput,
): DiaResolvido[] {
  const dias: DiaResolvido[] = [];
  const base = new Date(dataInicialYmd + "T12:00:00");
  for (let i = 0; i < qtdDias; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    dias.push(resolverDisponibilidadeDia(`${yyyy}-${mm}-${dd}`, input));
  }
  return dias;
}

// ─── PROXIMA DATA DISPONÍVEL ─────────────────────────────────────────

/**
 * Acha a próxima data que tem pelo menos 1 slot disponível (não bloqueado).
 * Usado pra default do date picker do form público. Retorna null se nenhuma
 * data nos próximos `maxDias` tem disponibilidade.
 */
export function proximaDataDisponivel(
  dataInicialYmd: string,
  maxDias: number,
  input: ResolverInput,
): string | null {
  const dias = resolverDisponibilidadePeriodo(dataInicialYmd, maxDias, input);
  for (const d of dias) {
    if (d.diaBloqueado) continue;
    if (d.slots.some(s => s.status !== "bloqueado")) return d.data;
  }
  return null;
}

// ─── COR POR STATUS (UI Agenda) ──────────────────────────────────────

export const COR_STATUS_SLOT: Record<StatusSlotResolvido, {
  bg: string; text: string; border: string; label: string;
}> = {
  normal: {
    bg: "bg-emerald-50 dark:bg-emerald-900/20",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800",
    label: "Normal",
  },
  bloqueado: {
    bg: "bg-rose-50 dark:bg-rose-900/20",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-300 dark:border-rose-800",
    label: "Bloqueado",
  },
  personalizado: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-800 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
    label: "Personalizado",
  },
  extra: {
    bg: "bg-sky-50 dark:bg-sky-900/20",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-300 dark:border-sky-800",
    label: "Extra",
  },
};

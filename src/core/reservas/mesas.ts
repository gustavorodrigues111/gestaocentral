// Helpers de mesa da reserva — normalizam o formato NOVO (mesaIds[], várias
// mesas unidas) e o LEGADO (mesaId único). Toda leitura de mesa de uma reserva
// deve passar por aqui pra retrocompat com reservas antigas.

import type { Reserva } from "../types";

// IDs das mesas da reserva (mesaIds novo, ou [mesaId] legado, ou []).
export function reservaMesaIds(r: Pick<Reserva, "mesaIds" | "mesaId"> | null | undefined): string[] {
  if (!r) return [];
  if (r.mesaIds && r.mesaIds.length) return r.mesaIds;
  return r.mesaId ? [r.mesaId] : [];
}

// Nomes (snapshot) das mesas da reserva, mesma cascata.
export function reservaMesasNomes(
  r: Pick<Reserva, "mesasNomesSnapshot" | "mesaNomeSnapshot"> | null | undefined,
): string[] {
  if (!r) return [];
  if (r.mesasNomesSnapshot && r.mesasNomesSnapshot.length) return r.mesasNomesSnapshot;
  return r.mesaNomeSnapshot ? [r.mesaNomeSnapshot] : [];
}

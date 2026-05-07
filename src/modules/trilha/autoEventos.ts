// ════════════════════════════════════════════════════════════════════════════
// Helper pra disparar eventos AUTOMÁTICOS na trilha do empregado.
// ════════════════════════════════════════════════════════════════════════════
//
// Chame as funções daqui dos lugares que mexem em admissão / demissão / cargo.
// Sempre fonte = "auto" — não dá pra editar pela UI (só excluir).

import { addDoc, collection } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { EventoTrilha, EventoTrilhaTipo } from "../../core/types";

type AutoEventoInput = {
  restaurantId: string;
  empregadoId: string;
  tipo: EventoTrilhaTipo;
  data: string;             // YYYY-MM-DD
  titulo: string;
  descricao?: string;
  registradoPor: string;
};

export async function registrarAutoEvento(input: AutoEventoInput): Promise<void> {
  try {
    const evento: Omit<EventoTrilha, "id"> = {
      restaurantId: input.restaurantId,
      empregadoId: input.empregadoId,
      tipo: input.tipo,
      data: input.data,
      titulo: input.titulo,
      descricao: input.descricao,
      fonte: "auto",
      registradoEm: new Date().toISOString(),
      registradoPor: input.registradoPor,
    };
    await addDoc(collection(db, "eventosTrilha"), sanitizeForFirestore(evento));
  } catch (e) {
    // Trilha não pode bloquear o fluxo principal — log e segue
    console.error("[auto-evento trilha] falhou:", e);
  }
}

// Helper específico: admissão (chamado ao criar empregado novo OU readmitir)
export async function registrarAdmissao(args: {
  restaurantId: string;
  empregadoId: string;
  empregadoNome: string;
  cargoNome: string;
  area: string;
  admissao: string;        // YYYY-MM-DD
  ehReadmissao?: boolean;
  registradoPor: string;
}): Promise<void> {
  await registrarAutoEvento({
    restaurantId: args.restaurantId,
    empregadoId: args.empregadoId,
    tipo: args.ehReadmissao ? "readmissao" : "admissao",
    data: args.admissao,
    titulo: `${args.ehReadmissao ? "Readmissão" : "Admissão"} — ${args.cargoNome} (${args.area})`,
    descricao: `${args.empregadoNome} ${args.ehReadmissao ? "voltou ao time" : "entrou no time"}.`,
    registradoPor: args.registradoPor,
  });
}

// Helper: demissão
export async function registrarDemissao(args: {
  restaurantId: string;
  empregadoId: string;
  empregadoNome: string;
  ultimoDia: string;       // YYYY-MM-DD (último dia trabalhado)
  motivo?: string;
  registradoPor: string;
}): Promise<void> {
  await registrarAutoEvento({
    restaurantId: args.restaurantId,
    empregadoId: args.empregadoId,
    tipo: "demissao",
    data: args.ultimoDia,
    titulo: `Demissão${args.motivo ? ` — ${args.motivo}` : ""}`,
    descricao: `Último dia ativo de ${args.empregadoNome}.`,
    registradoPor: args.registradoPor,
  });
}

// Helper: mudança de cargo
export async function registrarMudancaCargo(args: {
  restaurantId: string;
  empregadoId: string;
  empregadoNome: string;
  cargoAntigo: string;
  cargoNovo: string;
  vigenteApartir: string;
  motivo?: string;
  registradoPor: string;
}): Promise<void> {
  await registrarAutoEvento({
    restaurantId: args.restaurantId,
    empregadoId: args.empregadoId,
    tipo: "mudanca_cargo",
    data: args.vigenteApartir,
    titulo: `${args.cargoAntigo} → ${args.cargoNovo}`,
    descricao: args.motivo
      ? `Mudança de cargo de ${args.empregadoNome}. Motivo: ${args.motivo}`
      : `Mudança de cargo de ${args.empregadoNome}.`,
    registradoPor: args.registradoPor,
  });
}

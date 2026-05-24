// Helpers da coleção /notasCliente — log cronológico de anotações sobre
// clientes, criadas pelo admin durante operação (chegada do cliente,
// observação no CRM, etc).

import { addDoc, collection, deleteDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { NotaCliente } from "../../core/types";

type CriarNotaInput = {
  restaurantId: string;
  clienteId: string;
  reservaId?: string;
  texto: string;
  criadoPor: string;       // pessoaId
  criadoPorNome: string;   // snapshot pra histórico
};

// Cria uma nova nota. Ignora silenciosamente texto vazio (caller pode
// chamar sem checar). Retorna o ID criado.
export async function criarNotaCliente(input: CriarNotaInput): Promise<string | null> {
  const texto = input.texto.trim();
  if (!texto) return null;
  const payload: Omit<NotaCliente, "id"> = {
    restaurantId: input.restaurantId,
    clienteId: input.clienteId,
    reservaId: input.reservaId,
    texto,
    criadoEm: new Date().toISOString(),
    criadoPor: input.criadoPor,
    criadoPorNome: input.criadoPorNome,
  };
  const ref = await addDoc(collection(db, "notasCliente"), sanitizeForFirestore(payload));
  return ref.id;
}

export async function deletarNotaCliente(id: string): Promise<void> {
  await deleteDoc(doc(db, "notasCliente", id));
}

// Filtra notas a partir de uma data (inclusive). Útil pra "últimos 6 meses".
// dataLimite no formato ISO ou YYYY-MM-DD.
export function filtrarNotasDesde(notas: NotaCliente[], dataLimite: string): NotaCliente[] {
  return notas.filter(n => n.criadoEm >= dataLimite);
}

// Ordena por criadoEm desc (mais recentes primeiro) — padrão de exibição
// de logs cronológicos.
export function ordenarNotasDesc(notas: NotaCliente[]): NotaCliente[] {
  return [...notas].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

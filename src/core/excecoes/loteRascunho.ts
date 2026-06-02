// ════════════════════════════════════════════════════════════════════════════
//  Lote de solicitação de ajuste — RASCUNHO persistido.
//
//  Antes era state local da aba (sumia ao recarregar). Agora persiste em
//  /excecoesLoteRascunho/{rid}_{empregadoId} pra o líder poder montar lotes,
//  fechar a aba, e continuar depois — ou montar vários lotes em paralelo e
//  enviar tudo de uma vez.
//
//  O lote é DELETADO quando enviado (presencial/whatsapp) — não é histórico.
//  O histórico fica no status do próprio apontamento (aguardando_ajuste) +
//  nota interna automática.
// ════════════════════════════════════════════════════════════════════════════

import {
  collection, deleteDoc, doc, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";

const COL = "excecoesLoteRascunho";

export type LoteRascunhoDoc = {
  id: string;                  // ${rid}_${empregadoId}
  restaurantId: string;
  empregadoId: string;
  apontamentoChaves: string[]; // formato "${empregadoId}_${date}_${ruleId}"
  atualizadoEm: string;        // ISO
  atualizadoPor: string;       // pessoaId
  atualizadoPorNome?: string;
};

export function loteDocId(rid: string, empregadoId: string): string {
  return `${rid}_${empregadoId}`;
}

export async function salvarLoteRascunho(input: {
  restaurantId: string;
  empregadoId: string;
  apontamentoChaves: string[];
  por: { id: string; nome: string };
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  // Lote vazio → deleta o doc (não polui Firestore com lista vazia)
  if (input.apontamentoChaves.length === 0) {
    try {
      await deleteDoc(doc(db, COL, id));
    } catch {
      // ignora: pode não existir
    }
    return;
  }
  const novo: LoteRascunhoDoc = {
    id,
    restaurantId: input.restaurantId,
    empregadoId: input.empregadoId,
    apontamentoChaves: input.apontamentoChaves,
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: input.por.id,
    atualizadoPorNome: input.por.nome,
  };
  await setDoc(doc(db, COL, id), sanitizeForFirestore(novo));
}

export async function limparLoteRascunho(input: {
  restaurantId: string;
  empregadoId: string;
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  try {
    await deleteDoc(doc(db, COL, id));
  } catch {
    // ignora: pode não existir
  }
}

// Listener real-time pra todos os lotes do restaurante. Custa O(empregados
// com lote aberto) — provavelmente ≤ 20. Não precisa de índice composto
// (1 filtro só: restaurantId).
export function ouvirLotesRascunhoDoRestaurante(
  restaurantId: string,
  cb: (docs: LoteRascunhoDoc[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, COL),
    where("restaurantId", "==", restaurantId),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LoteRascunhoDoc));
  });
}

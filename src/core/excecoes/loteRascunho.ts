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
  arrayRemove, arrayUnion, collection, deleteDoc, doc, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../firebase/config";

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

// Adiciona UMA chave ao lote. Usa arrayUnion atômico do Firestore — múltiplos
// adds concorrentes em qualquer ordem produzem o mesmo array final.
// setDoc com merge:true cria o doc se não existir; senão só faz patch.
export async function adicionarAoLoteRascunhoFirestore(input: {
  restaurantId: string;
  empregadoId: string;
  apontamentoChave: string;
  por: { id: string; nome: string };
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  await setDoc(
    doc(db, COL, id),
    {
      id,
      restaurantId: input.restaurantId,
      empregadoId: input.empregadoId,
      apontamentoChaves: arrayUnion(input.apontamentoChave),
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: input.por.id,
      atualizadoPorNome: input.por.nome,
    },
    { merge: true },
  );
}

// Remove UMA chave do lote — arrayRemove atômico. Se o array ficar vazio,
// o doc continua existindo com apontamentoChaves: [] (UI trata como "sem
// lote"). Pra deletar de vez, usar limparLoteRascunho.
export async function removerDoLoteRascunhoFirestore(input: {
  restaurantId: string;
  empregadoId: string;
  apontamentoChave: string;
  por: { id: string; nome: string };
}): Promise<void> {
  const id = loteDocId(input.restaurantId, input.empregadoId);
  await setDoc(
    doc(db, COL, id),
    {
      apontamentoChaves: arrayRemove(input.apontamentoChave),
      atualizadoEm: new Date().toISOString(),
      atualizadoPor: input.por.id,
      atualizadoPorNome: input.por.nome,
    },
    { merge: true },
  );
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

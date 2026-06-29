// ════════════════════════════════════════════════════════════════════════════
//  Fale com DP — Repository (Firestore)
//
//  Coleção `faleDpMensagens`. Empregado envia pelo Portal; quem tem a
//  permissão portalEmpregado.receberFaleDp recebe na Central de Avisos.
//
//  LGPD: mensagem anônima NÃO grava autorId/autorNome/cargoNome. O remetente
//  não é rastreado — é responsabilidade do app não persistir essa vinculação.
// ════════════════════════════════════════════════════════════════════════════

import {
  collection, doc, onSnapshot, query, where, setDoc, updateDoc,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { FaleDpMensagem, FaleDpCategoria } from "../../core/types";

const COL = "faleDpMensagens";

/** Empregado envia uma mensagem. Quando anônima, identidade é omitida. */
export async function enviarFaleDp(args: {
  restaurantId: string;
  categoria: FaleDpCategoria;
  anonimo: boolean;
  texto: string;
  autorId?: string | null;
  autorNome?: string | null;
  cargoNome?: string | null;
}): Promise<string> {
  const now = new Date().toISOString();
  const id = `fdp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const base: FaleDpMensagem = {
    id,
    restaurantId: args.restaurantId,
    categoria: args.categoria,
    anonimo: args.anonimo,
    texto: args.texto.trim(),
    status: "nova",
    criadoEm: now,
  };
  // Só anexa identidade quando NÃO é anônima.
  if (!args.anonimo) {
    base.autorId = args.autorId ?? null;
    base.autorNome = args.autorNome ?? null;
    base.cargoNome = args.cargoNome ?? null;
  }
  await setDoc(doc(db, COL, id), sanitizeForFirestore(base));
  return id;
}

/** Stream das mensagens NOVAS (não tratadas) de um restaurante. */
export function subscribeFaleDpNovas(
  restaurantId: string,
  onUpdate: (msgs: FaleDpMensagem[]) => void,
): () => void {
  const q = query(
    collection(db, COL),
    where("restaurantId", "==", restaurantId),
    where("status", "==", "nova"),
  );
  return onSnapshot(q, (snap) => {
    onUpdate(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FaleDpMensagem, "id">) })));
  });
}

/** Marca como tratada (some da Central de Avisos). */
export async function tratarFaleDp(
  id: string,
  pessoaId: string,
  pessoaNome: string,
  nota?: string,
): Promise<void> {
  await updateDoc(doc(db, COL, id), sanitizeForFirestore({
    status: "tratada",
    tratadaEm: new Date().toISOString(),
    tratadaPor: pessoaId,
    tratadaPorNome: pessoaNome,
    tratadaNota: nota?.trim() || null,
  }));
}

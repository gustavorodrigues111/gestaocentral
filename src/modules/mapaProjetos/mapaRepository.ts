import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { MapaProjeto } from "../../core/types";

const COL = "mapaProjetos";

// Escuta os projetos do MAPA. Com ownerId → filtra por dono (uso normal, por
// pessoa). Com ownerId=null (master) → todos, pra nada ficar escondido por um
// ownerId inesperado. As rules liberam read auth-only.
export function ouvirMapaProjetos(ownerId: string | null, cb: (l: MapaProjeto[]) => void): Unsubscribe {
  const q = ownerId ? query(collection(db, COL), where("ownerId", "==", ownerId)) : query(collection(db, COL));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MapaProjeto);
    l.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || (a.nome || "").localeCompare(b.nome || ""));
    cb(l);
  }, (err) => { console.error("[MapaProjetos] erro ao ouvir projetos", err); });
}

export async function salvarMapaProjeto(p: MapaProjeto): Promise<void> {
  await setDoc(doc(db, COL, p.id), sanitizeForFirestore({ ...p, atualizadoEm: new Date().toISOString() }), { merge: true });
}

export async function excluirMapaProjeto(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

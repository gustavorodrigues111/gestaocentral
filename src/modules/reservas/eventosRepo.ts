// Eventos especiais de reservas + config da pasta-raiz (conta central).
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { ReservaEvento, ReservaEventoConfig } from "../../core/types";

export function ouvirEventos(rid: string, cb: (l: ReservaEvento[]) => void): Unsubscribe {
  const q = query(collection(db, "reservaEventos"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ReservaEvento).filter((e) => e.ativo !== false);
    l.sort((a, b) => (b.dataInicio || "").localeCompare(a.dataInicio || ""));
    cb(l);
  }, (e) => console.error("[reservas] eventos", e));
}
export async function salvarEvento(e: ReservaEvento): Promise<void> {
  await setDoc(doc(db, "reservaEventos", e.id), sanitizeForFirestore({ ...e, atualizadoEm: new Date().toISOString() }), { merge: true });
}
export async function excluirEvento(id: string): Promise<void> { await deleteDoc(doc(db, "reservaEventos", id)); }

export function ouvirEventoConfig(rid: string, cb: (c: ReservaEventoConfig | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "reservaEventosConfig", rid), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as ReservaEventoConfig) : null);
  }, (e) => console.error("[reservas] eventoConfig", e));
}
export async function salvarEventoConfig(c: ReservaEventoConfig): Promise<void> {
  await setDoc(doc(db, "reservaEventosConfig", c.id), sanitizeForFirestore({ ...c, atualizadoEm: new Date().toISOString() }), { merge: true });
}

// Catálogo global de apps desktop (coleção downloadApps). Só master edita.
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { DownloadApp } from "../../core/types";

export const uid = () => { try { return crypto.randomUUID(); } catch { return "app" + Date.now() + Math.random().toString(36).slice(2); } };

export function ouvirApps(cb: (l: DownloadApp[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, "downloadApps")), (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as DownloadApp);
    l.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
    cb(l);
  }, (e) => console.error("[appsDownload]", e));
}
export async function salvarApp(a: DownloadApp): Promise<void> {
  await setDoc(doc(db, "downloadApps", a.id), sanitizeForFirestore(a), { merge: true });
}
export async function excluirApp(id: string): Promise<void> { await deleteDoc(doc(db, "downloadApps", id)); }

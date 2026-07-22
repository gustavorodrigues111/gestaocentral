// Firestore do Caderno. Estado (feito/pendente) e itens manuais vivem aqui;
// a semente (cadernoSeed) fornece os defaults. Merge: item do Firestore com
// mesmo id sobrepõe o da semente; itens só-Firestore aparecem também.
import { collection, doc, onSnapshot, setDoc, deleteDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { CadernoItem } from "../../core/types";
import { CADERNO_SEED } from "./cadernoSeed";

const COL = "caderno";

export function ouvirCaderno(cb: (m: Record<string, CadernoItem>) => void): Unsubscribe {
  return onSnapshot(collection(db, COL), (s) => {
    const m: Record<string, CadernoItem> = {};
    s.docs.forEach((d) => { m[d.id] = { id: d.id, ...d.data() } as CadernoItem; });
    cb(m);
  }, () => cb({}));
}

// Junta semente + overrides/itens do Firestore.
export function merge(fs: Record<string, CadernoItem>): CadernoItem[] {
  const out: CadernoItem[] = [];
  const vistos = new Set<string>();
  for (const s of CADERNO_SEED) { out.push(fs[s.id] || s); vistos.add(s.id); }
  for (const [id, it] of Object.entries(fs)) if (!vistos.has(id)) out.push(it);
  return out;
}

export async function salvarItem(item: CadernoItem): Promise<void> {
  await setDoc(doc(db, COL, item.id), sanitizeForFirestore(item), { merge: true });
}

export async function toggleStatus(item: CadernoItem): Promise<void> {
  const feito = item.status !== "feito";
  await salvarItem({ ...item, status: feito ? "feito" : "pendente", feitoEm: feito ? new Date().toISOString() : null });
}

export async function excluirItem(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
}

// Leitura de ideias respeitando a privacidade (enforce real vem das rules).
// Como "security rules ≠ filtro", cada listener precisa retornar SÓ o que o
// usuário pode ler — senão a query inteira é negada. Por isso:
//   • master: 1 listener por bloco de empresas (vê tudo) via restaurantId `in`
//   • demais: público POR empresa (== + ==) + "as minhas" (criadoPor ==)
// Depois filtra pra manter só as empresas pedidas e deduplica por id.
import { collection, onSnapshot, query, where, updateDoc, doc, type Query, type DocumentData, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import type { Ideia } from "../../core/types";

const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

export function ouvirIdeiasVisiveis(rids: string[], meId: string, isMaster: boolean, cb: (ideias: Ideia[]) => void): Unsubscribe {
  const uniq = [...new Set(rids.filter(Boolean))];
  if (!uniq.length) { cb([]); return () => {}; }
  const col = collection(db, "ideias");
  const slots: Ideia[][] = [];
  const ridSet = new Set(uniq);
  const emit = () => {
    const m = new Map<string, Ideia>();
    for (const s of slots) for (const it of s || []) if (ridSet.has(it.restaurantId)) m.set(it.id, it);
    cb([...m.values()].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")));
  };
  const subs: Unsubscribe[] = [];
  const add = (q: Query<DocumentData>) => {
    const i = slots.length; slots.push([]);
    subs.push(onSnapshot(q, (snap) => { slots[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Ideia); emit(); }, () => { slots[i] = []; emit(); }));
  };

  if (isMaster) {
    for (const part of chunk(uniq, 30)) add(query(col, where("restaurantId", "in", part)));
  } else {
    for (const rid of uniq) add(query(col, where("restaurantId", "==", rid), where("visibilidade", "==", "publica")));
    if (meId) add(query(col, where("criadoPor", "==", meId))); // as minhas (pública + privada) de qualquer empresa; o emit filtra pelas rids
  }
  return () => subs.forEach((u) => u());
}

// Backfill idempotente: ideias antigas sem `visibilidade` viram "publica" pra
// aparecerem nas queries de público (que filtram por == "publica"). Best-effort.
export async function backfillVisibilidade(ideias: Ideia[]): Promise<void> {
  const legado = ideias.filter((i) => i.visibilidade == null);
  for (const i of legado) {
    try { await updateDoc(doc(db, "ideias", i.id), { visibilidade: "publica" }); } catch { /* rules podem barrar de outro dono; ok */ }
  }
}

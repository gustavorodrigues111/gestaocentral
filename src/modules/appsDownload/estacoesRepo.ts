// Estações do Painel do Salão (coleção estacoesTokens). O doc id É o token
// aleatório — a estação de parede guarda esse código e lê o /api/painel-feed.
// list/escrita só master (regras); a estação nunca grava. Revogar = ativo:false.
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";

export type EstacaoToken = {
  id: string;            // = token (doc id)
  nome: string;          // rótulo da estação (ex.: "Parede do salão")
  restaurantId: string;
  restaurantNome: string;
  ativo: boolean;
  criadoEm: string;
  criadoPor?: string | null;
};

// token aleatório: "est_" + 32 hex (criptograficamente forte quando disponível).
export function gerarToken(): string {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return "est_" + Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return "est_" + Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
  }
}

export function ouvirEstacoes(cb: (l: EstacaoToken[]) => void): Unsubscribe {
  return onSnapshot(collection(db, "estacoesTokens"), (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EstacaoToken);
    l.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    cb(l);
  }, (e) => console.error("[estacoesTokens]", e));
}
export async function criarEstacao(e: EstacaoToken): Promise<void> {
  await setDoc(doc(db, "estacoesTokens", e.id), sanitizeForFirestore(e));
}
export async function toggleEstacao(id: string, ativo: boolean): Promise<void> {
  await updateDoc(doc(db, "estacoesTokens", id), { ativo });
}
export async function excluirEstacao(id: string): Promise<void> { await deleteDoc(doc(db, "estacoesTokens", id)); }

// Repositório do módulo Comandas (PDV simplificado). Coleções:
//  - comandaProdutos : catálogo de produtos (por empresa)
//  - comandas        : comandas abertas/fechadas
//  - comandaPrintJobs: fila de impressão (consumida pela estação de impressão)
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Comanda, ComandaProduto, ComandaPrintJob, ComandaCategoria } from "../../core/types";

export const uid = () => { try { return crypto.randomUUID(); } catch { return "c" + Date.now() + Math.random().toString(36).slice(2); } };

// ── Categorias ─────────────────────────────────────────────────────────
export function ouvirCategorias(rid: string, cb: (l: ComandaCategoria[]) => void): Unsubscribe {
  const q = query(collection(db, "comandaCategorias"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ComandaCategoria);
    l.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
    cb(l);
  }, (e) => console.error("[comandas] categorias", e));
}
export async function salvarCategoria(c: ComandaCategoria): Promise<void> {
  await setDoc(doc(db, "comandaCategorias", c.id), sanitizeForFirestore(c), { merge: true });
}
export async function excluirCategoria(id: string): Promise<void> { await deleteDoc(doc(db, "comandaCategorias", id)); }

// ── Produtos ───────────────────────────────────────────────────────────
export function ouvirProdutos(rid: string, cb: (l: ComandaProduto[]) => void): Unsubscribe {
  const q = query(collection(db, "comandaProdutos"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ComandaProduto);
    l.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
    cb(l);
  }, (e) => console.error("[comandas] produtos", e));
}
export async function salvarProduto(p: ComandaProduto): Promise<void> {
  await setDoc(doc(db, "comandaProdutos", p.id), sanitizeForFirestore(p), { merge: true });
}
export async function excluirProduto(id: string): Promise<void> { await deleteDoc(doc(db, "comandaProdutos", id)); }

// ── Comandas ───────────────────────────────────────────────────────────
// Ouve as ABERTAS (operacional) + as fechadas de hoje (pra fechar o caixa).
export function ouvirComandas(rid: string, cb: (l: Comanda[]) => void): Unsubscribe {
  const q = query(collection(db, "comandas"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Comanda);
    l.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    cb(l);
  }, (e) => console.error("[comandas] comandas", e));
}
export async function salvarComanda(c: Comanda): Promise<void> {
  await setDoc(doc(db, "comandas", c.id), sanitizeForFirestore(c), { merge: true });
}
export async function excluirComanda(id: string): Promise<void> { await deleteDoc(doc(db, "comandas", id)); }

// ── Fila de impressão ──────────────────────────────────────────────────
export async function criarPrintJob(job: ComandaPrintJob): Promise<void> {
  await setDoc(doc(db, "comandaPrintJobs", job.id), sanitizeForFirestore(job));
}
// A estação ouve os jobs do restaurante e filtra os PENDENTES no client
// (evita índice composto), em ordem de chegada.
export function ouvirPrintJobsPendentes(rid: string, cb: (l: ComandaPrintJob[]) => void): Unsubscribe {
  const q = query(collection(db, "comandaPrintJobs"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ComandaPrintJob)
      .filter((j) => j.status === "pendente")
      .sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || ""));
    cb(l);
  }, (e) => console.error("[comandas] printJobs", e));
}
export async function marcarPrintJob(id: string, status: "impresso" | "erro"): Promise<void> {
  await updateDoc(doc(db, "comandaPrintJobs", id), { status, impressoEm: new Date().toISOString() });
}

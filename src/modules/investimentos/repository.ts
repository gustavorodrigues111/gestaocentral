import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { InvestProjeto, InvestCategoria, InvestLancamento, InvestForma, InvestPagador, InvestConfig } from "../../core/types";

// ── Config do módulo por restaurante (doc id = restaurantId) ─────────────────
export function ouvirConfig(rid: string, cb: (c: InvestConfig | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "investConfig", rid), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as InvestConfig) : null);
  }, (e) => console.error("[investimentos] config", e));
}
export async function salvarConfig(c: InvestConfig): Promise<void> {
  await setDoc(doc(db, "investConfig", c.id), sanitizeForFirestore({ ...c, atualizadoEm: new Date().toISOString() }), { merge: true });
}

// ── Projetos (planilhas) por restaurante ────────────────────────────────────
export function ouvirProjetos(rid: string, cb: (l: InvestProjeto[]) => void): Unsubscribe {
  const q = query(collection(db, "investProjetos"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InvestProjeto).filter((p) => p.ativo !== false);
    l.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0) || (a.nome || "").localeCompare(b.nome || ""));
    cb(l);
  }, (e) => console.error("[investimentos] projetos", e));
}
export async function salvarProjeto(p: InvestProjeto): Promise<void> {
  await setDoc(doc(db, "investProjetos", p.id), sanitizeForFirestore({ ...p, atualizadoEm: new Date().toISOString() }), { merge: true });
}
export async function excluirProjeto(id: string): Promise<void> { await deleteDoc(doc(db, "investProjetos", id)); }

// ── Categorias (lista fixa, com sugestão da IA a confirmar) ──────────────────
export function ouvirCategorias(rid: string, cb: (l: InvestCategoria[]) => void): Unsubscribe {
  const q = query(collection(db, "investCategorias"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InvestCategoria);
    l.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    cb(l);
  }, (e) => console.error("[investimentos] categorias", e));
}
export async function salvarCategoria(c: InvestCategoria): Promise<void> {
  await setDoc(doc(db, "investCategorias", c.id), sanitizeForFirestore(c), { merge: true });
}
export async function excluirCategoria(id: string): Promise<void> { await deleteDoc(doc(db, "investCategorias", id)); }

// ── Formas de pagamento custom (além das fixas) ─────────────────────────────
export function ouvirFormas(rid: string, cb: (l: InvestForma[]) => void): Unsubscribe {
  const q = query(collection(db, "investFormas"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InvestForma);
    l.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    cb(l);
  }, (e) => console.error("[investimentos] formas", e));
}
export async function salvarForma(f: InvestForma): Promise<void> {
  await setDoc(doc(db, "investFormas", f.id), sanitizeForFirestore(f), { merge: true });
}
export async function excluirForma(id: string): Promise<void> { await deleteDoc(doc(db, "investFormas", id)); }

// ── Quem pagou (sócios/entidades que desembolsam) ───────────────────────────
export function ouvirPagadores(rid: string, cb: (l: InvestPagador[]) => void): Unsubscribe {
  const q = query(collection(db, "investPagadores"), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InvestPagador);
    l.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    cb(l);
  }, (e) => console.error("[investimentos] pagadores", e));
}
export async function salvarPagador(p: InvestPagador): Promise<void> {
  await setDoc(doc(db, "investPagadores", p.id), sanitizeForFirestore(p), { merge: true });
}
export async function excluirPagador(id: string): Promise<void> { await deleteDoc(doc(db, "investPagadores", id)); }

// ── Lançamentos (linhas) de um projeto ──────────────────────────────────────
export function ouvirLancamentos(rid: string, projetoId: string, cb: (l: InvestLancamento[]) => void): Unsubscribe {
  const q = query(collection(db, "investLancamentos"), where("restaurantId", "==", rid), where("projetoId", "==", projetoId));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InvestLancamento);
    l.sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.criadoEm || "").localeCompare(a.criadoEm || ""));
    cb(l);
  }, (e) => console.error("[investimentos] lancamentos", e));
}
export async function salvarLancamento(l: InvestLancamento): Promise<void> {
  await setDoc(doc(db, "investLancamentos", l.id), sanitizeForFirestore({ ...l, atualizadoEm: new Date().toISOString() }), { merge: true });
}
export async function excluirLancamento(id: string): Promise<void> { await deleteDoc(doc(db, "investLancamentos", id)); }

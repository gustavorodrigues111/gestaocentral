// Repositório do módulo Produção SISP (peixaria). O módulo transita como ESTEIRA
// por status: recebimento → plano → produção (rendimento) → lote disponível → saída.
// Coleções (por restaurante, campo restaurantId); config = doc producaoSispConfig/{rid}.
//   producaoSispEspecies, producaoSispCortes, producaoSispFornecedores,
//   producaoSispRecebimentos, producaoSispPlanos (F1)
//   producaoSispLotes, producaoSispPecas, producaoSispRomaneios (F2/F3)
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  ProducaoSispEspecie, ProducaoSispCorte, ProducaoSispFornecedor,
  ProducaoSispRecebimento, ProducaoSispPlano, ProducaoSispConfig,
} from "../../core/types";

export const uid = () => { try { return crypto.randomUUID(); } catch { return "ps" + Date.now() + Math.random().toString(36).slice(2); } };

function ouvirColecao<T>(coll: string, rid: string, cb: (l: T[]) => void, sort?: (a: T, b: T) => number): Unsubscribe {
  const q = query(collection(db, coll), where("restaurantId", "==", rid));
  return onSnapshot(q, (snap) => {
    const l = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
    if (sort) l.sort(sort);
    cb(l);
  }, (e) => console.error(`[producaoSisp] ${coll}`, e));
}

// ── Espécies ─────────────────────────────────────────────────────────────────
export function ouvirEspecies(rid: string, cb: (l: ProducaoSispEspecie[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispEspecie>("producaoSispEspecies", rid, cb,
    (a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
}
export async function salvarEspecie(e: ProducaoSispEspecie): Promise<void> {
  await setDoc(doc(db, "producaoSispEspecies", e.id), sanitizeForFirestore(e), { merge: true });
}
export async function excluirEspecie(id: string): Promise<void> { await deleteDoc(doc(db, "producaoSispEspecies", id)); }

// ── Cortes / variações ─────────────────────────────────────────────────────────
export function ouvirCortes(rid: string, cb: (l: ProducaoSispCorte[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispCorte>("producaoSispCortes", rid, cb,
    (a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.nome.localeCompare(b.nome));
}
export async function salvarCorte(c: ProducaoSispCorte): Promise<void> {
  await setDoc(doc(db, "producaoSispCortes", c.id), sanitizeForFirestore(c), { merge: true });
}
export async function excluirCorte(id: string): Promise<void> { await deleteDoc(doc(db, "producaoSispCortes", id)); }

// ── Fornecedores ───────────────────────────────────────────────────────────────
export function ouvirFornecedores(rid: string, cb: (l: ProducaoSispFornecedor[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispFornecedor>("producaoSispFornecedores", rid, cb,
    (a, b) => a.nome.localeCompare(b.nome));
}
export async function salvarFornecedor(f: ProducaoSispFornecedor): Promise<void> {
  await setDoc(doc(db, "producaoSispFornecedores", f.id), sanitizeForFirestore(f), { merge: true });
}
export async function excluirFornecedor(id: string): Promise<void> { await deleteDoc(doc(db, "producaoSispFornecedores", id)); }

// ── Recebimentos ─────────────────────────────────────────────────────────────
export function ouvirRecebimentos(rid: string, cb: (l: ProducaoSispRecebimento[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispRecebimento>("producaoSispRecebimentos", rid, cb,
    (a, b) => (b.recebidoEm || "").localeCompare(a.recebidoEm || ""));
}
export async function salvarRecebimento(r: ProducaoSispRecebimento): Promise<void> {
  await setDoc(doc(db, "producaoSispRecebimentos", r.id), sanitizeForFirestore(r), { merge: true });
}
export async function excluirRecebimento(id: string): Promise<void> { await deleteDoc(doc(db, "producaoSispRecebimentos", id)); }

// ── Planos de produção ─────────────────────────────────────────────────────────
export function ouvirPlanos(rid: string, cb: (l: ProducaoSispPlano[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispPlano>("producaoSispPlanos", rid, cb,
    (a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
}
export async function salvarPlano(p: ProducaoSispPlano): Promise<void> {
  await setDoc(doc(db, "producaoSispPlanos", p.id), sanitizeForFirestore(p), { merge: true });
}
export async function excluirPlano(id: string): Promise<void> { await deleteDoc(doc(db, "producaoSispPlanos", id)); }

// ── Config (1 doc por restaurante) ───────────────────────────────────────────
export function ouvirConfig(rid: string, cb: (c: ProducaoSispConfig | null) => void): Unsubscribe {
  return onSnapshot(doc(db, "producaoSispConfig", rid), (snap) => {
    cb(snap.exists() ? ({ ...(snap.data() as ProducaoSispConfig), rid }) : null);
  }, (e) => console.error("[producaoSisp] config", e));
}
export async function salvarConfig(rid: string, cfg: ProducaoSispConfig): Promise<void> {
  await setDoc(doc(db, "producaoSispConfig", rid), sanitizeForFirestore({ ...cfg, rid, atualizadoEm: new Date().toISOString() }), { merge: true });
}

// ── Helpers de domínio ────────────────────────────────────────────────────────

// Peso bruto total de um recebimento (soma das levas), em kg.
export function pesoBrutoRecebimento(r: ProducaoSispRecebimento): number {
  return (r.itens || []).reduce((s, it) => s + (Number(it.pesoBrutoKg) || 0), 0);
}

// Código de lote legível: <PREFIXO>-<AAAAMMDD>-<seq2>. O prefixo vem da config
// (ex.: "PAM") ou das 3 primeiras letras da espécie.
export function gerarCodigoLote(prefixo: string, seq: number, data = new Date()): string {
  const p = (prefixo || "LOT").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "LOT";
  const ymd = `${data.getFullYear()}${String(data.getMonth() + 1).padStart(2, "0")}${String(data.getDate()).padStart(2, "0")}`;
  return `${p}-${ymd}-${String(seq).padStart(2, "0")}`;
}

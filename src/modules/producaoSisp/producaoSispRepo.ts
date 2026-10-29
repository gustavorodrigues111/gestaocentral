// Repositório do módulo Produção SISP (peixaria). O módulo transita como ESTEIRA
// por status: recebimento → plano → produção (rendimento) → lote disponível → saída.
// Coleções (por restaurante, campo restaurantId); config = doc producaoSispConfig/{rid}.
//   producaoSispEspecies, producaoSispCortes, producaoSispFornecedores,
//   producaoSispRecebimentos, producaoSispPlanos (F1)
//   producaoSispLotes, producaoSispPecas, producaoSispRomaneios (F2/F3)
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  ProducaoSispEspecie, ProducaoSispCorte, ProducaoSispFornecedor,
  ProducaoSispRecebimento, ProducaoSispPlano, ProducaoSispConfig,
  ProducaoSispLote, ProducaoSispPeca, ProducaoSispRomaneio,
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

// ── Lotes de produção (nascem ao lançar rendimento — F2) ─────────────────────
export function ouvirLotes(rid: string, cb: (l: ProducaoSispLote[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispLote>("producaoSispLotes", rid, cb,
    (a, b) => (b.fabricacaoEm || "").localeCompare(a.fabricacaoEm || ""));
}
export async function salvarLote(l: ProducaoSispLote): Promise<void> {
  await setDoc(doc(db, "producaoSispLotes", l.id), sanitizeForFirestore(l), { merge: true });
}
export async function excluirLote(id: string): Promise<void> { await deleteDoc(doc(db, "producaoSispLotes", id)); }

// Grava N lotes de uma vez (1 por corte-alvo do plano) + atualiza o plano, atômico.
export async function salvarProducao(lotes: ProducaoSispLote[], plano: ProducaoSispPlano): Promise<void> {
  const batch = writeBatch(db);
  lotes.forEach((l) => batch.set(doc(db, "producaoSispLotes", l.id), sanitizeForFirestore(l), { merge: true }));
  batch.set(doc(db, "producaoSispPlanos", plano.id), sanitizeForFirestore(plano), { merge: true });
  await batch.commit();
}

// ── Peças serializadas (nascem na entrada da loja — F3/W3) ───────────────────
export function ouvirPecas(rid: string, cb: (l: ProducaoSispPeca[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispPeca>("producaoSispPecas", rid, cb,
    (a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
}
// Confere a entrada: cria as peças, dá baixa no saldo do(s) lote(s) e marca o
// romaneio como recebido — tudo numa transação só.
export async function receberNaLoja(pecas: ProducaoSispPeca[], lotes: ProducaoSispLote[], romaneio: ProducaoSispRomaneio): Promise<void> {
  const batch = writeBatch(db);
  pecas.forEach((p) => batch.set(doc(db, "producaoSispPecas", p.id), sanitizeForFirestore(p)));
  lotes.forEach((l) => batch.set(doc(db, "producaoSispLotes", l.id), sanitizeForFirestore(l), { merge: true }));
  batch.set(doc(db, "producaoSispRomaneios", romaneio.id), sanitizeForFirestore(romaneio), { merge: true });
  await batch.commit();
}

// ── Romaneios / expedição (F3) ───────────────────────────────────────────────
export function ouvirRomaneios(rid: string, cb: (l: ProducaoSispRomaneio[]) => void): Unsubscribe {
  return ouvirColecao<ProducaoSispRomaneio>("producaoSispRomaneios", rid, cb,
    (a, b) => (b.expedidoEm || "").localeCompare(a.expedidoEm || ""));
}
// Expede: grava o romaneio + baixa o saldo dos lotes, atômico.
export async function expedir(romaneio: ProducaoSispRomaneio, lotes: ProducaoSispLote[]): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, "producaoSispRomaneios", romaneio.id), sanitizeForFirestore(romaneio), { merge: true });
  lotes.forEach((l) => batch.set(doc(db, "producaoSispLotes", l.id), sanitizeForFirestore(l), { merge: true }));
  await batch.commit();
}

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

// Validade = fabricação + N dias (ISO). null se não houver regra de dias.
export function calcValidadeISO(fabISO: string, dias?: number | null): string | null {
  if (dias == null || !Number.isFinite(dias)) return null;
  const d = new Date(fabISO);
  d.setDate(d.getDate() + Math.round(dias));
  return d.toISOString();
}

// Rendimento % = beneficiado ÷ bruto × 100 (arredondado a 1 casa).
export function rendimentoPct(brutoKg: number, beneficiadoKg: number): number | null {
  if (!brutoKg || brutoKg <= 0) return null;
  return Math.round((beneficiadoKg / brutoKg) * 1000) / 10;
}

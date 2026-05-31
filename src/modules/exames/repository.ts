// Repository do módulo Exames Médicos.
//
// Coleções:
//   /exameTiposConfig/{id}    catálogo por restaurante
//   /examesEmpregado/{id}      instância por empregado × tipo

import {
  collection, doc, getDoc, getDocs, query, where, onSnapshot,
  setDoc, addDoc, deleteDoc,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  ExameTipoConfig, ExameEmpregado, ExameHistoricoItem,
  ExameSubtarefaTemplate,
} from "../../core/types";
import { EXAME_SUBTAREFAS_TEMPLATE_DEFAULT } from "../../core/types";

const COL_TIPOS = "exameTiposConfig";
const COL_EXAMES = "examesEmpregado";

// ─── Tipos (config por restaurante) ────────────────────────────────────

export async function listarTipos(restaurantId: string): Promise<ExameTipoConfig[]> {
  const snap = await getDocs(query(
    collection(db, COL_TIPOS),
    where("restaurantId", "==", restaurantId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExameTipoConfig);
}

export function ouvirTipos(restaurantId: string, cb: (tipos: ExameTipoConfig[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL_TIPOS), where("restaurantId", "==", restaurantId)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExameTipoConfig))
  );
}

export async function salvarTipo(t: ExameTipoConfig): Promise<void> {
  await setDoc(doc(db, COL_TIPOS, t.id), sanitizeForFirestore(t));
}

export async function excluirTipo(id: string): Promise<void> {
  await deleteDoc(doc(db, COL_TIPOS, id));
}

// Helper pra gerar template default com IDs novos.
export function gerarSubtarefasTemplateDefault(): ExameSubtarefaTemplate[] {
  return EXAME_SUBTAREFAS_TEMPLATE_DEFAULT.map(t => ({
    ...t,
    id: Math.random().toString(36).slice(2, 11),
  }));
}

// ─── Exames (instâncias) ───────────────────────────────────────────────

export async function listarExamesDeRest(restaurantId: string, ativosOnly = true): Promise<ExameEmpregado[]> {
  const snap = await getDocs(query(
    collection(db, COL_EXAMES),
    where("restaurantId", "==", restaurantId),
  ));
  let lista = snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExameEmpregado);
  if (ativosOnly) lista = lista.filter(e => e.ativo);
  return lista;
}

export function ouvirExamesDeRest(restaurantId: string, cb: (exames: ExameEmpregado[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL_EXAMES), where("restaurantId", "==", restaurantId)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExameEmpregado))
  );
}

export async function listarExamesDeEmpregado(empregadoId: string): Promise<ExameEmpregado[]> {
  const snap = await getDocs(query(
    collection(db, COL_EXAMES),
    where("empregadoId", "==", empregadoId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as ExameEmpregado);
}

export async function getExame(id: string): Promise<ExameEmpregado | null> {
  const s = await getDoc(doc(db, COL_EXAMES, id));
  return s.exists() ? ({ id: s.id, ...s.data() } as ExameEmpregado) : null;
}

export async function criarExame(e: Omit<ExameEmpregado, "id" | "criadoEm" | "atualizadoEm" | "historico">): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, COL_EXAMES), sanitizeForFirestore({
    ...e,
    historico: [],
    criadoEm: now,
    atualizadoEm: now,
  }));
  return ref.id;
}

export async function atualizarExame(id: string, patch: Partial<ExameEmpregado>): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, COL_EXAMES, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await setDoc(ref, sanitizeForFirestore({
    ...snap.data(),
    ...patch,
    atualizadoEm: now,
  }), { merge: false });
}

// Marca exame como inativo (sem deletar). Usado na cascata de demissão.
export async function desativarExame(id: string, autor: { id: string; nome: string }, motivo?: string): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, COL_EXAMES, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await setDoc(ref, sanitizeForFirestore({
    ...snap.data(),
    ativo: false,
    desativadoEm: now,
    desativadoPor: autor.id,
    desativadoMotivo: motivo,
    atualizadoEm: now,
  }), { merge: false });
}

// Reativa exame (raro — caso de readmissão).
export async function reativarExame(id: string): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, COL_EXAMES, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await setDoc(ref, sanitizeForFirestore({
    ...snap.data(),
    ativo: true,
    desativadoEm: null,
    desativadoPor: null,
    desativadoMotivo: undefined,
    atualizadoEm: now,
  }), { merge: false });
}

// ─── Trigger de baixa ──────────────────────────────────────────────────

export type BaixaInput = {
  exameId: string;
  realizadoEm: string;                   // YYYY-MM-DD
  fornecedor?: string;
  anexoUrl?: string;
  anexoNome?: string;
  observacao?: string;
  autor: { id: string; nome: string };
};

/**
 * Dá baixa num exame: cria entry no histórico, recalcula proximoVencimento
 * (=realizadoEm + periodicidadeDias), zera ultimoCicloGerado pra liberar
 * próxima geração.
 *
 * Retorna a data do próximo vencimento calculado.
 */
export async function darBaixa(input: BaixaInput): Promise<string> {
  const ref = doc(db, COL_EXAMES, input.exameId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Exame não encontrado");
  const exame = snap.data() as ExameEmpregado;

  const item: ExameHistoricoItem = {
    id: Math.random().toString(36).slice(2, 11),
    realizadoEm: input.realizadoEm,
    fornecedor: input.fornecedor,
    anexoUrl: input.anexoUrl,
    anexoNome: input.anexoNome,
    observacao: input.observacao,
    registradoEm: new Date().toISOString(),
    registradoPor: input.autor.id,
    registradoPorNome: input.autor.nome,
  };

  const proximo = addDias(input.realizadoEm, exame.periodicidadeDias);

  await setDoc(ref, sanitizeForFirestore({
    ...exame,
    ultimaRealizacao: input.realizadoEm,
    proximoVencimento: proximo,
    historico: [...(exame.historico || []), item],
    ultimoCicloGerado: undefined,           // libera geração do próximo ciclo
    atualizadoEm: new Date().toISOString(),
  }), { merge: false });

  return proximo;
}

function addDias(yyyymmdd: string, dias: number): string {
  const d = new Date(yyyymmdd + "T00:00:00");
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

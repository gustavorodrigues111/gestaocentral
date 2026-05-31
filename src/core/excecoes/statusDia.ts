// ════════════════════════════════════════════════════════════════════════════
//  Status do dia — workflow de tratamento de inconformidades por dia
//  (empregado × data). Persiste em /excecoesDiaStatus.
//
//  Status possíveis:
//   pendente           — default (não cria doc; dia detectado mas não tratado)
//   ajuste_solicitado  — líder enviou WhatsApp pedindo ajuste no Sólides
//   tratado            — alinhado verbalmente, não precisa do Sólides corrigir
//   corrigido_solides  — detectado por diff (empregado corrigiu lá)
//   reaberto           — voltou pra tratar de novo após ter sido finalizado
//
//  Doc id: {restaurantId}_{empregadoId}_{YYYY-MM-DD}.
//  empregadoId = pessoaId/empregadoId interno do Planejamento (string).
// ════════════════════════════════════════════════════════════════════════════

import {
  collection, doc, getDoc, getDocs, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import type { PontoDiaStatus } from "./types";

export type PontoDiaHistoricoEntry = {
  em: string;             // ISO
  porId: string;          // pessoaId
  porNome?: string;
  de: PontoDiaStatus;
  para: PontoDiaStatus;
  motivo?: string;
};

export type PontoDiaStatusDoc = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  data: string;           // YYYY-MM-DD
  status: PontoDiaStatus;
  atualizadoEm: string;   // ISO
  atualizadoPor: string;  // pessoaId
  atualizadoPorNome?: string;
  observacao?: string;
  historico: PontoDiaHistoricoEntry[];
};

const COL = "excecoesDiaStatus";

export function diaStatusDocId(restaurantId: string, empregadoId: string, data: string): string {
  return `${restaurantId}_${empregadoId}_${data}`;
}

// ─── Leitura ─────────────────────────────────────────────────────────────

export async function carregarStatusDia(
  restaurantId: string,
  empregadoId: string,
  data: string,
): Promise<PontoDiaStatusDoc | null> {
  const id = diaStatusDocId(restaurantId, empregadoId, data);
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) return null;
  return { id, ...snap.data() } as PontoDiaStatusDoc;
}

// Lista todos os status do mês — usado no carregamento da tela.
export async function listarStatusDosMes(
  restaurantId: string,
  ano: number,
  mes: number,
): Promise<PontoDiaStatusDoc[]> {
  const ini = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fim = `${ano}-${String(mes).padStart(2, "0")}-31`;
  const q = query(
    collection(db, COL),
    where("restaurantId", "==", restaurantId),
    where("data", ">=", ini),
    where("data", "<=", fim),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as PontoDiaStatusDoc);
}

// Listener real-time pro mês — re-emite a cada mudança em qualquer dia.
export function ouvirStatusDoMes(
  restaurantId: string,
  ano: number,
  mes: number,
  cb: (docs: PontoDiaStatusDoc[]) => void,
): Unsubscribe {
  const ini = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fim = `${ano}-${String(mes).padStart(2, "0")}-31`;
  const q = query(
    collection(db, COL),
    where("restaurantId", "==", restaurantId),
    where("data", ">=", ini),
    where("data", "<=", fim),
  );
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as PontoDiaStatusDoc));
  });
}

// ─── Escrita ─────────────────────────────────────────────────────────────

export async function setStatusDia(input: {
  restaurantId: string;
  empregadoId: string;
  data: string;
  novoStatus: PontoDiaStatus;
  por: { id: string; nome?: string };
  motivo?: string;
  observacao?: string;
}): Promise<PontoDiaStatusDoc> {
  const id = diaStatusDocId(input.restaurantId, input.empregadoId, input.data);
  const atual = await carregarStatusDia(input.restaurantId, input.empregadoId, input.data);
  const now = new Date().toISOString();
  const entry: PontoDiaHistoricoEntry = {
    em: now,
    porId: input.por.id,
    porNome: input.por.nome,
    de: atual?.status || "pendente",
    para: input.novoStatus,
    motivo: input.motivo,
  };
  const novo: PontoDiaStatusDoc = {
    id,
    restaurantId: input.restaurantId,
    empregadoId: input.empregadoId,
    data: input.data,
    status: input.novoStatus,
    atualizadoEm: now,
    atualizadoPor: input.por.id,
    atualizadoPorNome: input.por.nome,
    observacao: input.observacao ?? atual?.observacao,
    historico: [...(atual?.historico || []), entry],
  };
  await setDoc(doc(db, COL, id), sanitizeForFirestore(novo));
  return novo;
}

// Atalho pra "reabrir" — sempre volta pra "reaberto" (não "pendente"),
// pra preservar histórico.
export async function reabrirDia(input: {
  restaurantId: string;
  empregadoId: string;
  data: string;
  por: { id: string; nome?: string };
  motivo?: string;
}): Promise<PontoDiaStatusDoc> {
  return setStatusDia({ ...input, novoStatus: "reaberto" });
}

// Marca como tratado verbalmente.
export async function marcarTratado(input: {
  restaurantId: string;
  empregadoId: string;
  data: string;
  por: { id: string; nome?: string };
  observacao?: string;
}): Promise<PontoDiaStatusDoc> {
  return setStatusDia({ ...input, novoStatus: "tratado" });
}

// Marca como ajuste solicitado (auto, ao enviar WhatsApp de ajuste).
// Não sobrescreve se já está em "tratado" ou "corrigido_solides".
export async function marcarAjusteSolicitado(input: {
  restaurantId: string;
  empregadoId: string;
  data: string;
  por: { id: string; nome?: string };
}): Promise<PontoDiaStatusDoc | null> {
  const atual = await carregarStatusDia(input.restaurantId, input.empregadoId, input.data);
  if (atual?.status === "tratado" || atual?.status === "corrigido_solides") {
    return atual; // não regrida
  }
  return setStatusDia({ ...input, novoStatus: "ajuste_solicitado" });
}

// Helper pra status "efetivo": olha pelo doc (ou retorna "pendente" default).
export function statusEfetivo(doc: PontoDiaStatusDoc | null | undefined): PontoDiaStatus {
  return doc?.status || "pendente";
}

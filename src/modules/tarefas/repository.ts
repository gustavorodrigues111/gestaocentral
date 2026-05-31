// Repository do Gestor de Tarefas — CRUD básico + helpers de log e soft delete.
// Padrão: Firestore SDK direto, sanitizeForFirestore antes de qualquer write.

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot,
  setDoc, updateDoc, addDoc, deleteDoc,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  Tarefa, TarefaProjeto, TarefaSubprojeto, TarefaStatus, TarefaLogEntry,
  Subtarefa, TarefaComentario,
} from "../../core/types";

const COL_PROJETOS = "tarefaProjetos";
const COL_SUBPROJETOS = "tarefaSubprojetos";
const COL_TAREFAS = "tarefas";

// ─── PROJETOS ─────────────────────────────────────────────────────────────

export async function listarProjetos(): Promise<TarefaProjeto[]> {
  const snap = await getDocs(query(collection(db, COL_PROJETOS), orderBy("ordem")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaProjeto)
    .filter(p => !p.deletadoEm);
}

export function ouvirProjetos(cb: (projetos: TarefaProjeto[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, COL_PROJETOS), orderBy("ordem")), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaProjeto)
      .filter(p => !p.deletadoEm);
    cb(list);
  });
}

export async function salvarProjeto(p: TarefaProjeto): Promise<void> {
  await setDoc(doc(db, COL_PROJETOS, p.id), sanitizeForFirestore(p));
}

// ─── SUBPROJETOS ──────────────────────────────────────────────────────────

export async function listarSubprojetos(projetoId?: string): Promise<TarefaSubprojeto[]> {
  const q = projetoId
    ? query(collection(db, COL_SUBPROJETOS), where("projetoId", "==", projetoId), orderBy("ordem"))
    : query(collection(db, COL_SUBPROJETOS), orderBy("ordem"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaSubprojeto)
    .filter(s => !s.deletadoEm);
}

export function ouvirSubprojetos(cb: (subs: TarefaSubprojeto[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, COL_SUBPROJETOS), orderBy("ordem")), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as TarefaSubprojeto)
      .filter(s => !s.deletadoEm);
    cb(list);
  });
}

export async function salvarSubprojeto(s: TarefaSubprojeto): Promise<void> {
  await setDoc(doc(db, COL_SUBPROJETOS, s.id), sanitizeForFirestore(s));
}

// ─── TAREFAS ──────────────────────────────────────────────────────────────

export function ouvirTarefasDeUsuario(pessoaId: string, cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  // "Minhas Tarefas" = responsável OU co-responsável (queries unidas client-side).
  // Firestore não tem OR composto em queries simples; fazemos 2 listeners.
  const unsubResp = onSnapshot(
    query(collection(db, COL_TAREFAS), where("responsavelId", "==", pessoaId)),
    () => recarregar(),
  );
  const unsubCo = onSnapshot(
    query(collection(db, COL_TAREFAS), where("coResponsaveis", "array-contains", pessoaId)),
    () => recarregar(),
  );

  let respData: Tarefa[] = [];
  let coData: Tarefa[] = [];

  async function recarregar() {
    const [respSnap, coSnap] = await Promise.all([
      getDocs(query(collection(db, COL_TAREFAS), where("responsavelId", "==", pessoaId))),
      getDocs(query(collection(db, COL_TAREFAS), where("coResponsaveis", "array-contains", pessoaId))),
    ]);
    respData = respSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa);
    coData = coSnap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa);
    // Mescla deduplicando por id
    const map = new Map<string, Tarefa>();
    [...respData, ...coData].forEach(t => { if (!t.deletadoEm) map.set(t.id, t); });
    cb(Array.from(map.values()));
  }
  recarregar();

  return () => { unsubResp(); unsubCo(); };
}

export function ouvirTarefasDeProjeto(projetoId: string, cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL_TAREFAS), where("projetoId", "==", projetoId)),
    snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa)
        .filter(t => !t.deletadoEm);
      cb(list);
    },
  );
}

export function ouvirLixeira(cb: (tarefas: Tarefa[]) => void): Unsubscribe {
  return onSnapshot(collection(db, COL_TAREFAS), snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Tarefa)
      .filter(t => !!t.deletadoEm);
    cb(list);
  });
}

export async function getTarefa(id: string): Promise<Tarefa | null> {
  const s = await getDoc(doc(db, COL_TAREFAS, id));
  return s.exists() ? ({ id: s.id, ...s.data() } as Tarefa) : null;
}

export async function criarTarefa(t: Omit<Tarefa, "id" | "criadoEm" | "atualizadoEm">): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, COL_TAREFAS), sanitizeForFirestore({
    ...t,
    criadoEm: now,
    atualizadoEm: now,
    log: [
      {
        id: cryptoId(),
        acao: "criada" as const,
        autorId: t.criadoPor,
        autorNome: t.criadoPorNome || "—",
        em: now,
      },
    ],
  }));
  return ref.id;
}

export async function atualizarTarefa(id: string, patch: Partial<Tarefa>, autor: { id: string; nome: string }, logEntry?: Partial<TarefaLogEntry>): Promise<void> {
  const now = new Date().toISOString();
  const ref = doc(db, COL_TAREFAS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  const newLog: TarefaLogEntry[] = [
    ...(atual.log || []),
    ...(logEntry
      ? [{
          id: cryptoId(),
          acao: (logEntry.acao || "editada") as TarefaLogEntry["acao"],
          detalhe: logEntry.detalhe,
          campo: logEntry.campo,
          valorAntes: logEntry.valorAntes,
          valorDepois: logEntry.valorDepois,
          autorId: autor.id,
          autorNome: autor.nome,
          em: now,
        }]
      : []),
  ];
  await updateDoc(ref, sanitizeForFirestore({
    ...patch,
    atualizadoEm: now,
    log: newLog,
  } as Partial<Tarefa>));
}

export async function mudarStatus(id: string, status: TarefaStatus, autor: { id: string; nome: string }): Promise<void> {
  const ref = doc(db, COL_TAREFAS, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  if (atual.status === status) return;
  await atualizarTarefa(id, { status }, autor, {
    acao: "status_mudou",
    campo: "status",
    valorAntes: atual.status,
    valorDepois: status,
  });
}

export async function marcarSubtarefa(tarefaId: string, subId: string, feito: boolean, autor: { id: string; nome: string }): Promise<void> {
  const ref = doc(db, COL_TAREFAS, tarefaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  const subs = (atual.subtarefas || []).map<Subtarefa>(s =>
    s.id === subId
      ? { ...s, feito, feitoEm: feito ? new Date().toISOString() : null, feitoPor: feito ? autor.id : null, feitoPorNome: feito ? autor.nome : null }
      : s
  );
  await atualizarTarefa(tarefaId, { subtarefas: subs }, autor, {
    acao: feito ? "subtarefa_marcada" : "subtarefa_desmarcada",
    detalhe: subs.find(s => s.id === subId)?.texto,
  });
}

export async function adicionarComentario(tarefaId: string, texto: string, autor: { id: string; nome: string }): Promise<void> {
  const ref = doc(db, COL_TAREFAS, tarefaId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const atual = snap.data() as Tarefa;
  const novo: TarefaComentario = {
    id: cryptoId(),
    texto,
    autorId: autor.id,
    autorNome: autor.nome,
    criadoEm: new Date().toISOString(),
  };
  await atualizarTarefa(tarefaId, {
    comentarios: [...(atual.comentarios || []), novo],
  }, autor, { acao: "comentario_adicionado", detalhe: texto.slice(0, 80) });
}

// Soft delete — vai pra lixeira.
export async function softDeleteTarefa(id: string, autor: { id: string; nome: string }, motivo?: string): Promise<void> {
  await atualizarTarefa(id, {
    deletadoEm: new Date().toISOString(),
    deletadoPor: autor.id,
    motivoDelete: motivo,
  }, autor, { acao: "deletada", detalhe: motivo });
}

export async function restaurarTarefa(id: string, autor: { id: string; nome: string }): Promise<void> {
  await atualizarTarefa(id, {
    deletadoEm: null,
    deletadoPor: null,
    motivoDelete: undefined,
  }, autor, { acao: "restaurada" });
}

// Hard delete — só master.
export async function hardDeleteTarefa(id: string): Promise<void> {
  await deleteDoc(doc(db, COL_TAREFAS, id));
}

// ─── helpers ──────────────────────────────────────────────────────────────

function cryptoId(): string {
  // ID curto pra subtarefa/comentário/log — não precisa de garantias globais.
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4);
}

export { cryptoId };

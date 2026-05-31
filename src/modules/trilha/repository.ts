// Repository da Trilha do Empregado.
//
// Coleções:
//   /trilhaEventos/{id}          — eventos cronológicos
//   /trilhaVisualizacaoLog/{id}  — LGPD: log de quem viu o quê e quando
//
// Eventos NÃO são deletados — usa-se anulação (campo `anulado: true`).
// Visualização é sempre auditada (registrarVisualizacao).

import {
  collection, doc, getDoc, getDocs, query, where, orderBy, onSnapshot,
  setDoc, addDoc, updateDoc,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  EventoTrilha, EventoTrilhaTipo, TrilhaVisualizacaoLog,
} from "../../core/types";

const COL = "eventosTrilha";
const COL_LOG = "trilhaVisualizacaoLog";

// ─── Listagem ─────────────────────────────────────────────────────────

export function ouvirEventosDeRest(
  restaurantId: string,
  cb: (eventos: EventoTrilha[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, COL), where("restaurantId", "==", restaurantId)),
    snap => {
      const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }) as EventoTrilha);
      // Ordena desc por data + registradoEm
      lista.sort((a, b) => {
        const c = b.data.localeCompare(a.data);
        if (c !== 0) return c;
        return (b.registradoEm || "").localeCompare(a.registradoEm || "");
      });
      cb(lista);
    },
  );
}

export async function listarEventosDeEmpregado(empregadoId: string): Promise<EventoTrilha[]> {
  const snap = await getDocs(query(collection(db, COL), where("empregadoId", "==", empregadoId)));
  const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }) as EventoTrilha);
  lista.sort((a, b) => {
    const c = b.data.localeCompare(a.data);
    if (c !== 0) return c;
    return (b.registradoEm || "").localeCompare(a.registradoEm || "");
  });
  return lista;
}

// ─── Criação ──────────────────────────────────────────────────────────

export type RegistrarEventoInput = {
  restaurantId: string;
  empregadoId: string;
  empregadoNomeSnapshot?: string;
  tipo: EventoTrilhaTipo;
  data: string;                       // YYYY-MM-DD
  titulo: string;
  descricao?: string;
  anexoUrl?: string;
  anexoNome?: string;
  metadados?: Record<string, unknown>;
  fonte: "auto" | "manual";
  refOrigem?: string;
  registradoPor: { id: string; nome: string };
};

export async function registrarEvento(input: RegistrarEventoInput): Promise<string> {
  // Idempotência pra eventos auto-gerados: se refOrigem + tipo já existem,
  // não duplica.
  if (input.fonte === "auto" && input.refOrigem) {
    const existSnap = await getDocs(query(
      collection(db, COL),
      where("refOrigem", "==", input.refOrigem),
      where("tipo", "==", input.tipo),
      where("empregadoId", "==", input.empregadoId),
    ));
    if (!existSnap.empty) return existSnap.docs[0].id;
  }

  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, COL), sanitizeForFirestore({
    restaurantId: input.restaurantId,
    empregadoId: input.empregadoId,
    empregadoNomeSnapshot: input.empregadoNomeSnapshot,
    tipo: input.tipo,
    data: input.data,
    titulo: input.titulo,
    descricao: input.descricao,
    anexoUrl: input.anexoUrl,
    anexoNome: input.anexoNome,
    metadados: input.metadados,
    fonte: input.fonte,
    refOrigem: input.refOrigem,
    registradoEm: now,
    registradoPor: input.registradoPor.id,
    registradoPorNome: input.registradoPor.nome,
  }));
  return ref.id;
}

// ─── Edição ───────────────────────────────────────────────────────────

export async function editarEvento(
  id: string,
  patch: Partial<EventoTrilha>,
): Promise<void> {
  await updateDoc(doc(db, COL, id), sanitizeForFirestore(patch));
}

// ─── Anulação (em vez de hard delete) ────────────────────────────────

export async function anularEvento(
  id: string,
  motivo: string,
  por: { id: string; nome: string },
): Promise<void> {
  if (!motivo.trim()) throw new Error("Motivo da anulação é obrigatório");
  await updateDoc(doc(db, COL, id), sanitizeForFirestore({
    anulado: true,
    anuladoEm: new Date().toISOString(),
    anuladoPor: por.id,
    anuladoPorNome: por.nome,
    motivoAnulacao: motivo,
  }));
}

export async function desanularEvento(id: string): Promise<void> {
  await updateDoc(doc(db, COL, id), sanitizeForFirestore({
    anulado: false,
    anuladoEm: null,
    anuladoPor: null,
    anuladoPorNome: null,
    motivoAnulacao: null,
  }));
}

// ─── Auditoria de visualização (LGPD) ────────────────────────────────

export async function registrarVisualizacao(
  input: Omit<TrilhaVisualizacaoLog, "id" | "visualizadoEm">,
): Promise<void> {
  await addDoc(collection(db, COL_LOG), sanitizeForFirestore({
    ...input,
    visualizadoEm: new Date().toISOString(),
  }));
}

export async function listarVisualizacoesDoEmpregado(empregadoId: string): Promise<TrilhaVisualizacaoLog[]> {
  const snap = await getDocs(query(
    collection(db, COL_LOG),
    where("empregadoId", "==", empregadoId),
    orderBy("visualizadoEm", "desc"),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }) as TrilhaVisualizacaoLog);
}

void getDoc; void setDoc;

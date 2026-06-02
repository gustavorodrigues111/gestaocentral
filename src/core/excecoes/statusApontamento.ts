// ════════════════════════════════════════════════════════════════════════════
//  Status do APONTAMENTO individual (empregado × data × ruleId).
//
//  Persiste em /excecoesApontamentoStatus/{rid}_{empId}_{date}_{ruleId}.
//  Default = "aberto" (não cria doc — derivado por ausência).
//
//  Substitui a noção "status do dia inteiro" pra dar granularidade: cada
//  inconformidade detectada no dia tem sua própria cadeia de status, e o dia
//  só fica "tudo tratado" quando TODOS os apontamentos do dia estão em
//  estado terminal.
// ════════════════════════════════════════════════════════════════════════════

import {
  collection, doc, onSnapshot, query, setDoc, where,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import type { PontoApontamentoStatus } from "./types";

const COL = "excecoesApontamentoStatus";

export type PontoApontamentoStatusDoc = {
  id: string;
  restaurantId: string;
  empregadoId: string;
  data: string;          // YYYY-MM-DD
  ruleId: string;
  status: PontoApontamentoStatus;
  observacao?: string;
  atualizadoEm: string;
  atualizadoPor: string;
  atualizadoPorNome?: string;
};

export function apontamentoDocId(rid: string, empId: string, date: string, ruleId: string): string {
  return `${rid}_${empId}_${date}_${ruleId}`;
}

export async function setStatusApontamento(input: {
  restaurantId: string;
  empregadoId: string;
  data: string;
  ruleId: string;
  novoStatus: PontoApontamentoStatus;
  por: { id: string; nome: string };
  observacao?: string;
}): Promise<PontoApontamentoStatusDoc> {
  const id = apontamentoDocId(input.restaurantId, input.empregadoId, input.data, input.ruleId);
  const novo: PontoApontamentoStatusDoc = {
    id,
    restaurantId: input.restaurantId,
    empregadoId: input.empregadoId,
    data: input.data,
    ruleId: input.ruleId,
    status: input.novoStatus,
    ...(input.observacao ? { observacao: input.observacao } : {}),
    atualizadoEm: new Date().toISOString(),
    atualizadoPor: input.por.id,
    atualizadoPorNome: input.por.nome,
  };
  await setDoc(doc(db, COL, id), sanitizeForFirestore(novo));
  return novo;
}

// Listener real-time pro mês inteiro.
export function ouvirStatusApontamentoDoMes(
  restaurantId: string,
  ano: number,
  mes: number,
  cb: (docs: PontoApontamentoStatusDoc[]) => void,
): Unsubscribe {
  const inicio = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fim = `${ano}-${String(mes).padStart(2, "0")}-31`;
  const q = query(
    collection(db, COL),
    where("restaurantId", "==", restaurantId),
    where("data", ">=", inicio),
    where("data", "<=", fim),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as PontoApontamentoStatusDoc));
  });
}

// Chave estável usada pelos mapas de UI/derivação.
export function apontamentoKey(empId: string, date: string, ruleId: string): string {
  return `${empId}_${date}_${ruleId}`;
}

// Status terminais — não-pendentes. Default "aberto" = pendente.
// IMPORTANTE: "aguardando_ajuste" NÃO é terminal — o apontamento continua
// pendente (o empregado ainda tem que agir, ajustando na Sólides). Só vira
// terminal quando o report seguinte detectar que sumiu (auto-virou
// "corrigido_solides") ou se o líder voltar manualmente.
export function isStatusTerminal(s: PontoApontamentoStatus | undefined | null): boolean {
  return s === "ciencia" || s === "nao_e_inconformidade" || s === "corrigido_solides";
}

// Apontamento "ativo": ainda precisa de ação OU está esperando empregado.
// Inclui aberto + aguardando_ajuste. Útil pra mostrar contadores.
export function isStatusPendente(s: PontoApontamentoStatus | undefined | null): boolean {
  return !s || s === "aberto" || s === "aguardando_ajuste";
}

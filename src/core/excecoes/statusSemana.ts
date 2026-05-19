// ════════════════════════════════════════════════════════════════════════════
//  Status da semana — workflow líder → gerente. Persiste em /excecoesStatusSemana.
// ════════════════════════════════════════════════════════════════════════════

import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { db } from "../firebase/config";
import type {
  ExcecaoHistoricoEntry, ExcecaoStatusSemana, ExcecaoStatusValor, Pessoa,
} from "../types";

export function statusDocId(restaurantId: string, weekStart: string): string {
  return `${restaurantId}_${weekStart}`;
}

export async function carregarStatusSemana(
  restaurantId: string,
  weekStart: string,
): Promise<ExcecaoStatusSemana | null> {
  const id = statusDocId(restaurantId, weekStart);
  const snap = await getDoc(doc(db, "excecoesStatusSemana", id));
  if (!snap.exists()) return null;
  return { id, ...snap.data() } as ExcecaoStatusSemana;
}

// Lista todas as semanas do restaurante com status registrado. Usado pela
// aba "Ajustes de escala".
export async function listarStatusDoRestaurante(
  restaurantId: string,
): Promise<ExcecaoStatusSemana[]> {
  const q = query(
    collection(db, "excecoesStatusSemana"),
    where("restaurantId", "==", restaurantId),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExcecaoStatusSemana));
}

// Valida se a pessoa pode aplicar a transição de status, considerando o
// estado ATUAL (pra permitir reverter respeitando hierarquia):
//   - `ver` (líder)        → pode marcar/reverter entre aberto/em_tratamento/
//                            tratado_lider, MAS não mexe se já tá
//                            conferido_gerente
//   - `configurar` (gerente) → mesmas regras do líder + pode marcar
//                              conferido_gerente E reverter a conferência
//   - master               → tudo
export function podeMarcarStatus(
  pessoa: Pessoa | null,
  restaurantId: string,
  novoStatus: ExcecaoStatusValor,
  statusAtual?: ExcecaoStatusValor,
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  const p = pessoa.permissions?.[restaurantId]?.excecoes;
  if (!p) return false;
  const podeOperar = p.ver === true || p.configurar === true; // líder OU gerente
  const podeConferir = p.configurar === true;                  // só gerente

  // Se a semana já foi conferida, só gerente pode mexer (descer pra tratado_lider).
  if (statusAtual === "conferido_gerente") {
    return podeConferir;
  }

  // Marcar conferida: só gerente
  if (novoStatus === "conferido_gerente") return podeConferir;

  // Restante (aberto/em_tratamento/tratado_lider): qualquer um com ver/configurar
  return podeOperar;
}

export async function marcarStatus(
  restaurantId: string,
  weekStart: string,
  weekEnd: string,
  novoStatus: ExcecaoStatusValor,
  pessoa: Pessoa,
  observacao?: string,
): Promise<ExcecaoStatusSemana> {
  const id = statusDocId(restaurantId, weekStart);
  const existing = await carregarStatusSemana(restaurantId, weekStart);
  const now = new Date().toISOString();
  const entry: ExcecaoHistoricoEntry = {
    status: novoStatus,
    em: now,
    por: pessoa.id,
    porNome: pessoa.nome,
    ...(observacao ? { observacao } : {}),
  };
  const next: ExcecaoStatusSemana = {
    id,
    restaurantId,
    weekStart,
    weekEnd,
    status: novoStatus,
    historico: [...(existing?.historico || []), entry],
    updatedAt: now,
  };
  await setDoc(doc(db, "excecoesStatusSemana", id), next);
  return next;
}

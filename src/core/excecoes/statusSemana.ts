// ════════════════════════════════════════════════════════════════════════════
//  Status da semana — workflow líder → gerente. Persiste em /excecoesStatusSemana.
// ════════════════════════════════════════════════════════════════════════════

import { doc, getDoc, setDoc } from "firebase/firestore";
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

// Valida se a pessoa pode aplicar a transição de status.
//   - `ver`        → pode marcar em_tratamento e tratado_lider
//   - `configurar` → pode marcar conferido_gerente (e tudo abaixo)
//   - master       → tudo
export function podeMarcarStatus(
  pessoa: Pessoa | null,
  restaurantId: string,
  novoStatus: ExcecaoStatusValor,
): boolean {
  if (!pessoa) return false;
  if (pessoa.isMaster) return true;
  const p = pessoa.permissions?.[restaurantId]?.excecoes;
  if (!p) return false;
  if (novoStatus === "conferido_gerente") return p.configurar === true;
  // em_tratamento e tratado_lider: precisa pelo menos de `ver` (configurar implica ver)
  return p.ver === true || p.configurar === true;
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

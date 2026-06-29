// ════════════════════════════════════════════════════════════════════════════
// Publicação de Gorjetas — congela snapshot da divisão
// ════════════════════════════════════════════════════════════════════════════
//
// Publicar uma gorjeta = afirmar "a escala desse dia tá conferida, congela a
// divisão". A partir daí:
//   - O empregado vê a divisão na sua tela
//   - Edições posteriores na escala NÃO recalculam (snapshot intocado)
//   - Pra forçar recálculo, despublica + publica de novo
//
// Implementação: ao publicar, roda calcularDivisaoDia (lê status efetivo da
// escala) e grava o resultado em gorjeta.divisaoSnapshot + flags.
// Ao despublicar, apaga snapshot + flags.

import { doc, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  Cargo, Empregado, EscalaMes, Gorjeta, SplitVersion, Unidade,
} from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import { getActiveSplitVersion } from "./splitRules";

export type PublicarParams = {
  gorjeta: Gorjeta;
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  unidades: Unidade[];
  publicadoPorId: string;
  publicadoPorNome: string;
};

export async function publicarGorjeta(p: PublicarParams): Promise<void> {
  const { gorjeta, empregados, cargos, escala, splitVersions, unidades } = p;
  const sv = getActiveSplitVersion(splitVersions, gorjeta.date);
  // Sem regra de divisão → nem dá pra publicar com integridade
  if (!sv) {
    throw new Error(
      `Não há regra de divisão vigente em ${gorjeta.date}. Cadastre uma regra ` +
      `antes de publicar.`
    );
  }
  const liquido = calcularValorLiquido(gorjeta.valorBruto, sv.taxRate);
  const result = calcularDivisaoDia(
    gorjeta.date,
    liquido,
    empregados,
    cargos,
    escala,
    sv,
    gorjeta.unidadeId || null,
    unidades,
  );
  const now = new Date().toISOString();
  await updateDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
    publicada: true,
    publicadaEm: now,
    publicadaPor: p.publicadoPorId,
    publicadaPorNome: p.publicadoPorNome,
    divisaoSnapshot: result.itens,
    // Atualiza taxRate/valorLiquido snapshot também (refletem o que o cálculo usou)
    taxRate: sv.taxRate,
    valorLiquido: liquido,
    updatedAt: now,
  }));
}

// Recalcula APENAS o divisaoSnapshot de uma gorjeta já publicada, sem mexer
// nos metadados de publicação (publicadaEm/Por). Útil pra propagar uma
// melhoria de algoritmo (ex: distribuição do resto centavo a centavo) sobre
// snapshots antigos sem reescrever o histórico de quem publicou e quando.
export async function recalcularSnapshotGorjeta(p: PublicarParams): Promise<void> {
  const { gorjeta, empregados, cargos, escala, splitVersions, unidades } = p;
  if (!gorjeta.publicada) {
    throw new Error("Gorjeta não publicada — use publicarGorjeta.");
  }
  const sv = getActiveSplitVersion(splitVersions, gorjeta.date);
  if (!sv) {
    throw new Error(
      `Não há regra de divisão vigente em ${gorjeta.date}. Cadastre uma regra ` +
      `antes de recalcular.`,
    );
  }
  const liquido = calcularValorLiquido(gorjeta.valorBruto, sv.taxRate);
  const result = calcularDivisaoDia(
    gorjeta.date,
    liquido,
    empregados,
    cargos,
    escala,
    sv,
    gorjeta.unidadeId || null,
    unidades,
  );
  await updateDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
    divisaoSnapshot: result.itens,
    taxRate: sv.taxRate,
    valorLiquido: liquido,
    updatedAt: new Date().toISOString(),
  }));
}

export async function despublicarGorjeta(gorjeta: Gorjeta): Promise<void> {
  const now = new Date().toISOString();
  await updateDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
    publicada: false,
    publicadaEm: null,
    publicadaPor: null,
    publicadaPorNome: null,
    // Despublicar também desfaz o pagamento (não pode estar "paga" sem snapshot).
    paga: false,
    pagaEm: null,
    pagaPor: null,
    pagaPorNome: null,
    // Apaga o snapshot pra próxima publicação recalcular
    divisaoSnapshot: null,
    updatedAt: now,
  }));
}

// Marca a gorjeta como PAGA. Se ainda não estava publicada, publica antes
// (congela o snapshot da divisão) — não dá pra pagar sem a divisão fechada.
export async function pagarGorjeta(p: PublicarParams): Promise<void> {
  if (!p.gorjeta.publicada) await publicarGorjeta(p);
  const now = new Date().toISOString();
  await updateDoc(doc(db, "gorjetas", p.gorjeta.id), sanitizeForFirestore({
    paga: true, pagaEm: now, pagaPor: p.publicadoPorId, pagaPorNome: p.publicadoPorNome, updatedAt: now,
  }));
}

// Desfaz o pagamento (continua publicada).
export async function desmarcarPagaGorjeta(gorjeta: Gorjeta): Promise<void> {
  await updateDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
    paga: false, pagaEm: null, pagaPor: null, pagaPorNome: null, updatedAt: new Date().toISOString(),
  }));
}

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

import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type {
  Area, Cargo, DivisaoItem, Empregado, EscalaMes, FreelaShift, Gorjeta, SplitVersion, Unidade,
} from "../../core/types";
import { calcularDivisaoDia, calcularValorLiquido } from "./calc";
import { calcularDesconto, reducaoDiaArea, reduzirItensDia, type GorjetaDesconto } from "./descontos";
import { getActiveSplitVersion } from "./splitRules";

export type PublicarParams = {
  gorjeta: Gorjeta;
  empregados: Empregado[];
  cargos: Cargo[];
  escala: EscalaMes | null;
  splitVersions: SplitVersion[];
  unidades: Unidade[];
  // Turnos de freela — os marcados com gorjetaCargoId que trabalharam nesse
  // dia entram na divisão (e ficam CONGELADOS no snapshot ao publicar).
  freelaShifts?: FreelaShift[];
  publicadoPorId: string;
  publicadoPorNome: string;
};

// Freelas de UM dia que entram na gorjeta (têm gorjetaCargoId + trabalharam).
// Mesma regra do DivisaoMesTab, centralizada aqui pra publicação/recálculo
// congelarem o freela no snapshot exatamente como a tela mostra.
function freelasDoDia(
  freelaShifts: FreelaShift[] | undefined,
  cargos: Cargo[],
  date: string,
  unidadeId: string | null,
  unidades: Unidade[],
): { id: string; nome: string; cargoId: string; pontos: number; area: Area }[] {
  const cargoById: Record<string, Cargo> = Object.fromEntries(cargos.map((c) => [c.id, c]));
  // Unidades de atendimento ATIVAS (não encerradas). Um freela tagueado numa
  // unidade que não é mais ativa (ex.: Porto Futuro encerrado) é "defasado" e
  // dobra na unidade sendo publicada — senão sumiria da divisão.
  const atendAtivas = new Set(
    unidades.filter((u) => u.tipo === "atendimento" && u.ativa && !u.encerradaEm).map((u) => u.id),
  );
  return (freelaShifts || [])
    // Entra se: SEM unidade; OU unidade == a que está sendo calculada; OU a
    // unidade dele não é mais atendimento-ativa (defasada/encerrada → dobra aqui).
    .filter((f) => f.date === date && f.gorjetaCargoId && f.status !== "cancelado" && f.status !== "nao_compareceu"
      && (!unidadeId || !f.unidadeId || (f.unidadeId || null) === unidadeId || !atendAtivas.has(f.unidadeId)))
    .map((f) => {
      const c = cargoById[f.gorjetaCargoId as string];
      return { id: f.id, nome: f.nomeSnapshot, cargoId: f.gorjetaCargoId as string, pontos: c?.pontos || 0, area: (c?.area || f.area || "Salão") as Area };
    })
    .filter((f) => f.pontos > 0);
}

// Aplica o DESCONTO DO DIA (% dos freelas) sobre os itens da divisão ANTES de
// congelar o snapshot — exatamente como o DivisaoMesTab faz na tela do admin.
//
// A ORDEM da divisão é: (1) retém o % legal (taxRate) → líquido; (2) tira a
// cota dos freelas (este passo); (3) rateia entre os CLT. O `calcularDivisaoDia`
// já faz (1) e (3). Este passo (2) faltava ser congelado no snapshot — por isso
// o empregado via o valor PRÉ-desconto (inflado) enquanto o admin via o
// PÓS-desconto. Agora o snapshot = admin = folha.
//
// Carrega os descontos da competência direto do Firestore pra garantir que o
// snapshot sempre inclua o desconto, independente de quem chamou a publicação.
async function aplicarDescontoFreelaDia(
  gorjeta: Gorjeta,
  cargos: Cargo[],
  freelaShifts: FreelaShift[] | undefined,
  itens: DivisaoItem[],
): Promise<{ itens: DivisaoItem[]; aplicadoPorArea: Record<string, number> }> {
  const competencia = gorjeta.date.slice(0, 7); // YYYY-MM
  const snap = await getDocs(query(
    collection(db, "gorjetaDescontos"),
    where("restaurantId", "==", gorjeta.restaurantId),
    where("competencia", "==", competencia),
  ));
  if (snap.empty) return { itens, aplicadoPorArea: {} };
  const descontos = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GorjetaDesconto));
  const cargoById: Record<string, Cargo> = Object.fromEntries(cargos.map((c) => [c.id, c]));
  const descontosCalc = descontos
    .map((d) => calcularDesconto(d, freelaShifts || [], cargoById))
    .filter((dc) => dc.valor > 0);
  const reducaoDia = reducaoDiaArea(descontosCalc);
  if (reducaoDia.size === 0) return { itens, aplicadoPorArea: {} };
  return reduzirItensDia(itens, gorjeta.date, reducaoDia);
}

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
    freelasDoDia(p.freelaShifts, cargos, gorjeta.date, gorjeta.unidadeId || null, unidades),
  );
  const { itens: itensSnapshot, aplicadoPorArea } = await aplicarDescontoFreelaDia(gorjeta, cargos, p.freelaShifts, result.itens);
  const now = new Date().toISOString();
  await updateDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
    publicada: true,
    publicadaEm: now,
    publicadaPor: p.publicadoPorId,
    publicadaPorNome: p.publicadoPorNome,
    divisaoSnapshot: itensSnapshot,
    // Desconto do dia (% dos freelas) JÁ aplicado no snapshot acima. O flag
    // avisa o admin/comparação pra NÃO reaplicar (senão descontaria 2×);
    // snapshots antigos sem o flag seguem recebendo o desconto ao vivo na tela.
    snapshotComDesconto: true,
    descontoFreelaSnapshot: aplicadoPorArea,
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
    freelasDoDia(p.freelaShifts, cargos, gorjeta.date, gorjeta.unidadeId || null, unidades),
  );
  const { itens: itensSnapshot, aplicadoPorArea } = await aplicarDescontoFreelaDia(gorjeta, cargos, p.freelaShifts, result.itens);
  const now = new Date().toISOString();
  await updateDoc(doc(db, "gorjetas", gorjeta.id), sanitizeForFirestore({
    divisaoSnapshot: itensSnapshot,
    snapshotComDesconto: true,
    descontoFreelaSnapshot: aplicadoPorArea,
    taxRate: sv.taxRate,
    valorLiquido: liquido,
    // Marca QUANDO o snapshot foi recalculado — a detecção de "escala mudou
    // após a divisão" compara contra isto (e não só contra publicadaEm, que é
    // preservado). Sem isto, o banner nunca somia depois do recálculo.
    divisaoRecalculadaEm: now,
    updatedAt: now,
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
    snapshotComDesconto: null,
    descontoFreelaSnapshot: null,
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

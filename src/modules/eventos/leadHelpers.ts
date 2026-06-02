// Helpers genéricos pra LeadEvento. Hoje só o fluxo de fechamento; futuro
// pode receber outras transições (sinal_recebido com pagamento etc).

import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { LeadEvento, PropostaEvento } from "../../core/types";

/**
 * Grava o objeto `fechamento` no lead e move status pra "realizado".
 * Idempotente — chamar de novo só sobrescreve os campos. NÃO valida regra
 * de negócio aqui (o modal já valida campos obrigatórios).
 */
export async function fecharEvento(
  leadId: string,
  fechamento: NonNullable<LeadEvento["fechamento"]>,
): Promise<void> {
  await updateDoc(
    doc(db, "leadsEvento", leadId),
    sanitizeForFirestore({
      status: "realizado",
      fechamento,
      updatedAt: new Date().toISOString(),
    }),
  );
}

/**
 * Busca a proposta de MAIOR versao do lead — usada pra pré-preencher o
 * faturamento bruto sugerido no modal de fechamento. Retorna 0 se o lead
 * não tem proposta (vendeu sem proposta formal, lead manual, etc).
 */
export async function precoUltimaProposta(leadId: string): Promise<number> {
  const q = query(collection(db, "propostasEvento"), where("leadId", "==", leadId));
  const snap = await getDocs(q);
  if (snap.empty) return 0;
  const props = snap.docs.map(d => d.data() as PropostaEvento);
  props.sort((a, b) => (b.versao || 0) - (a.versao || 0));
  return props[0]?.precoTotal || 0;
}

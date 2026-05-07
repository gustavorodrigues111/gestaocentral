// ════════════════════════════════════════════════════════════════════════════
// Mudança versionada com data de vigência + audit log + agendamento futuro
// ════════════════════════════════════════════════════════════════════════════
//
// Toda mudança crítica do sistema passa por aqui:
// - Atualiza o doc principal SE vigência <= hoje (imediata)
// - Senão, agenda em mudancasAgendadas pra aplicar quando o dia chegar
// - Sempre cria/atualiza um doc em historicos (timeline do campo)
// - Sempre registra 1 entrada em auditLog
//
// Pra usar, monte um VersionedChangeInput e chame applyVersionedChange().

import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import type { AuditLog, HistoricoVersao, MudancaAgendada } from "../types";
import { todayYmd } from "../utils/date";
import { sanitizeForFirestore } from "../firebase/sanitize";

// Mapeia entityType → nome da coleção no Firestore
const COLLECTION_BY_TYPE: Record<string, string> = {
  cargo: "cargos",
  empregado: "empregados",
  restaurant: "restaurants",
  pessoa: "pessoas",
};

export type EntityType = "cargo" | "empregado" | "restaurant" | "pessoa";

export type VersionedChangeInput = {
  entityType: EntityType;
  entityId: string;
  restaurantId?: string;
  campo: string;                 // ex: "pontos", "vtValorPassagem", "taxRate"
  valorAntes: unknown;
  valorDepois: unknown;
  vigenteApartir: string;        // YYYY-MM-DD
  motivo?: string;
  registradoPor: string;         // pessoaId
};

export async function applyVersionedChange(input: VersionedChangeInput): Promise<{
  imediato: boolean;
  agendadaId?: string;
}> {
  const now = new Date().toISOString();
  const today = todayYmd();
  const collectionName = COLLECTION_BY_TYPE[input.entityType];
  if (!collectionName) {
    throw new Error(`entityType desconhecido: ${input.entityType}`);
  }

  const imediato = input.vigenteApartir <= today;

  // 1. Aplica no doc principal OU agenda
  let agendadaId: string | undefined;
  if (imediato) {
    await updateDoc(doc(db, collectionName, input.entityId), {
      [input.campo]: input.valorDepois,
    });
  } else {
    const ag: Omit<MudancaAgendada, "id"> = {
      entityType: input.entityType,
      entityId: input.entityId,
      campo: input.campo,
      valorNovo: input.valorDepois,
      aplicarEm: input.vigenteApartir,
      motivo: input.motivo,
      registradoEm: now,
      registradoPor: input.registradoPor,
      aplicadoEm: null,
    };
    const ref = await addDoc(collection(db, "mudancasAgendadas"), ag);
    agendadaId = ref.id;
  }

  // 2. Atualiza histórico (fecha versão atual com dia anterior, abre nova)
  const histId = `${input.entityType}_${input.entityId}_${input.campo}`;
  const histRef = doc(db, "historicos", histId);
  const histSnap = await getDoc(histRef);
  let versoes: HistoricoVersao[] = [];
  if (histSnap.exists()) {
    versoes = (histSnap.data().versoes || []) as HistoricoVersao[];
  }
  // Fecha a versão atualmente vigente (a sem `fim`) com o dia anterior à vigência
  const fimAnterior = previousDay(input.vigenteApartir);
  versoes = versoes.map(v => v.fim ? v : { ...v, fim: fimAnterior });
  // Adiciona nova versão
  versoes.push({
    valor: input.valorDepois as HistoricoVersao["valor"],
    inicio: input.vigenteApartir,
    fim: null,
    motivo: input.motivo,
    registradoEm: now,
    registradoPor: input.registradoPor,
  });
  await setDoc(histRef, {
    id: histId,
    entityType: input.entityType,
    entityId: input.entityId,
    campo: input.campo,
    versoes,
    updatedAt: now,
  });

  // 3. Audit log
  const log: Omit<AuditLog, "id"> = {
    restaurantId: input.restaurantId,
    entityType: input.entityType,
    entityId: input.entityId,
    acao: imediato ? "alterado" : "agendado",
    diff: {
      [input.campo]: { antes: input.valorAntes, depois: input.valorDepois },
    },
    vigenteApartir: input.vigenteApartir,
    motivo: input.motivo,
    registradoEm: now,
    registradoPor: input.registradoPor,
  };
  await addDoc(collection(db, "auditLog"), sanitizeForFirestore(log));

  return { imediato, agendadaId };
}

/**
 * Audit log "leve" — registra uma ação sem versionar nem agendar.
 * Pra criar entidade nova, demitir, inativar etc.
 */
export async function logAudit(input: {
  entityType: EntityType;
  entityId: string;
  restaurantId?: string;
  acao: AuditLog["acao"];
  diff?: AuditLog["diff"];
  motivo?: string;
  registradoPor: string;
}): Promise<void> {
  const log: Omit<AuditLog, "id"> = {
    ...input,
    registradoEm: new Date().toISOString(),
  };
  // Firestore rejeita undefined em qualquer profundidade do diff — sanitiza
  await addDoc(collection(db, "auditLog"), sanitizeForFirestore(log));
}

function previousDay(ymd: string): string {
  // Recebe YYYY-MM-DD e retorna o dia anterior (YYYY-MM-DD)
  const d = new Date(ymd + "T12:00:00");
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

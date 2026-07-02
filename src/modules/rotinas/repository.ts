// Persistência das Rotinas + cálculo de pendências por pessoa.
import { deleteDoc, doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Rotina, RotinaConclusao } from "../../core/types";
import { ultimaDataDevida } from "./rotinasEngine";

export async function salvarRotina(r: Rotina): Promise<void> {
  await setDoc(doc(db, "rotinas", r.id), sanitizeForFirestore(r));
}

export async function apagarRotina(id: string): Promise<void> {
  await deleteDoc(doc(db, "rotinas", id));
}

// Marca a ocorrência de uma rotina (numa data) como concluída por uma pessoa.
// Id determinístico → idempotente (marcar duas vezes não duplica).
export async function concluirRotina(
  rotina: Rotina,
  ocorrenciaData: string,
  pessoaId: string,
  pessoaNome: string,
): Promise<void> {
  const id = `${rotina.id}_${ocorrenciaData}_${pessoaId}`;
  const conclusao: RotinaConclusao = {
    id,
    restaurantId: rotina.restaurantId,
    rotinaId: rotina.id,
    ocorrenciaData,
    pessoaId,
    pessoaNome,
    concluidoEm: new Date().toISOString(),
  };
  await setDoc(doc(db, "rotinaConclusoes", id), sanitizeForFirestore(conclusao));
}

export async function desfazerConclusao(rotinaId: string, ocorrenciaData: string, pessoaId: string): Promise<void> {
  await deleteDoc(doc(db, "rotinaConclusoes", `${rotinaId}_${ocorrenciaData}_${pessoaId}`));
}

export type RotinaPendente = {
  rotina: Rotina;
  ocorrenciaData: string;   // data devida ainda não cumprida por essa pessoa
  atrasada: boolean;        // devida antes de hoje
};

// Rotinas pendentes pra uma pessoa: ativas, onde ela é responsável, cuja última
// data devida (<= hoje) ainda não foi concluída por ela.
export function pendentesParaPessoa(
  rotinas: Rotina[],
  conclusoesIds: Set<string>,     // ids de rotinaConclusoes da pessoa
  pessoaId: string,
  hoje: string,
): RotinaPendente[] {
  const out: RotinaPendente[] = [];
  for (const r of rotinas) {
    if (!r.ativo) continue;
    if (!r.responsaveis?.includes(pessoaId)) continue;
    const due = ultimaDataDevida(r.recorrencia, hoje);
    if (!due) continue;
    const chave = `${r.id}_${due}_${pessoaId}`;
    if (conclusoesIds.has(chave)) continue;
    out.push({ rotina: r, ocorrenciaData: due, atrasada: due < hoje });
  }
  return out;
}

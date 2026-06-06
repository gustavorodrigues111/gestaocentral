// ════════════════════════════════════════════════════════════════════════════
//  Migração inicial de vínculos.
//
//  Política (definida com o master, decisão "B"):
//   - Pessoa master           → vinculos[rid] = "diretoria" pra TODO rid em
//                               restaurantIds (cobertura total — diretoria é
//                               por restaurante, mas master atua em todos)
//   - Pessoa sem cargo no rid → vinculos[rid] não é setado (admin preenche)
//   - Pessoa com cargo no rid → NÃO seta (fallback `resolverVinculo` traduz
//                               cargo.tipoVinculo on-the-fly; vai pelo legacy)
//
//  Idempotente — rodar 2x não estraga (só seta o que falta).
//  Acionável via botão na página /arquitetura (UI vem na V2).
// ════════════════════════════════════════════════════════════════════════════

import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import type { Pessoa } from "../types";

export type MigracaoResult = {
  total: number;
  mastersAtualizados: number;
  jaTinhamVinculo: number;
  semMudanca: number;
};

export async function migrarVinculosIniciais(): Promise<MigracaoResult> {
  const snap = await getDocs(collection(db, "pessoas"));
  const pessoas: Pessoa[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Pessoa, "id">) }));

  let mastersAtualizados = 0;
  let jaTinhamVinculo = 0;
  let semMudanca = 0;

  for (const p of pessoas) {
    if (!p.isMaster) {
      semMudanca++;
      continue;
    }
    const rids = p.restaurantIds || [];
    if (rids.length === 0) {
      semMudanca++;
      continue;
    }
    const vinculosAtuais = p.vinculos || {};
    const novosVinculos = { ...vinculosAtuais };
    let mudou = false;
    for (const rid of rids) {
      if (!novosVinculos[rid]) {
        novosVinculos[rid] = "diretoria";
        mudou = true;
      }
    }
    if (mudou) {
      await updateDoc(doc(db, "pessoas", p.id), sanitizeForFirestore({
        vinculos: novosVinculos,
      }));
      mastersAtualizados++;
    } else {
      jaTinhamVinculo++;
    }
  }

  return {
    total: pessoas.length,
    mastersAtualizados,
    jaTinhamVinculo,
    semMudanca,
  };
}

// Roda ao app load. Busca mudancasAgendadas com aplicarEm <= hoje e
// não aplicadas ainda, e aplica no doc principal.
//
// Conceito: a fonte da verdade dos campos versionados é o doc principal,
// mas mudanças com vigência futura ficam pendentes até chegar o dia.

import { collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "../firebase/config";
import type { MudancaAgendada } from "../types";
import { todayYmd } from "../utils/date";

const COLLECTION_BY_TYPE: Record<string, string> = {
  cargo: "cargos",
  empregado: "empregados",
  restaurant: "restaurants",
  pessoa: "pessoas",
};

export async function applyPendingChanges(): Promise<{
  aplicadas: number;
  erros: number;
}> {
  const today = todayYmd();
  // Query simples (sem composite index): busca todas as não aplicadas
  // e filtra por data no client. Volume baixo (maioria já foi aplicada).
  const q = query(
    collection(db, "mudancasAgendadas"),
    where("aplicadoEm", "==", null),
  );
  const snap = await getDocs(q);
  let aplicadas = 0;
  let erros = 0;
  for (const d of snap.docs) {
    const m = { id: d.id, ...d.data() } as MudancaAgendada;
    if (m.aplicarEm > today) continue; // ainda no futuro
    const collName = COLLECTION_BY_TYPE[m.entityType];
    if (!collName) {
      console.warn("MudancaAgendada com entityType desconhecido:", m);
      erros++;
      continue;
    }
    try {
      await updateDoc(doc(db, collName, m.entityId), {
        [m.campo]: m.valorNovo,
      });
      await updateDoc(doc(db, "mudancasAgendadas", m.id), {
        aplicadoEm: new Date().toISOString(),
      });
      aplicadas++;
    } catch (e) {
      console.error("Erro aplicando mudança agendada:", m.id, e);
      erros++;
    }
  }
  if (aplicadas > 0) {
    console.log(`[pendingChanges] ${aplicadas} mudança(s) agendada(s) aplicada(s)`);
  }
  return { aplicadas, erros };
}

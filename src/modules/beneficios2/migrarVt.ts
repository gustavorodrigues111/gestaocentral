// Migração 1x (idempotente): preenche `vtValorDiario` (campo canônico do módulo
// Benefícios) a partir do VT legado `passagens/dia × valor da passagem`, pra todos
// os empregados com VT ativo que ainda não têm valor diário. Depois dela é seguro
// remover o fallback do cálculo e apagar os módulos vt/ e beneficios/ antigos.
//
// Idempotente: quem já tem vtValorDiario é pulado — pode rodar quantas vezes quiser.
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Empregado } from "../../core/types";

export type MigracaoVtResultado = {
  total: number;      // empregados varridos
  migrados: number;   // receberam vtValorDiario agora
  jaOk: number;       // já tinham vtValorDiario
  semBase: number;    // VT ativo mas sem passagens×valor (>0) pra calcular — nada a fazer
  semVt: number;      // sem VT ativo
};

export async function migrarVtValorDiario(): Promise<MigracaoVtResultado> {
  const snap = await getDocs(collection(db, "empregados"));
  let migrados = 0, jaOk = 0, semBase = 0, semVt = 0;
  for (const d of snap.docs) {
    const e = d.data() as Empregado;
    if (!e.vtAtivo) { semVt++; continue; }
    if (e.vtValorDiario != null) { jaOk++; continue; }
    const diario = (e.vtPassagensPorDia ?? 0) * (e.vtValorPassagem ?? 0);
    if (diario > 0) {
      await updateDoc(doc(db, "empregados", d.id), sanitizeForFirestore({ vtValorDiario: Math.round(diario * 100) / 100 }));
      migrados++;
    } else {
      semBase++;
    }
  }
  return { total: snap.size, migrados, jaOk, semBase, semVt };
}

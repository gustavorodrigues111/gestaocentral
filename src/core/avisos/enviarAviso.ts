// Envia um "aviso direcionado" a pessoas específicas — cai na Central de Avisos
// de cada destinatário. Genérico: qualquer módulo pode usar (BEO, relatórios…).
import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";

export type NovoAvisoDirecionado = {
  restaurantId: string;
  destinatarioIds: string[];
  titulo: string;
  texto?: string;
  icone?: string;
  categoria?: string;
  anexoUrl?: string;
  anexoNome?: string;
  href?: string;
  origem?: string;
  criadoPor?: string;
  criadoPorNome?: string;
};

export async function enviarAvisoDirecionado(a: NovoAvisoDirecionado): Promise<void> {
  const dest = (a.destinatarioIds || []).filter(Boolean);
  if (dest.length === 0) throw new Error("Selecione ao menos um destinatário.");
  await addDoc(collection(db, "avisosDirecionados"), sanitizeForFirestore({
    ...a,
    destinatarioIds: dest,
    criadoEm: new Date().toISOString(),
  }));
}

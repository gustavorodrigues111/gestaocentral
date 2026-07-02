// Log de tratativas com o cliente (coleção logsEvento). Cada entrada é uma
// interação: proposta enviada (auto), "cliente respondeu X" (manual), etc.
// Registra o canal (WhatsApp, telefone, e-mail, presencial…) pra dar rastro
// da conversa dentro do próprio lead.
import { collection, doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { CanalTratativa, LogMensagemEvento, TemplateMensagemEventoKey } from "../../core/types";

export async function registrarTratativa(p: {
  restaurantId: string;
  leadId: string;
  texto: string;
  canal: CanalTratativa;
  porId: string;
  porNome: string;
  manual?: boolean;
  templateKey?: TemplateMensagemEventoKey;
}): Promise<void> {
  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const log: LogMensagemEvento = {
    id,
    restaurantId: p.restaurantId,
    leadId: p.leadId,
    texto: p.texto,
    canal: p.canal,
    enviadoEm: new Date().toISOString(),
    enviadoPor: p.porId,
    enviadoPorNome: p.porNome,
    manual: p.manual,
    templateKey: p.templateKey,
  };
  await setDoc(doc(collection(db, "logsEvento"), id), sanitizeForFirestore(log));
}

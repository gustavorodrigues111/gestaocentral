// Persistência das NotificacaoConfig (canais/destinatários por tipo × restaurante).
import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { NotificacaoConfig } from "../../core/types";

export const notifConfigId = (restaurantId: string, tipo: string) => `${restaurantId}_${tipo}`;

export async function salvarNotifConfig(
  restaurantId: string,
  tipo: string,
  patch: Partial<NotificacaoConfig>,
  porPessoaId?: string,
): Promise<void> {
  const id = notifConfigId(restaurantId, tipo);
  await setDoc(
    doc(db, "notificacaoConfigs", id),
    sanitizeForFirestore({ ...patch, id, restaurantId, tipo, atualizadoEm: new Date().toISOString(), atualizadoPor: porPessoaId || null }),
    { merge: true },
  );
}

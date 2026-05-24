// Helpers do reconhecimento de cliente recorrente.
//
// O form público de reservas usa /clientesPublicLookup pra reconhecer
// quem já reservou antes — doc ID determinístico `<rid>_<e164>` permite
// `get` direto sem `list` (sem enumeração possível).
//
// Esses helpers são chamados:
//   1. Form público (ReservasPublicaPage) — lookup ao avançar do step do
//      WhatsApp + upsert ao submeter a reserva.
//   2. Admin (ClienteModal, dedupe banner do ClientesTab) — upsert ao
//      criar/editar/mesclar clientes pra propagar pro form público.

import { doc, setDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { ClientePublicLookup } from "../../core/types";

// Infere E.164 do telefone — assume BR quando não tem prefixo internacional.
// Telefone com 10 ou 11 dígitos vira `+55<dddNumero>`. Já em E.164 (com +)
// passa direto. Retorna null se não conseguir inferir (cliente sem telefone,
// número absurdamente curto, etc).
export function inferirE164(telefone: string | undefined | null): string | null {
  if (!telefone) return null;
  if (telefone.startsWith("+")) {
    const d = telefone.slice(1).replace(/\D/g, "");
    return d.length >= 8 ? `+${d}` : null;
  }
  const d = telefone.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if (d.length === 12 || d.length === 13) return `+${d}`;
  return null;
}

// Chave de comparação pra detectar duplicados — só dígitos, últimos 11
// (DDD+9+8 dígitos no BR). Ignora formatação e DDI quando presente.
export function phoneKey(telefone: string | undefined | null): string {
  if (!telefone) return "";
  const d = telefone.replace(/\D/g, "");
  return d.length >= 11 ? d.slice(-11) : d;
}

// Calcula o doc ID determinístico do lookup. Retorna null se não conseguir
// inferir E.164 (cliente sem telefone, etc).
export function lookupIdParaTelefone(restaurantId: string, telefone: string | undefined | null): string | null {
  const e164 = inferirE164(telefone);
  if (!e164) return null;
  return `${restaurantId}_${e164.replace(/^\+/, "")}`;
}

// Upserta o doc de lookup pra um cliente. Chamado tanto pelo form público
// (ao criar reserva) quanto pelo admin (ao criar/editar cliente, mesclar
// duplicados). Idempotente — sobrescreve.
//
// Se telefone não der pra inferir E.164, no-op silencioso (cliente sem
// telefone não tem como ser reconhecido pelo form público mesmo).
export async function upsertClienteLookup(input: {
  restaurantId: string;
  telefone: string | undefined | null;
  nome: string;
  email?: string;
  clienteId: string;
}): Promise<void> {
  const e164 = inferirE164(input.telefone);
  if (!e164) return;
  const lookupId = `${input.restaurantId}_${e164.replace(/^\+/, "")}`;
  const payload: ClientePublicLookup = {
    restaurantId: input.restaurantId,
    telefoneE164: e164,
    nome: input.nome,
    email: input.email,
    clienteId: input.clienteId,
    atualizadoEm: new Date().toISOString(),
  };
  await setDoc(doc(db, "clientesPublicLookup", lookupId), sanitizeForFirestore(payload));
}

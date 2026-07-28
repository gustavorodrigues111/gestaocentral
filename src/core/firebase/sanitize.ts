// Firestore não aceita undefined. Esta função recursivamente:
// - Remove chaves de objeto com valor undefined
// - Substitui undefined em arrays/escalares por null (preservando índices)
// - Mantém null, números, strings, booleans, datas (como ISO string), objetos e arrays
// - Deixa PASSAR intactos os sentinels do Firestore (deleteField, serverTimestamp,
//   arrayUnion/Remove, increment). Sem isso, o sentinel virava um {} — bug crítico:
//   deleteField() não apagava o campo (ex.: mustTrocarSenha loopando o 1º acesso).
//
// Use antes de qualquer setDoc/updateDoc/addDoc com objeto que possa ter undefined.
import { FieldValue } from "firebase/firestore";

export function sanitizeForFirestore<T>(v: T): T {
  if (v === undefined) return null as unknown as T;
  if (v === null) return v;
  if (v instanceof FieldValue) return v; // sentinel (deleteField, serverTimestamp, …) — não tocar
  if (typeof v === "function") return null as unknown as T;
  if (v instanceof Date) return v.toISOString() as unknown as T;
  if (Array.isArray(v)) return v.map(item => sanitizeForFirestore(item)) as unknown as T;
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as object)) {
      if (val === undefined) continue;
      out[k] = sanitizeForFirestore(val);
    }
    return out as unknown as T;
  }
  return v;
}

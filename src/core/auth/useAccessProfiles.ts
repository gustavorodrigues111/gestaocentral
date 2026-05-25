// Hook que carrega os AccessProfiles do Firestore via onSnapshot + retorna
// helpers pra criar/editar/deletar. Built-ins (do código) são mergeados
// na lista, mas se houver doc no Firestore com mesmo id (override), o
// custom ganha.

import { useEffect, useState, useCallback } from "react";
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { sanitizeForFirestore } from "../firebase/sanitize";
import type { AccessProfile, Pessoa } from "../types";
import { BUILTIN_PROFILES, BUILTIN_BY_ID } from "./builtinProfiles";

export type UseAccessProfilesResult = {
  /** Lista MERGE de built-ins + custom (overrides aplicados). */
  perfis: AccessProfile[];
  /** Só os custom (não-builtin) do Firestore. Útil pra passar ao canAcao. */
  perfisCustomDb: AccessProfile[];
  loading: boolean;
  erro: string;
  salvar: (p: AccessProfile, savedBy: Pessoa) => Promise<void>;
  deletar: (id: string) => Promise<void>;
};

export function useAccessProfiles(): UseAccessProfilesResult {
  const [perfisCustomDb, setPerfisCustomDb] = useState<AccessProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const ref = collection(db, "accessProfiles");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as AccessProfile);
        setPerfisCustomDb(list);
        setLoading(false);
        setErro("");
      },
      (err) => {
        setLoading(false);
        setErro(err.code === "permission-denied" ? "permission_denied" : (err.message || "Erro"));
      },
    );
    return () => unsub();
  }, []);

  // Merge: built-ins + custom. Se built-in tem override no DB (mesmo id),
  // usa o override.
  const perfis: AccessProfile[] = [];
  const overrides = new Map(perfisCustomDb.map(p => [p.id, p]));
  for (const bi of BUILTIN_PROFILES) {
    perfis.push(overrides.get(bi.id) ?? bi);
  }
  // Custom (não-builtin) que sobraram
  for (const p of perfisCustomDb) {
    if (!BUILTIN_BY_ID[p.id]) perfis.push(p);
  }

  const salvar = useCallback(async (p: AccessProfile, savedBy: Pessoa) => {
    const now = new Date().toISOString();
    const payload: AccessProfile = {
      ...p,
      atualizadoEm: now,
      atualizadoPor: savedBy.id,
      criadoPor: p.criadoPor || savedBy.id,
      criadoEm: p.criadoEm || now,
      // serverTimestamp opcional pra auditoria — guardamos como string ISO
      // por consistência com resto do app
    };
    // serverTimestamp não usado direto, mas mantemos referencia caso futuro
    void serverTimestamp;
    await setDoc(doc(db, "accessProfiles", p.id), sanitizeForFirestore(payload));
  }, []);

  const deletar = useCallback(async (id: string) => {
    // Built-ins não podem ser deletados — só sobrescritos. Se admin clicar
    // "restaurar default" num built-in editado, deleta o override pra
    // voltar pra constante do código.
    await deleteDoc(doc(db, "accessProfiles", id));
  }, []);

  return { perfis, perfisCustomDb, loading, erro, salvar, deletar };
}

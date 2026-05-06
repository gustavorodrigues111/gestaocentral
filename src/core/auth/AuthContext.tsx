import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, getDocs, query, collection, where, limit, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import type { Pessoa } from "../types";

type AuthState = {
  fbUser: FirebaseUser | null;
  pessoa: Pessoa | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

const POLL_INTERVAL_MS = 30_000;  // 30s — detecta inativação

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [loading, setLoading] = useState(true);
  // pessoaDocId resolvido (pode diferir de uid se a pessoa foi cadastrada com auto-id)
  const pessoaDocIdRef = useRef<string | null>(null);

  // ── Auth state listener (1 vez) ───────────────────────────────────────────
  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFbUser(user);
      if (!user) {
        setPessoa(null);
        pessoaDocIdRef.current = null;
        setLoading(false);
        return;
      }

      // Resolve doc id da pessoa: tenta uid → fallback por email
      let docId = user.uid;
      try {
        const direct = await getDoc(doc(db, "pessoas", user.uid));
        if (!direct.exists() && user.email) {
          const q = query(collection(db, "pessoas"), where("email", "==", user.email), limit(1));
          const qsnap = await getDocs(q);
          if (qsnap.empty) {
            setPessoa(null);
            pessoaDocIdRef.current = null;
            setLoading(false);
            return;
          }
          docId = qsnap.docs[0].id;
          // Vincula uidVinculado uma vez (não dispara loop porque polling lê com getDoc, não listener)
          try {
            const cur = qsnap.docs[0].data() as { uidVinculado?: string };
            if (cur.uidVinculado !== user.uid) {
              await updateDoc(doc(db, "pessoas", docId), { uidVinculado: user.uid });
            }
          } catch (e) {
            console.warn("Não foi possível atualizar uidVinculado:", e);
          }
        }
        pessoaDocIdRef.current = docId;
        await refreshPessoa(docId);
      } catch (e) {
        console.error("Erro resolvendo pessoa:", e);
        setPessoa(null);
        setLoading(false);
      }
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling 30s pra detectar inativação imediata ──────────────────────────
  useEffect(() => {
    if (!fbUser) return;
    const id = setInterval(() => {
      if (pessoaDocIdRef.current) refreshPessoa(pessoaDocIdRef.current);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fbUser]);

  async function refreshPessoa(docId: string) {
    try {
      const snap = await getDoc(doc(db, "pessoas", docId));
      if (!snap.exists()) {
        setPessoa(null);
        setLoading(false);
        return;
      }
      const data = { id: snap.id, ...snap.data() } as Pessoa;
      if (data.ativa === false) {
        // bloqueio imediato: faz logout
        alert("Sua conta foi inativada. Acesso bloqueado.");
        await fbSignOut(auth).catch(() => {});
        return;
      }
      setPessoa(data);
      setLoading(false);
    } catch (e) {
      console.error("Erro lendo pessoa:", e);
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }
  async function signUp(email: string, password: string) {
    await createUserWithEmailAndPassword(auth, email, password);
  }
  async function signOut() {
    await fbSignOut(auth);
  }

  return (
    <AuthCtx.Provider value={{ fbUser, pessoa, loading, signIn, signUp, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

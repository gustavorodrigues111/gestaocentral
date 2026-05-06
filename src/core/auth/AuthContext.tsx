import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
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
  fbUser: FirebaseUser | null;     // usuário do Firebase Auth
  pessoa: Pessoa | null;           // doc da pessoa no Firestore (com permissões)
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFbUser(user);
      if (!user) {
        setPessoa(null);
        setLoading(false);
        return;
      }
      // Carrega doc da pessoa por uid PRIMEIRO. Se não existe, fallback: query por email.
      // Isso permite que pessoas cadastradas pelo app (com Auto-ID) vinculem ao auth uid
      // automaticamente quando fizerem signup.
      try {
        const snap = await getDoc(doc(db, "pessoas", user.uid));
        if (snap.exists()) {
          setPessoa({ id: user.uid, ...snap.data() } as Pessoa);
        } else if (user.email) {
          // Fallback: query por email
          const q = query(collection(db, "pessoas"), where("email", "==", user.email), limit(1));
          const qsnap = await getDocs(q);
          if (!qsnap.empty) {
            const d = qsnap.docs[0];
            // Vincula uid no doc pra próximas leituras irem direto pelo uid (mais rápido + permissão certa)
            try {
              await updateDoc(doc(db, "pessoas", d.id), { uidVinculado: user.uid });
            } catch (e) {
              console.warn("Não foi possível atualizar uidVinculado:", e);
            }
            setPessoa({ id: d.id, ...d.data() } as Pessoa);
          } else {
            setPessoa(null);
          }
        } else {
          setPessoa(null);
        }
      } catch (e) {
        console.error("Erro carregando pessoa:", e);
        setPessoa(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

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

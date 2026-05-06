import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import type { Pessoa } from "../types";

type AuthState = {
  fbUser: FirebaseUser | null;     // usuário do Firebase Auth
  pessoa: Pessoa | null;           // doc da pessoa no Firestore (com permissões)
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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
      // Carrega doc da pessoa por uid
      try {
        const snap = await getDoc(doc(db, "pessoas", user.uid));
        if (snap.exists()) {
          setPessoa({ id: user.uid, ...snap.data() } as Pessoa);
        } else {
          setPessoa(null); // sem doc = ainda não foi cadastrado
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
  async function signOut() {
    await fbSignOut(auth);
  }

  return (
    <AuthCtx.Provider value={{ fbUser, pessoa, loading, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

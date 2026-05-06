import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, getDocs, onSnapshot, query, collection, where, limit, updateDoc } from "firebase/firestore";
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

    // unsub do listener de pessoa (precisa cleanup quando muda fbUser ou desloga)
    let unsubPessoa: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setFbUser(user);

      // limpa listener anterior
      if (unsubPessoa) { unsubPessoa(); unsubPessoa = null; }

      if (!user) {
        setPessoa(null);
        setLoading(false);
        return;
      }

      // Tenta resolver o doc da pessoa: primeiro por uid, fallback por email.
      let pessoaDocId = user.uid;
      try {
        const direct = await getDoc(doc(db, "pessoas", user.uid));
        if (!direct.exists() && user.email) {
          const q = query(collection(db, "pessoas"), where("email", "==", user.email), limit(1));
          const qsnap = await getDocs(q);
          if (!qsnap.empty) {
            pessoaDocId = qsnap.docs[0].id;
            try {
              await updateDoc(doc(db, "pessoas", pessoaDocId), { uidVinculado: user.uid });
            } catch (e) {
              console.warn("Não foi possível atualizar uidVinculado:", e);
            }
          } else {
            setPessoa(null);
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.error("Erro resolvendo pessoa:", e);
      }

      // Listener real-time no doc da pessoa.
      // Detecta inativação imediatamente (ativa = false → kicka).
      // Também propaga mudanças de permissões na hora.
      unsubPessoa = onSnapshot(doc(db, "pessoas", pessoaDocId), (snap) => {
        if (!snap.exists()) {
          setPessoa(null);
          setLoading(false);
          return;
        }
        const data = { id: snap.id, ...snap.data() } as Pessoa;
        // Inativação imediata: se o doc virou ativa=false enquanto a pessoa tava logada,
        // faz logout. Pessoas SEM o campo 'ativa' (legado) são tratadas como ativas.
        if (data.ativa === false) {
          alert("Sua conta foi inativada. Acesso bloqueado.");
          fbSignOut(auth).catch(() => {});
          setPessoa(null);
          setLoading(false);
          return;
        }
        setPessoa(data);
        setLoading(false);
      }, (err) => {
        console.error("Erro no listener de pessoa:", err);
        setPessoa(null);
        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsubPessoa) unsubPessoa();
    };
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

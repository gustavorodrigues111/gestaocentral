import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc, getDocs, query, collection, where, limit, onSnapshot, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import type { AccessProfile, Pessoa } from "../types";
import { BUILTIN_PROFILES, BUILTIN_BY_ID } from "./builtinProfiles";
import { aplicarPerfisNaPessoa } from "./profileToLegacy";

type AuthState = {
  fbUser: FirebaseUser | null;
  /**
   * Pessoa "ativa": é a impersonada se isImpersonating, senão a real.
   * 99% das telas usam essa — vê o mundo pela ótica dela.
   */
  pessoa: Pessoa | null;
  /** Pessoa real (logada via Firebase Auth). Não muda em impersonação. */
  pessoaReal: Pessoa | null;
  /** True quando master tá visualizando como outra pessoa. */
  isImpersonating: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /**
   * Master inicia visualização como outra pessoa. Só master pode usar.
   * Auth real do Firebase continua sendo o master — então rules deixam
   * fazer tudo. UI fica view-only por convenção (mostra banner avisando).
   */
  startImpersonate: (pessoaId: string) => void;
  /** Sai do modo "ver como" e volta a ser ele mesmo. */
  stopImpersonate: () => void;
};

const AuthCtx = createContext<AuthState | null>(null);

const POLL_INTERVAL_MS = 30_000;  // 30s — detecta inativação
const IMPERSONATE_KEY = "impersonate_pessoa_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<FirebaseUser | null>(null);
  const [pessoaReal, setPessoaReal] = useState<Pessoa | null>(null);
  const [pessoaImpersonada, setPessoaImpersonada] = useState<Pessoa | null>(null);
  // Lê id de impersonação do sessionStorage no boot (sobrevive a refresh
  // mas some quando fecha a aba — comportamento intencional).
  const [impersonatedId, setImpersonatedId] = useState<string | null>(() => {
    try {
      return typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem(IMPERSONATE_KEY)
        : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  // pessoaDocId resolvido (pode diferir de uid se a pessoa foi cadastrada com auto-id)
  const pessoaDocIdRef = useRef<string | null>(null);

  // ── Perfis de Acesso — carregados aqui no Auth pra mesclar nas
  // permissões da pessoa antes de expor às telas. Faz com que TODOS os
  // módulos respeitem perfis via canVer/canConfigurar legados, sem precisar
  // refactor cada page. Detalhes em profileToLegacy.ts.
  const [perfisCustomDb, setPerfisCustomDb] = useState<AccessProfile[]>([]);
  useEffect(() => {
    if (!fbUser) {
      setPerfisCustomDb([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "accessProfiles"),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as AccessProfile);
        setPerfisCustomDb(list);
      },
      () => { /* permission-denied silencioso — pessoa não autenticada ainda */ },
    );
    return () => unsub();
  }, [fbUser]);

  // Merge built-ins + DB (DB overrides built-in de mesmo id)
  const perfisMerged = useMemo<AccessProfile[]>(() => {
    const overrides = new Map(perfisCustomDb.map(p => [p.id, p]));
    const out: AccessProfile[] = [];
    for (const bi of BUILTIN_PROFILES) out.push(overrides.get(bi.id) ?? bi);
    for (const p of perfisCustomDb) {
      if (!BUILTIN_BY_ID[p.id]) out.push(p);
    }
    return out;
  }, [perfisCustomDb]);

  // ── Carregar pessoa impersonada quando o id muda ──────────────────────────
  useEffect(() => {
    if (!impersonatedId) {
      setPessoaImpersonada(null);
      return;
    }
    // Só permite impersonar se o usuário real é master (defesa em
    // profundidade — botão de iniciar também checa).
    if (!pessoaReal?.isMaster) {
      setPessoaImpersonada(null);
      return;
    }
    let cancelado = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "pessoas", impersonatedId));
        if (cancelado) return;
        if (!snap.exists()) {
          setPessoaImpersonada(null);
          stopImpersonateInternal();
          return;
        }
        setPessoaImpersonada({ id: snap.id, ...snap.data() } as Pessoa);
      } catch (e) {
        console.error("Erro carregando pessoa impersonada:", e);
      }
    })();
    return () => { cancelado = true; };
  }, [impersonatedId, pessoaReal?.isMaster]);

  function stopImpersonateInternal() {
    setImpersonatedId(null);
    setPessoaImpersonada(null);
    try { sessionStorage.removeItem(IMPERSONATE_KEY); } catch { /* noop */ }
  }

  const startImpersonate = useCallback((pessoaId: string) => {
    if (!pessoaReal?.isMaster) {
      console.warn("startImpersonate: só master pode impersonar");
      return;
    }
    if (pessoaId === pessoaReal.id) {
      console.warn("startImpersonate: ignorado — você não pode impersonar a si mesmo");
      return;
    }
    try { sessionStorage.setItem(IMPERSONATE_KEY, pessoaId); } catch { /* noop */ }
    setImpersonatedId(pessoaId);
  }, [pessoaReal]);

  const stopImpersonate = useCallback(() => {
    stopImpersonateInternal();
  }, []);

  // ── Auth state listener (1 vez) ───────────────────────────────────────────
  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFbUser(user);
      if (!user) {
        setPessoaReal(null);
        pessoaDocIdRef.current = null;
        // Sair de impersonação se a sessão acabar
        stopImpersonateInternal();
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
            setPessoaReal(null);
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
        setPessoaReal(null);
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
        setPessoaReal(null);
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
      setPessoaReal(data);
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

  // Pessoa "ativa" exposta às telas: impersonada quando em modo "ver como",
  // senão a real. isImpersonating só vale se REALMENTE temos a pessoa
  // impersonada carregada (evita flash de UI errada durante load).
  const isImpersonating = !!pessoaImpersonada && pessoaImpersonada.id !== pessoaReal?.id;
  const pessoaBase = isImpersonating ? pessoaImpersonada : pessoaReal;

  // Aplica os perfis de acesso sobre as permissões da pessoa. Permite TODOS
  // os módulos (mesmo sem refactor pra canAcao granular) responderem aos
  // perfis automaticamente via canVer/canConfigurar legados. Master é
  // retornado intacto (bypass via isMaster).
  const pessoa = useMemo<Pessoa | null>(() => {
    if (!pessoaBase) return null;
    return aplicarPerfisNaPessoa(pessoaBase, perfisMerged);
  }, [pessoaBase, perfisMerged]);

  return (
    <AuthCtx.Provider value={{
      fbUser, pessoa, pessoaReal, isImpersonating, loading,
      signIn, signUp, signOut,
      startImpersonate, stopImpersonate,
    }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}

// ════════════════════════════════════════════════════════════════════════════
//  PessoasProvider — UM único listener da coleção `pessoas`, compartilhado por
//  todo o app. Antes, ~13 telas/modais abriam cada uma seu próprio
//  onSnapshot(collection("pessoas")) e reliam o cadastro INTEIRO a cada abertura
//  → uma das maiores fontes de leitura do Firestore. Agora todos consomem daqui.
//
//  Lê a coleção inteira (mesmo comportamento dos call-sites antigos, que também
//  não filtravam) — só que uma vez por sessão em vez de por-modal.
// ════════════════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import type { Pessoa } from "../types";

type PessoasCtxValue = { pessoas: Pessoa[]; loading: boolean };
const PessoasCtx = createContext<PessoasCtxValue>({ pessoas: [], loading: true });

export function PessoasProvider({ children }: { children: ReactNode }) {
  const { fbUser } = useAuth();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fbUser) { setPessoas([]); setLoading(false); return; }
    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "pessoas"),
      (snap) => { setPessoas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa)); setLoading(false); },
      () => setLoading(false),   // permission/rede — mantém o último valor
    );
    return () => unsub();
  }, [fbUser]);

  const value = useMemo(() => ({ pessoas, loading }), [pessoas, loading]);
  return <PessoasCtx.Provider value={value}>{children}</PessoasCtx.Provider>;
}

// Lista de todas as pessoas (compartilhada). Substitui os onSnapshot locais.
export function useTodasPessoas(): Pessoa[] {
  return useContext(PessoasCtx).pessoas;
}

// true até a primeira carga chegar (pra manter spinners existentes).
export function usePessoasLoading(): boolean {
  return useContext(PessoasCtx).loading;
}

// Mapa id → pessoa (memoizado por consumidor).
export function usePessoasPorId(): Record<string, Pessoa> {
  const { pessoas } = useContext(PessoasCtx);
  return useMemo(() => Object.fromEntries(pessoas.map((p) => [p.id, p])), [pessoas]);
}

// Lista {id, nome} das pessoas ATIVAS, ordenada por nome — formato comum dos
// pickers de responsável (Tarefas, Exames, etc.).
export function usePessoasAtivasLista(): { id: string; nome: string }[] {
  const { pessoas } = useContext(PessoasCtx);
  return useMemo(() => pessoas
    .filter((p) => p.ativa !== false && p.nome)
    .map((p) => ({ id: p.id, nome: p.nome as string }))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [pessoas]);
}

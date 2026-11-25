// ════════════════════════════════════════════════════════════════════════════
//  PessoasProvider — UM único listener da coleção `pessoas`, compartilhado por
//  todo o app. Antes, ~13 telas/modais abriam cada uma seu próprio
//  onSnapshot(collection("pessoas")) e reliam o cadastro INTEIRO a cada abertura
//  → uma das maiores fontes de leitura do Firestore. Agora todos consomem daqui.
//
//  ESCOPO POR EMPRESA (nov/2026): deixou de ler a coleção INTEIRA. Agora só as
//  pessoas das empresas do usuário (`restaurantIds array-contains-any rids`).
//  Fecha a superexposição de cadastro (CPF, etc.) e corta leitura do Firestore.
//  Fallback seguro p/ NÃO quebrar nada: master, usuário sem empresa, ou com mais
//  de 10 empresas → mantém a leitura completa de antes. Só mexe no CLIENTE; a
//  regra do Firestore segue permissiva (hardening de regra é passo seguinte).
// ════════════════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import type { Pessoa } from "../types";

type PessoasCtxValue = { pessoas: Pessoa[]; loading: boolean };
const PessoasCtx = createContext<PessoasCtxValue>({ pessoas: [], loading: true });

export function PessoasProvider({ children }: { children: ReactNode }) {
  const { fbUser, pessoa, pessoaReal } = useAuth();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);

  // Master (real ou efetivo) lê tudo — comportamento de antes, preservado.
  const isMaster = !!(pessoa?.isMaster || pessoaReal?.isMaster);
  // Chave estável das empresas do usuário (evita re-subscribe à toa).
  const ridsKey = useMemo(
    () => (pessoa?.restaurantIds ?? []).filter(Boolean).join(","),
    [pessoa?.restaurantIds],
  );

  useEffect(() => {
    if (!fbUser) { setPessoas([]); setLoading(false); return; }
    setLoading(true);
    const rids = ridsKey ? ridsKey.split(",") : [];
    // array-contains-any aceita 1..10 valores. Fora disso (ou master) → full.
    const escopar = !isMaster && rids.length >= 1 && rids.length <= 10;
    const ref = escopar
      ? query(collection(db, "pessoas"), where("restaurantIds", "array-contains-any", rids))
      : collection(db, "pessoas");
    const unsub = onSnapshot(
      ref,
      (snap) => { setPessoas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Pessoa)); setLoading(false); },
      () => setLoading(false),   // permission/rede — mantém o último valor
    );
    return () => unsub();
  }, [fbUser, isMaster, ridsKey]);

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

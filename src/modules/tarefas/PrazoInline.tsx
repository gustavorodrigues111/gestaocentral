// ════════════════════════════════════════════════════════════════════════════
//  PrazoInline — hospeda o PrazoModal DENTRO do módulo "Tarefas e Prazos".
//  Reúne as dependências que o modal precisa (empregados, endereços da empresa,
//  responsáveis por categoria, salvar) sem inchar o TarefasPage. Grava na coleção
//  `prazos`. Endereço vem da fonte única `enderecos` (Configurações), igual
//  Contas Fixas/Manutenções — não há mais cadastro separado de imóveis.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import { useAuth } from "../../core/auth/AuthContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { useAccessProfiles } from "../../core/auth/useAccessProfiles";
import { canAcao } from "../../core/auth/permissions";
import { useTodasPessoas } from "../../core/pessoas/PessoasContext";
import type { Prazo, PrazoTipo, Empregado, Endereco, Pessoa } from "../../core/types";
import { PrazoModal } from "../prazos/PrazoModal";

const TODAS_CATS: PrazoTipo[] = ["conta", "tecnico", "trabalhista", "avulso"];
const SUF_CAT: Record<PrazoTipo, string> = { conta: "Conta", tecnico: "Tecnico", trabalhista: "Trabalhista", avulso: "Avulso" };

export function PrazoInline({ rid, prazo, modo, onClose, onResolver, onAgendar, onRenovarExp }: {
  rid: string;
  prazo: Prazo | null;          // null = criar novo
  modo?: "ver" | "editar";
  onClose: () => void;
  onResolver?: (p: Prazo) => void;
  onAgendar?: (p: Prazo) => void;
  onRenovarExp?: (p: Prazo, renovar: boolean) => void;
}) {
  const { pessoa: me } = useAuth();
  const { can } = useCanAcao(rid);
  const { perfis } = useAccessProfiles();
  const pessoas = useTodasPessoas();
  const isMaster = !!me?.isMaster;
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [enderecos, setEnderecos] = useState<Endereco[]>([]);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)), () => setEmpregados([]));
    const u2 = onSnapshot(query(collection(db, "enderecos"), where("restaurantId", "==", rid)), (s) => setEnderecos(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Endereco).filter((e) => e.ativo !== false)), () => setEnderecos([]));
    return () => { u1(); u2(); };
  }, [rid]);

  const podeGerirCat = (t: PrazoTipo) => isMaster || can("prazos", `gerir${SUF_CAT[t]}`);
  const catsGeriveis = TODAS_CATS.filter(podeGerirCat);
  // Responsáveis possíveis POR CATEGORIA = quem acessa (vê/gere) aquele tipo nesta empresa.
  const responsaveisPorCat = useMemo(() => {
    const base = pessoas.filter((pp) => (pp.restaurantIds || []).includes(rid));
    const m = {} as Record<PrazoTipo, Pessoa[]>;
    for (const t of TODAS_CATS) {
      const suf = SUF_CAT[t];
      m[t] = base.filter((pp) => pp.isMaster || canAcao(pp, rid, "prazos", `ver${suf}`, perfis) || canAcao(pp, rid, "prazos", `gerir${suf}`, perfis));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas, rid, perfis]);

  async function salvarPrazo(p: Prazo) {
    await setDoc(doc(db, "prazos", p.id), sanitizeForFirestore({ ...p, atualizadoEm: new Date().toISOString() }), { merge: true });
  }

  return (
    <PrazoModal
      rid={rid}
      prazo={prazo}
      modoInicial={modo}
      tiposPermitidos={catsGeriveis}
      empregados={empregados}
      responsaveisPorCat={responsaveisPorCat}
      enderecos={enderecos}
      onClose={onClose}
      onSalvar={salvarPrazo}
      onResolver={onResolver}
      onAgendar={onAgendar}
      onRenovarExp={onRenovarExp}
    />
  );
}

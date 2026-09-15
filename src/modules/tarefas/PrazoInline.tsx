// ════════════════════════════════════════════════════════════════════════════
//  PrazoInline — hospeda o PrazoModal DENTRO do módulo "Tarefas e Prazos".
//  Reúne as dependências que o modal precisa (empregados, imóveis, responsáveis
//  por categoria, salvar) sem inchar o TarefasPage. Grava na coleção `prazos`
//  (prazos segue dono da sua máquina — laudo/agendamento/histórico). Mesma
//  lógica de salvar/permissão do PrazosPage.tsx.
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
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { Prazo, PrazoTipo, Empregado, Imovel, Pessoa } from "../../core/types";
import { PrazoModal } from "../prazos/PrazoModal";
import { ImoveisModal } from "../prazos/ImoveisModal";

const TODAS_CATS: PrazoTipo[] = ["conta", "tecnico", "trabalhista", "avulso"];
const SUF_CAT: Record<PrazoTipo, string> = { conta: "Conta", tecnico: "Tecnico", trabalhista: "Trabalhista", avulso: "Avulso" };

export function PrazoInline({ rid, prazo, modo, onClose }: {
  rid: string;
  prazo: Prazo | null;          // null = criar novo
  modo?: "ver" | "editar";
  onClose: () => void;
}) {
  const { pessoa: me } = useAuth();
  const { can } = useCanAcao(rid);
  const { perfis } = useAccessProfiles();
  const { activeRestaurant } = useRestaurant();
  const pessoas = useTodasPessoas();
  const isMaster = !!me?.isMaster;
  const [empregados, setEmpregados] = useState<Empregado[]>([]);
  const [imoveis, setImoveis] = useState<Imovel[]>([]);
  const [showImoveis, setShowImoveis] = useState(false);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(query(collection(db, "empregados"), where("restaurantId", "==", rid)), (s) => setEmpregados(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Empregado)), () => setEmpregados([]));
    const u2 = onSnapshot(query(collection(db, "imoveis"), where("restaurantId", "==", rid)), (s) => setImoveis(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Imovel).filter((im) => !im.deletadoEm)), () => setImoveis([]));
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
    <>
      <PrazoModal
        rid={rid}
        prazo={prazo}
        modoInicial={modo}
        tiposPermitidos={catsGeriveis}
        empregados={empregados}
        responsaveisPorCat={responsaveisPorCat}
        imoveis={imoveis}
        onGerenciarImoveis={() => setShowImoveis(true)}
        onClose={onClose}
        onSalvar={salvarPrazo}
      />
      {showImoveis && <ImoveisModal rid={rid} restauranteNome={activeRestaurant?.nome || ""} imoveis={imoveis} meId={me?.id || ""} onClose={() => setShowImoveis(false)} />}
    </>
  );
}

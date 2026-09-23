import { useEffect, useMemo, useState } from "react";
import { Pencil, LayoutDashboard, History, Lock, Radio, Package, Truck } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer, canConfigurar } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import type { Contagem, ContagemSessao, Insumo, Fornecedor } from "../../core/types";
import { LancarContagensTab } from "./LancarContagensTab";
import { PainelContagensTab } from "./PainelContagensTab";
import { HistoricoContagensTab } from "./HistoricoContagensTab";
import { InsumosManager } from "./InsumosManager";
import { PageContainer } from "../../core/ui/PageContainer";

type Tab = "contagens" | "config";

export function ContagensPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "contagens");
  const podeConfig = canConfigurar(me, rid, "contagens");
  const { can } = useCanAcao(rid);
  const podeEditarContagem = can("contagens", "editarFinalizada");

  const [tab, setTab] = useState<Tab>("contagens");
  const [contando, setContando] = useState(false);   // true = tela de lançar contagem
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [contagens, setContagens] = useState<Contagem[]>([]);
  const [sessoes, setSessoes] = useState<ContagemSessao[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "insumos"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Insumo);
      list.sort((a, b) => (a.categoria || "ZZ").localeCompare(b.categoria || "ZZ") || (a.nome || "").localeCompare(b.nome || ""));
      setInsumos(list);
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "contagens"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contagem);
      list.sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.registradoEm || "").localeCompare(a.registradoEm || ""));
      setContagens(list);
    });
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "contagemSessoes"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => setSessoes(snap.docs.map(d => ({ id: d.id, ...d.data() }) as ContagemSessao)), () => setSessoes([]));
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fornecedores"), where("restaurantId", "==", rid));
    return onSnapshot(q, (snap) => setFornecedores(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Fornecedor)), () => setFornecedores([]));
  }, [rid]);

  // Última contagem por insumo (mais recente).
  const ultimaContagem = useMemo(() => {
    const m: Record<string, Contagem> = {};
    for (const c of contagens) if (!m[c.insumoId]) m[c.insumoId] = c;   // contagens já vem desc
    return m;
  }, [contagens]);

  const nVivas = useMemo(() => sessoes.filter(s => (s.status || "em_andamento") === "em_andamento").length, [sessoes]);

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  // Se estou contando, a tela vira a de lançar (com voltar). Senão, a home mesclada.
  if (tab === "contagens" && contando) {
    return (
      <PageContainer>
        <LancarContagensTab insumos={insumos.filter(i => i.ativo)} ultimaContagem={ultimaContagem} restaurantId={rid} podeConfig={podeConfig} onSair={() => setContando(false)} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Tabs — só Contagens e Insumos (painel/histórico foram mesclados aqui) */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["contagens", `Contagens${nVivas > 0 ? " · ● ao vivo" : ""}`, LayoutDashboard],
          ["config",    `Insumos (${insumos.filter(i => i.ativo).length})`, Package],
        ] as const).map(([id, label, Ico]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}>
            <Ico size={15} /> {label}
          </button>
        ))}
        {canVer(me, rid, "compras") && (
          <Link to={`/r/${rid}/compras`} className="ml-auto self-center px-3 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 whitespace-nowrap">
            <Truck size={13} /> Ir para Compras →
          </Link>
        )}
      </div>

      {tab === "contagens" && (
        <div className="space-y-4">
          {/* Iniciar / continuar contagem — largura completa */}
          {podeConfig && (
            <button type="button" onClick={() => setContando(true)}
              className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold text-white transition-colors ${nVivas > 0 ? "bg-emerald-600 hover:bg-emerald-700" : "bg-indigo-600 hover:bg-indigo-700"}`}>
              {nVivas > 0 ? <><Radio size={17} className="animate-pulse" /> Continuar contagem ao vivo</> : <><Pencil size={17} /> Iniciar nova contagem</>}
            </button>
          )}

          {/* Painel (cards + maiores faltas expansível) */}
          <PainelContagensTab insumos={insumos} ultimaContagem={ultimaContagem} rid={rid} fornecedores={fornecedores} />

          {/* Histórico das contagens, linha a linha */}
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 inline-flex items-center gap-1.5 mb-2"><History size={15} /> Histórico de contagens</h3>
            <HistoricoContagensTab sessoes={sessoes} insumos={insumos} rid={rid} podeEditar={podeEditarContagem} onContinuar={() => setContando(true)} />
          </div>
        </div>
      )}
      {tab === "config" && <InsumosManager rid={rid} podeConfig={podeConfig} />}
    </PageContainer>
  );
}

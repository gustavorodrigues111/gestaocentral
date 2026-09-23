import { useEffect, useMemo, useState } from "react";
import { Pencil, LayoutDashboard, History, Lock, TriangleAlert, Package, Truck } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer, canConfigurar } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { todayYmd } from "../../core/utils/date";
import type { Contagem, ContagemSessao, Insumo } from "../../core/types";
import { LancarContagensTab } from "./LancarContagensTab";
import { PainelContagensTab } from "./PainelContagensTab";
import { HistoricoContagensTab } from "./HistoricoContagensTab";
import { InsumosManager } from "./InsumosManager";
import { PageContainer } from "../../core/ui/PageContainer";

type Tab = "lancar" | "painel" | "historico" | "config";

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

  const [tab, setTab] = useState<Tab>("lancar");
  const [data, setData] = useState(todayYmd());   // data/turno subidos (pra Histórico "continuar")
  const [turno, setTurno] = useState<string>("");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [contagens, setContagens] = useState<Contagem[]>([]);
  const [sessoes, setSessoes] = useState<ContagemSessao[]>([]);

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

  // Última contagem por insumo (mais recente).
  const ultimaContagem = useMemo(() => {
    const m: Record<string, Contagem> = {};
    for (const c of contagens) if (!m[c.insumoId]) m[c.insumoId] = c;   // contagens já vem desc
    return m;
  }, [contagens]);

  const alertasMinStock = useMemo(() => insumos.filter(i => {
    if (!i.ativo || !i.minStock) return false;
    const c = ultimaContagem[i.id];
    return (c?.qty ?? 0) < i.minStock;
  }), [insumos, ultimaContagem]);

  const nHistorico = useMemo(() => sessoes.filter(s => (s.status || "em_andamento") !== "em_andamento").length, [sessoes]);
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

  function irParaLancar(d: string, t: string) { setData(d); setTurno(t); setTab("lancar"); }

  return (
    <PageContainer>
      {alertasMinStock.length > 0 && tab !== "painel" && (
        <button type="button" onClick={() => setTab("painel")} className="w-full text-left rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300 mb-3 hover:bg-amber-100 dark:hover:bg-amber-900/30">
          <span className="inline-flex items-center gap-1"><TriangleAlert size={14} className="shrink-0" /> <strong>{alertasMinStock.length}</strong> insumo(s) abaixo do estoque mínimo. Ver no Painel →</span>
        </button>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["lancar",    <>Lançar contagem{nVivas > 0 ? <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400">● {nVivas} ao vivo</span> : null}</>, Pencil],
          ["painel",    <>Painel{alertasMinStock.length > 0 ? <> <span className="text-amber-600">({alertasMinStock.length})</span></> : null}</>, LayoutDashboard],
          ["historico", <>Histórico{nHistorico > 0 ? ` (${nHistorico})` : ""}</>, History],
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

      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2 mb-4">
        {tab === "lancar" && "Conte o estoque: percorra os insumos e digite a quantidade. Salva ao vivo; outras pessoas podem contar junto."}
        {tab === "painel" && "Foto da situação do estoque: o que está abaixo do mínimo, sem contagem, e a reposição estimada."}
        {tab === "historico" && "Contagens já feitas (e as ao vivo). Clique numa pra ver o detalhe — e editar, se tiver permissão."}
        {tab === "config" && "Cadastro dos insumos (nome, categoria, unidade, estoque mínimo, fornecedor). Base da contagem e da compra."}
      </p>

      {tab === "lancar" && (
        <LancarContagensTab insumos={insumos.filter(i => i.ativo)} ultimaContagem={ultimaContagem} restaurantId={rid} podeConfig={podeConfig}
          data={data} turno={turno} onData={setData} onTurno={setTurno} />
      )}
      {tab === "painel" && <PainelContagensTab insumos={insumos} ultimaContagem={ultimaContagem} rid={rid} />}
      {tab === "historico" && <HistoricoContagensTab sessoes={sessoes} insumos={insumos} rid={rid} podeEditar={podeEditarContagem} onContinuar={irParaLancar} />}
      {tab === "config" && <InsumosManager rid={rid} podeConfig={podeConfig} />}
    </PageContainer>
  );
}

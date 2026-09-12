import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Lock, Lightbulb, ClipboardList, Building2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import type { Contagem, Fornecedor, Insumo, Pedido } from "../../core/types";
import { FornecedoresTab } from "./FornecedoresTab";
import { SugestoesTab } from "./SugestoesTab";
import { PedidosTab } from "./PedidosTab";
import { PageContainer } from "../../core/ui/PageContainer";

type Tab = "sugestoes" | "pedidos" | "fornecedores";

export function ComprasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "compras");
  const podeConfig = canConfigurar(me, rid, "compras");

  const [tab, setTab] = useState<Tab>("sugestoes");
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [contagens, setContagens] = useState<Contagem[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "insumos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setInsumos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Insumo));
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "contagens"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Contagem);
      list.sort((a, b) => (b.data || "").localeCompare(a.data || "") || (b.registradoEm || "").localeCompare(a.registradoEm || ""));
      setContagens(list);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "fornecedores"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Fornecedor);
      list.sort((a, b) => a.nome.localeCompare(b.nome));
      setFornecedores(list);
    });
    return () => unsub();
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "pedidos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pedido);
      list.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
      setPedidos(list);
    });
    return () => unsub();
  }, [rid]);

  // Última contagem por insumo
  const ultimaContagem = useMemo(() => {
    const m: Record<string, Contagem> = {};
    for (const c of contagens) {
      if (!m[c.insumoId]) m[c.insumoId] = c;
    }
    return m;
  }, [contagens]);

  // Insumos com falta
  const insumosComFalta = useMemo(() => {
    return insumos.filter(i => {
      if (!i.ativo || !i.minStock) return false;
      const c = ultimaContagem[i.id];
      const qtd = c?.qty ?? 0;
      return qtd < i.minStock;
    });
  }, [insumos, ultimaContagem]);

  const pedidosAbertos = pedidos.filter(p =>
    p.status === "rascunho" || p.status === "aprovado" || p.status === "enviado"
  ).length;

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <PageContainer>
      {/* Stats topo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Insumos com falta</div>
          <div className={`text-2xl font-bold ${insumosComFalta.length > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
            {insumosComFalta.length}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Pedidos abertos</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{pedidosAbertos}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Fornecedores ativos</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fornecedores.filter(f => f.ativo).length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["sugestoes",    <span className="inline-flex items-center gap-1.5"><Lightbulb size={15} /> Sugestões{insumosComFalta.length > 0 ? ` (${insumosComFalta.length})` : ""}</span>],
          ["pedidos",      <span className="inline-flex items-center gap-1.5"><ClipboardList size={15} /> Pedidos ({pedidos.length})</span>],
          ["fornecedores", <span className="inline-flex items-center gap-1.5"><Building2 size={15} /> Fornecedores ({fornecedores.length})</span>],
        ] as [Tab, ReactNode][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "sugestoes" && (
        <SugestoesTab
          ultimaContagem={ultimaContagem}
          fornecedores={fornecedores}
          insumosComFalta={insumosComFalta}
          restaurantId={rid}
          podeConfig={podeConfig}
          onPedidoCriado={() => setTab("pedidos")}
        />
      )}
      {tab === "pedidos" && (
        <PedidosTab
          pedidos={pedidos}
          podeConfig={podeConfig}
        />
      )}
      {tab === "fornecedores" && (
        <FornecedoresTab
          fornecedores={fornecedores}
          restaurantId={rid}
          podeConfig={podeConfig}
        />
      )}

      {!fornecedores.length && tab === "sugestoes" && (
        <div className="mt-4 text-sm text-gray-500 italic">
          <Lightbulb size={13} className="inline align-[-2px] mr-1" />Pra criar pedidos automáticos, cadastre fornecedores na aba "Fornecedores" e
          vincule-os aos insumos no módulo Contagens (campo "Fornecedor preferencial").
        </div>
      )}

      {/* Avisos de fluxo */}
      {tab === "sugestoes" && fornecedores.length > 0 && insumosComFalta.length === 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center text-sm text-emerald-800 dark:text-emerald-300">
          ✓ Nenhum insumo abaixo do estoque mínimo. Tudo em ordem!
        </div>
      )}
      {tab === "sugestoes" && (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={() => setTab("pedidos")}>
            Ver pedidos →
          </Button>
        </div>
      )}
    </PageContainer>
  );
}

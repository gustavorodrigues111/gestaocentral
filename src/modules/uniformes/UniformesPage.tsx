// ════════════════════════════════════════════════════════════════════════════
//  Módulo Uniformes & EPIs — shell com 5 tabs.
//   🛍️ Itens          — catálogo + variações + estoque inicial
//   🧰 Kits por Área   — kit padrão por área (cargo.area) — base da admissão
//   📦 Estoque         — visão consolidada de saldo + ajustes
//   📋 Entregas        — lista cronológica + nova entrega + devolução
//   ⏳ Vencimentos     — itens entregues vencendo nos próximos N dias
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  collection, onSnapshot, query, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import { TabBadge } from "../../core/ui/TabBadge";
import type {
  EntregaUniforme, ItemUniforme, KitAreaUniforme,
} from "../../core/types";
import { itensProximosVencimento } from "../../core/uniformes/uniformesHelpers";
import { ItensTab } from "./ItensTab";
import { KitsAreaTab } from "./KitsAreaTab";
import { PorEmpregadoTab } from "./PorEmpregadoTab";

type TabId = "porEmpregado" | "estoque" | "config";

const TABS_DEF: { id: TabId; label: string; icon: string }[] = [
  { id: "porEmpregado", label: "Por empregado", icon: "👥" },
  { id: "estoque",      label: "Estoque",       icon: "📦" },
  { id: "config",       label: "Configurações", icon: "⚙️" },
];

const DIAS_ALERTA_VENCIMENTO = 30;

export function UniformesPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;

  const podeVer = canVer(me, rid, "uniformes" as never);
  const podeConfig = canConfigurar(me, rid, "uniformes" as never);

  const [tab, setTab] = useState<TabId>("porEmpregado");

  // ─── Carrega dados reativos ───
  const [itens, setItens] = useState<ItemUniforme[]>([]);
  const [kits, setKits] = useState<KitAreaUniforme[]>([]);
  const [entregas, setEntregas] = useState<EntregaUniforme[]>([]);

  useEffect(() => {
    if (!rid) return;
    const u1 = onSnapshot(
      query(collection(db, "itensUniforme"), where("restaurantId", "==", rid)),
      (snap) => setItens(snap.docs.map(d => ({ ...d.data(), id: d.id }) as ItemUniforme)),
    );
    const u2 = onSnapshot(
      query(collection(db, "kitsAreaUniforme"), where("restaurantId", "==", rid)),
      (snap) => setKits(snap.docs.map(d => ({ ...d.data(), id: d.id }) as KitAreaUniforme)),
    );
    const u3 = onSnapshot(
      query(collection(db, "entregasUniforme"), where("restaurantId", "==", rid)),
      (snap) => setEntregas(snap.docs.map(d => ({ ...d.data(), id: d.id }) as EntregaUniforme)),
    );
    return () => { u1(); u2(); u3(); };
  }, [rid]);

  // Contadores pros badges
  const countVencendo = useMemo(
    () => itensProximosVencimento(entregas, DIAS_ALERTA_VENCIMENTO).length,
    [entregas],
  );

  const badges: Record<TabId, number> = {
    porEmpregado: countVencendo,
    estoque: 0,
    config: 0,
  };

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {TABS_DEF.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
              }`}
            >
              {t.icon} {t.label}
              <TabBadge count={badges[t.id]} />
            </button>
          );
        })}
      </div>

      {tab === "porEmpregado" && me && (
        <PorEmpregadoTab
          itens={itens} kits={kits} entregas={entregas} restaurantId={rid}
          activeRestaurant={activeRestaurant} me={me} podeConfig={podeConfig}
        />
      )}
      {tab === "estoque" && me && (
        <ItensTab itens={itens} podeConfig={podeConfig} pessoa={me} restaurantId={rid} />
      )}
      {tab === "config" && me && (
        <div className="space-y-2">
          <div>
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">Kits por área</h2>
            <p className="text-[12px] text-gray-500 dark:text-gray-400">
              O kit da área é o <strong>mínimo</strong> de uniformes/EPIs dos cargos daquela área. Serve de base pra admissão e pro controle "Por empregado".
            </p>
          </div>
          <KitsAreaTab itens={itens} kits={kits} podeConfig={podeConfig} pessoa={me} restaurantId={rid} />
        </div>
      )}
    </div>
  );
}

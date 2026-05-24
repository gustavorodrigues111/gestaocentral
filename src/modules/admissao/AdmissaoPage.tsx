// ════════════════════════════════════════════════════════════════════════════
//  Módulo Admissão — shell com sub-tabs.
//    📋 Lista — pessoas em admissão (form de iniciar + cards)
//    🗂️ Kanban — visualização de fluxo
//    ⚙️ Configurações — prazo, WhatsApp DP, editor de schema
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { AdmissaoLista } from "./AdmissaoLista";
import { AdmissaoKanban } from "./AdmissaoKanban";
import { AdmissaoConfig } from "./AdmissaoConfig";
import { CandidaturasTab } from "./CandidaturasTab";
import type { Restaurant } from "../../core/types";
import { canConfigurar } from "../../core/auth/permissions";

type TabId = "lista" | "kanban" | "candidaturas" | "config";

const TABS_DEF: { id: TabId; label: string; icon: string }[] = [
  { id: "lista",        label: "Pessoas em admissão", icon: "📋" },
  { id: "kanban",       label: "Kanban",              icon: "🗂️" },
  { id: "candidaturas", label: "Candidaturas",        icon: "💼" },
  { id: "config",       label: "Configurações",       icon: "⚙️" },
];

export function AdmissaoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  // Listener no restaurante pra UI atualizar quando muda config (schema, prazo)
  const [activeRestaurant, setActiveRestaurant] = useState<Restaurant | null>(
    restaurants.find((r) => r.id === rid) || null,
  );
  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(doc(db, "restaurants", rid), (snap) => {
      if (snap.exists()) setActiveRestaurant({ id: snap.id, ...snap.data() } as Restaurant);
    });
    return () => unsub();
  }, [rid]);
  const podeVer = canVer(me, rid, "admissao");
  const podeConfig = canConfigurar(me, rid, "admissao");

  const [tab, setTab] = useState<TabId>("lista");

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
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
          🪪 Admissão
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {activeRestaurant.nome} · processo de admissão de novos empregados
        </p>
      </div>

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
            </button>
          );
        })}
      </div>

      {tab === "lista"        && <AdmissaoLista   rid={rid} activeRestaurant={activeRestaurant} />}
      {tab === "kanban"       && <AdmissaoKanban  rid={rid} activeRestaurant={activeRestaurant} />}
      {tab === "candidaturas" && <CandidaturasTab rid={rid} podeEditar={podeConfig} />}
      {tab === "config"       && <AdmissaoConfig  rid={rid} activeRestaurant={activeRestaurant} />}
    </div>
  );
}

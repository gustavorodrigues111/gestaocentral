import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { PessoasList } from "./PessoasList";
import { CargosTab } from "./CargosTab";
import { TemplatesTab } from "./TemplatesTab";

type Tab = "pessoas" | "cargos" | "templates";

export function PessoasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const [tab, setTab] = useState<Tab>("pessoas");
  const podeVer = canVer(me, rid, "pessoas");

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

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "pessoas",   label: "Pessoas",   icon: "👤" },
    { id: "cargos",    label: "Cargos",    icon: "🏷️" },
    { id: "templates", label: "Templates", icon: "🎯" },
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">👤 Pessoas</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{activeRestaurant.nome}</p>

      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "pessoas"   && <PessoasList   restaurantId={rid} />}
      {tab === "cargos"    && <CargosTab     restaurantId={rid} />}
      {tab === "templates" && <TemplatesTab  restaurantId={rid} />}
    </div>
  );
}

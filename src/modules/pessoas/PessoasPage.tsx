import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer, canAcao } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { PessoasList } from "./PessoasList";
import { CargosTab } from "./CargosTab";
import { AlteracoesTab } from "./AlteracoesTab";
import { EscalasTab } from "./EscalasTab";
import { ImportLoteHorariosModal } from "./ImportLoteHorariosModal";

// Tab "🎯 Templates" foi removida — templates de permissão eram do sistema
// antigo (presets de ver/configurar pra clonar). Substituído pela Pagina
// /perfis (master only) onde se cria perfis reutilizáveis.
type Tab = "pessoas" | "cargos" | "escalas" | "alteracoes";

export function PessoasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const [tab, setTab] = useState<Tab>("pessoas");
  const [showImportHorarios, setShowImportHorarios] = useState(false);
  const podeVer = canVer(me, rid, "pessoas");
  const podeEscalas = canAcao(me, rid, "escala", "configurarEscalas");
  const isMaster = !!me?.isMaster;

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
    { id: "pessoas",    label: "Pessoas",    icon: "👤" },
    { id: "cargos",     label: "Cargos",     icon: "🏷️" },
    ...(podeEscalas ? [{ id: "escalas" as Tab, label: "Escalas", icon: "📆" }] : []),
    { id: "alteracoes", label: "Alterações", icon: "📋" },
  ];

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div />
        {/* PROVISÓRIO — botão master pra importar horários em lote (migração
            do AppTip pro Planejamento). Remover quando não precisar mais. */}
        {isMaster && (
          <Button variant="secondary" size="sm" onClick={() => setShowImportHorarios(true)}>
            🧪 Importar horários (lote)
          </Button>
        )}
      </div>

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

      {tab === "pessoas"    && <PessoasList    restaurantId={rid} />}
      {tab === "cargos"     && <CargosTab      restaurantId={rid} />}
      {tab === "escalas"    && podeEscalas && <EscalasTab restaurantId={rid} />}
      {tab === "alteracoes" && <AlteracoesTab  restaurantId={rid} />}

      {showImportHorarios && (
        <ImportLoteHorariosModal
          restaurantId={rid}
          onClose={() => setShowImportHorarios(false)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  Registros de Ponto — shell com abas. Centraliza tudo relacionado a ponto
//  (Sólides/Tangerino) num módulo só. Abas atuais:
//    1. Inconformidades — cruzamento ponto × escala (era "Relatório de Exceções")
//    2. Compatibilidade de Cadastros — divergências entre horários Sólides
//       vs Planejamento (stub)
//
//  O id de módulo nas permissões/Firestore continua sendo "excecoes" pra não
//  quebrar quem já tem permissão / status de semana persistido.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { InconformidadesTab } from "./InconformidadesTab";
import { CompatibilidadeTab } from "./CompatibilidadeTab";
import { AjustesEscalaTab } from "./AjustesEscalaTab";
import { ResumoMesTab } from "./ResumoMesTab";
import { PageContainer } from "../../core/ui/PageContainer";
import type { LucideIcon } from "lucide-react";
import { TriangleAlert, Wrench, IdCard, BarChart3, Lock } from "lucide-react";

type TabId = "inconformidades" | "ajustes" | "compatibilidade" | "resumo";

const TABS_DEF: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "inconformidades", label: "Inconformidades",              icon: TriangleAlert },
  { id: "ajustes",         label: "Apontamentos de Escala",       icon: Wrench },
  { id: "compatibilidade", label: "Compatibilidade de cadastros", icon: IdCard },
  { id: "resumo",          label: "Resumo do mês",                icon: BarChart3 },
];

export function RegistrosPontoPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find((r) => r.id === rid) || null;
  const podeVer = canVer(me, rid, "excecoes");

  const [tab, setTab] = useState<TabId>("inconformidades");

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3"><Lock size={36} className="text-gray-400"/></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {TABS_DEF.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                active
                  ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                  : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
              }`}
            >
              <t.icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "inconformidades" && (
        <InconformidadesTab rid={rid} activeRestaurant={activeRestaurant} />
      )}
      {tab === "ajustes" && <AjustesEscalaTab rid={rid} />}
      {tab === "compatibilidade" && <CompatibilidadeTab rid={rid} />}
      {tab === "resumo" && <ResumoMesTab rid={rid} />}
    </PageContainer>
  );
}

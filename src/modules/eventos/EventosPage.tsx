import { useEffect, useState } from "react";
import { Lock, ClipboardList, Package, Briefcase, Settings } from "lucide-react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse, canConfig } from "../../core/auth/permissions";
import { EspacoConfigTab } from "./EspacoConfigTab";
import { PacotesTab } from "./PacotesTab";
import { KanbanTab } from "./KanbanTab";
import { ComercialConfigTab } from "./ComercialConfigTab";
import { TabBadge } from "../../core/ui/TabBadge";
import { PageContainer } from "../../core/ui/PageContainer";

type Tab = "kanban" | "pacotes" | "comercial" | "config";

// Página esqueleto do módulo Eventos.
// PR1: rota + permissão.
// PR2 (atual): tab Configurações com cadastro de Espaço.
// PR3+: Pacotes, Kanban, Card do Lead, Proposta, Pagamento, BEO, Templates.
export function EventosPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "eventos");
  const podeConfigurar = canConfig(me, rid, "eventos");

  const [tab, setTab] = useState<Tab>("kanban");

  // Badge "novos leads" no Kanban — leads com status "novo" precisam triagem
  const [novosLeads, setNovosLeads] = useState(0);
  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(
      query(
        collection(db, "leadsEvento"),
        where("restaurantId", "==", rid),
        where("status", "==", "novo"),
      ),
      (snap) => setNovosLeads(snap.size),
    );
    return () => unsub();
  }, [rid]);

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Peça pro administrador habilitar o módulo Eventos pra você.
        </p>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <TabButton active={tab === "kanban"} onClick={() => setTab("kanban")}><span className="inline-flex items-center gap-1.5"><ClipboardList size={15} /> Kanban</span><TabBadge count={novosLeads} /></TabButton>
        <TabButton active={tab === "pacotes"} onClick={() => setTab("pacotes")}><span className="inline-flex items-center gap-1.5"><Package size={15} /> Pacotes</span></TabButton>
        {podeConfigurar && (
          <TabButton active={tab === "comercial"} onClick={() => setTab("comercial")}><span className="inline-flex items-center gap-1.5"><Briefcase size={15} /> Comercial</span></TabButton>
        )}
        {podeConfigurar && (
          <TabButton active={tab === "config"} onClick={() => setTab("config")}><span className="inline-flex items-center gap-1.5"><Settings size={15} /> Configurações</span></TabButton>
        )}
      </div>

      {tab === "kanban" && (
        <KanbanTab rid={rid} podeEditar={podeConfigurar} />
      )}

      {tab === "pacotes" && (
        <PacotesTab rid={rid} podeEditar={podeConfigurar} />
      )}

      {tab === "comercial" && podeConfigurar && (
        <ComercialConfigTab rid={rid} />
      )}

      {tab === "config" && podeConfigurar && (
        <EspacoConfigTab rid={rid} podeEditar={podeConfigurar} />
      )}
    </PageContainer>
  );
}

function TabButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
          : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
      }`}
    >
      {children}
    </button>
  );
}

import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { GeralTab } from "./GeralTab";
import { PreviewTab } from "./PreviewTab";

type Tab = "geral" | "cardapio" | "preview";

// Módulo Sites — controla o site público do restaurante.
// Tabs:
//   📝 Geral       (Fase 2): história, contato, redes, flags, tema
//   📋 Cardápio    (Fase 4): PDFs PT/EN
//   👁️ Preview     (Fase 6): site público renderizado
//
// Horários (semana + datas especiais) foram movidos pro módulo dedicado
// "Horários" — mesmos dados, mesma source of truth (sitesConfig.horarios +
// sitesConfig.excecoes), mas a UI vive lá pra unificar com janelas de reserva.
//
// Form Trabalhe Conosco → criado a partir do site público, mas as
// candidaturas são gerenciadas em /r/:rid/admissao → tab Candidaturas
// (módulo dedicado já existente, evita confusão de escopo).
export function SitesPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "sites");

  // Permissões granulares — sistema novo de perfis. Mantém specialPermissions
  // como fallback pra retrocompat de configs antigas.
  const { can } = useCanAcao(rid);
  const special = me?.specialPermissions?.[rid];
  const podeCardapio = !!me?.isMaster || can("sites", "uploadCardapio")
    || !!special?.sitesCardapio;
  // "Geral" = pode mexer em qualquer parte editorial (textos, contato, tema, assets)
  const podeGeral = !!me?.isMaster
    || can("sites", "editarTextos") || can("sites", "editarContato")
    || can("sites", "editarTema") || can("sites", "uploadAssets")
    || !!special?.sitesGeral;

  const [tab, setTab] = useState<Tab>("geral");

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Peça pro administrador habilitar o módulo Sites pra você.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto py-4 space-y-4">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        <TabButton active={tab === "geral"} onClick={() => setTab("geral")} disabled={!podeGeral}>
          📝 Geral
        </TabButton>
        <TabButton active={tab === "cardapio"} onClick={() => setTab("cardapio")} disabled={!podeCardapio}>
          📋 Cardápio
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          👁️ Preview
        </TabButton>
      </div>

      {/* Conteúdo */}
      {tab === "geral" && (
        <GeralTab
          rid={rid}
          nomeRestaurante={activeRestaurant.nome}
          podeEditar={podeGeral}
          podeEditarTextos={!!me?.isMaster || can("sites", "editarTextos") || !!special?.sitesGeral}
          podeEditarContato={!!me?.isMaster || can("sites", "editarContato") || !!special?.sitesGeral}
          podeEditarTema={!!me?.isMaster || can("sites", "editarTema") || !!special?.sitesGeral}
          podeUploadAssets={!!me?.isMaster || can("sites", "uploadAssets") || !!special?.sitesGeral}
          podePublicar={!!me?.isMaster || can("sites", "publicar") || !!special?.sitesGeral}
        />
      )}
      {tab === "cardapio" && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-6 text-center space-y-2">
          <div className="text-3xl">📋</div>
          <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">O cardápio agora é editado no módulo <strong>Cardápio</strong></div>
          <p className="text-[13px] text-indigo-700 dark:text-indigo-300 max-w-md mx-auto">Lá você escolhe entre montar item a item ou subir um PDF — e o site puxa daqui, do mesmo jeito. Abra o módulo <strong>Cardápio</strong> no menu lateral.</p>
        </div>
      )}
      {tab === "preview" && (
        <PreviewTab rid={rid} nomeRestaurante={activeRestaurant.nome} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, disabled, children }: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
          : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      {children}
    </button>
  );
}


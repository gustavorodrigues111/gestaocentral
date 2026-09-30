import { useState } from "react";
import { Lock, SquarePen, ClipboardList, Eye, Globe, Sparkles, MousePointerClick } from "lucide-react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse } from "../../core/auth/permissions";
import { useCanAcao } from "../../core/auth/useCanAcao";
import { GeralTab } from "./GeralTab";
import { PreviewTab } from "./PreviewTab";
import { ConexaoTab } from "./ConexaoTab";
import { EditarVisualTab } from "./EditarVisualTab";
import { SiteIAAssistant } from "./SiteIAAssistant";
import { LivePreviewPanel } from "./LivePreviewPanel";
import { PageContainer } from "../../core/ui/PageContainer";

type Tab = "geral" | "editar" | "conexao" | "cardapio" | "preview";

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
  // Conectar domínio é ação sensível — publicar/master.
  const podeConectar = !!me?.isMaster || can("sites", "publicar") || !!special?.sitesGeral;

  const [tab, setTab] = useState<Tab>("geral");
  const [iaOpen, setIaOpen] = useState(false);

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (!podeUsar) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="flex justify-center mb-3 text-gray-400"><Lock size={40} /></div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Peça pro administrador habilitar o módulo Sites pra você.
        </p>
      </div>
    );
  }

  return (
    <PageContainer className="space-y-4">
      {/* Tabs + Assistente IA */}
      <div className="flex items-center border-b border-gray-200 dark:border-gray-800 overflow-x-auto gap-1">
        <TabButton active={tab === "geral"} onClick={() => setTab("geral")} disabled={!podeGeral}>
          <span className="inline-flex items-center gap-1.5"><SquarePen size={15} /> Geral</span>
        </TabButton>
        <TabButton active={tab === "editar"} onClick={() => setTab("editar")} disabled={!podeGeral}>
          <span className="inline-flex items-center gap-1.5"><MousePointerClick size={15} /> Editar (visual)</span>
        </TabButton>
        <TabButton active={tab === "conexao"} onClick={() => setTab("conexao")}>
          <span className="inline-flex items-center gap-1.5"><Globe size={15} /> Conexão do site</span>
        </TabButton>
        <TabButton active={tab === "cardapio"} onClick={() => setTab("cardapio")} disabled={!podeCardapio}>
          <span className="inline-flex items-center gap-1.5"><ClipboardList size={15} /> Cardápio</span>
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          <span className="inline-flex items-center gap-1.5"><Eye size={15} /> Preview</span>
        </TabButton>
        <div className="flex-1" />
        {podeGeral && (
          <button onClick={() => setIaOpen(true)} className="shrink-0 mb-1 ml-2 h-8 px-3 rounded-lg text-white text-[12.5px] font-bold inline-flex items-center gap-1.5" style={{ background: "linear-gradient(90deg,#6d5efc,#9b6bff)" }}>
            <Sparkles size={14} /> Assistente IA
          </button>
        )}
      </div>

      {/* Conteúdo — Geral com preview ao vivo lado a lado (telas largas) */}
      {tab === "geral" && (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5 items-start">
          <div className="min-w-0">
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
          </div>
          <div className="hidden xl:block">
            <LivePreviewPanel rid={rid} nomeRestaurante={activeRestaurant.nome} />
          </div>
        </div>
      )}
      {tab === "editar" && (
        <EditarVisualTab rid={rid} nomeRestaurante={activeRestaurant.nome} podeEditar={podeGeral} />
      )}
      {tab === "conexao" && (
        <ConexaoTab rid={rid} nomeRestaurante={activeRestaurant.nome} podeEditar={podeConectar} />
      )}
      {tab === "cardapio" && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-6 text-center space-y-2">
          <div className="flex justify-center text-indigo-500"><ClipboardList size={30} /></div>
          <div className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">O cardápio agora é editado no módulo <strong>Cardápio</strong></div>
          <p className="text-[13px] text-indigo-700 dark:text-indigo-300 max-w-md mx-auto">Lá você escolhe entre montar item a item ou subir um PDF — e o site puxa daqui, do mesmo jeito. Abra o módulo <strong>Cardápio</strong> no menu lateral.</p>
        </div>
      )}
      {tab === "preview" && (
        <PreviewTab rid={rid} nomeRestaurante={activeRestaurant.nome} />
      )}

      {iaOpen && <SiteIAAssistant rid={rid} nomeRestaurante={activeRestaurant.nome} onClose={() => setIaOpen(false)} />}
    </PageContainer>
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


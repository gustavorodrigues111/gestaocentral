import { useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canUse, canConfig } from "../../core/auth/permissions";
import { GeralTab } from "./GeralTab";

type Tab = "geral" | "horarios" | "cardapio" | "candidaturas" | "preview";

// Página esqueleto do módulo Sites — Fase 1.
// As tabs ficam vazias até as próximas fases:
//   Fase 2: Geral (história, contato, redes, flags, tema)
//   Fase 3: Horários (padrão + exceções)
//   Fase 4: Cardápio (PDFs PT+EN)
//   Fase 5: Candidaturas (form Trabalhe Conosco)
//   Fase 6: Preview (esqueleto do site público)
export function SitesPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const podeUsar = canUse(me, rid, "sites");
  const podeConfigurar = canConfig(me, rid, "sites");

  // Permissões granulares
  const special = me?.specialPermissions?.[rid];
  const podeCardapio = !!me?.isMaster || podeConfigurar || !!special?.sitesCardapio;
  const podeGeral = !!me?.isMaster || podeConfigurar || !!special?.sitesGeral;

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            🌐 Sites
            <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              em desenvolvimento
            </span>
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Site público de {activeRestaurant.nome}: história, horário, cardápio, formulários.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 overflow-x-auto">
        <TabButton active={tab === "geral"} onClick={() => setTab("geral")} disabled={!podeGeral}>
          📝 Geral
        </TabButton>
        <TabButton active={tab === "horarios"} onClick={() => setTab("horarios")} disabled={!podeGeral}>
          🕒 Horários
        </TabButton>
        <TabButton active={tab === "cardapio"} onClick={() => setTab("cardapio")} disabled={!podeCardapio}>
          📋 Cardápio
        </TabButton>
        <TabButton active={tab === "candidaturas"} onClick={() => setTab("candidaturas")} disabled={!podeGeral}>
          💼 Candidaturas
        </TabButton>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          👁️ Preview
        </TabButton>
      </div>

      {/* Conteúdo */}
      {tab === "geral" && (
        <GeralTab rid={rid} nomeRestaurante={activeRestaurant.nome} podeEditar={podeGeral} />
      )}
      {tab === "horarios" && <PlaceholderTab fase={3} titulo="Horários" descricao="Horário padrão da semana + exceções pontuais (feriados, eventos especiais). Compartilhado com módulo Reservas." />}
      {tab === "cardapio" && <PlaceholderTab fase={4} titulo="Cardápio" descricao="Upload de PDF — 2 versões (português + inglês). Substitui automaticamente no site público." />}
      {tab === "candidaturas" && <PlaceholderTab fase={5} titulo="Candidaturas Trabalhe Conosco" descricao="Lista de candidatos vindos do form público do site. Triagem antes do processo formal de admissão." />}
      {tab === "preview" && <PlaceholderTab fase={6} titulo="Preview do site público" descricao="Renderiza o site como o cliente vai ver, lendo do conteúdo configurado nas outras tabs." />}
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

function PlaceholderTab({ fase, titulo, descricao }: { fase: number; titulo: string; descricao: string }) {
  return (
    <div className="rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 p-4 text-sm text-indigo-900 dark:text-indigo-200">
      <p className="font-semibold mb-1">🚧 {titulo} (Fase {fase})</p>
      <p className="text-[13px] opacity-90">{descricao}</p>
    </div>
  );
}

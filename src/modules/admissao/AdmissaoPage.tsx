// ════════════════════════════════════════════════════════════════════════════
//  Módulo Admissão — shell com sub-tabs.
//    🗂️ Kanban — visualização interativa do fluxo + "+ Nova admissão"
//    💼 Candidaturas — candidatos vindos do form público de "Trabalhe Conosco"
//    ⚙️ Configurações — prazo, WhatsApp DP, editor de schema, layout do Kanban
//
//  Aba "Pessoas em admissão" foi removida — toda gestão acontece no Kanban
//  (drag-drop, botões ◀▶ no card, click pra abrir checklist).
//
//  TODO: O arquivo AdmissaoLista.tsx ainda existe no repo porque tem ações
//  que ainda não foram migradas pro Kanban (cancelar admissão, reabrir,
//  concluir/criar empregado, estender prazo, reenviar link). Em commits
//  futuros essas ações vêm pro card / drawer.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canVer } from "../../core/auth/permissions";
import { AdmissaoKanban } from "./AdmissaoKanban";
import { AdmissaoConfig } from "./AdmissaoConfig";
import { CandidaturasTab } from "./CandidaturasTab";
import { AdmissoesFinalizadas } from "./AdmissoesFinalizadas";
import type { Restaurant } from "../../core/types";
import { canConfigurar } from "../../core/auth/permissions";
import { TabBadge } from "../../core/ui/TabBadge";

type TabId = "kanban" | "candidaturas" | "finalizadas" | "config";

const TABS_DEF: { id: TabId; label: string; icon: string }[] = [
  { id: "kanban",       label: "Kanban",        icon: "🗂️" },
  { id: "candidaturas", label: "Candidaturas",  icon: "💼" },
  { id: "finalizadas",  label: "Finalizadas",   icon: "📦" },
  { id: "config",       label: "Configurações", icon: "⚙️" },
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

  const [tab, setTab] = useState<TabId>("kanban");

  // Contagens pra badges nas tabs:
  // - Lista/Kanban: admissões ainda em curso (não concluídas/canceladas)
  // - Candidaturas: candidaturas com status "nova" (recém recebidas)
  const [countAdmissoesAtivas, setCountAdmissoesAtivas] = useState(0);
  const [countCandidaturasNovas, setCountCandidaturasNovas] = useState(0);
  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(
      query(collection(db, "admissoes"), where("restaurantId", "==", rid)),
      (snap) => {
        const ativas = snap.docs.filter(d => {
          const data = d.data() as { status?: string; finalizadoEm?: string };
          if (data.finalizadoEm) return false;
          return data.status && data.status !== "concluida" && data.status !== "cancelada";
        }).length;
        setCountAdmissoesAtivas(ativas);
      },
    );
    return () => unsub();
  }, [rid]);
  useEffect(() => {
    if (!rid) return;
    const unsub = onSnapshot(
      query(
        collection(db, "candidaturasTrabalhe"),
        where("restaurantId", "==", rid),
        where("status", "==", "nova"),
      ),
      (snap) => setCountCandidaturasNovas(snap.size),
    );
    return () => unsub();
  }, [rid]);

  const badges: Record<TabId, number> = {
    kanban: countAdmissoesAtivas,
    candidaturas: countCandidaturasNovas,
    finalizadas: 0,
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
              <TabBadge count={badges[t.id]} />
            </button>
          );
        })}
      </div>

      {tab === "kanban"       && <AdmissaoKanban  rid={rid} activeRestaurant={activeRestaurant} />}
      {tab === "candidaturas" && <CandidaturasTab rid={rid} podeEditar={podeConfig} />}
      {tab === "finalizadas"  && <AdmissoesFinalizadas rid={rid} />}
      {tab === "config"       && <AdmissaoConfig  rid={rid} activeRestaurant={activeRestaurant} />}
    </div>
  );
}

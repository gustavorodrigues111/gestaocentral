import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfigurar, canVer } from "../../core/auth/permissions";
import type { Salao } from "../../core/types";
import { HorariosTab } from "../sites/HorariosTab";
import { JanelasTab } from "../reservas/JanelasTab";

type Tab = "funcionamento" | "janelas";

// Módulo "Horários" — fonte da verdade pra horário semanal + datas
// especiais + janelas de reserva. Reúne, num só lugar, o que antes vivia
// dividido entre Sites > Horários e Reservas > Janelas.
//
// IMPORTANTE: os DADOS continuam onde sempre estiveram (sitesConfig.horarios
// + sitesConfig.excecoes pra horário; configReservas.janelas pra reservas).
// Este módulo só reúne a UI. Futuramente, dá pra mover os dados pra uma
// coleção dedicada `configHorarios` sem mexer no que tá usando.
export function HorariosPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  const podeVer = canVer(me, rid, "horarios");
  const podeConfig = canConfigurar(me, rid, "horarios");

  const [tab, setTab] = useState<Tab>("funcionamento");

  // Salões — usados pelo JanelasTab e pelas exceções no HorariosTab
  const [saloes, setSaloes] = useState<Salao[]>([]);
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "saloes"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Salao);
      list.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));
      setSaloes(list);
    });
    return () => unsub();
  }, [rid]);

  if (!restaurant) return <div className="text-gray-500">Selecione um restaurante.</div>;
  if (!podeVer) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">Sem permissão</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {([
          ["funcionamento", "📆 Funcionamento + Datas especiais"],
          ["janelas",       `🎫 Janelas de Reserva (${saloes.filter(s => s.ativo).length} ${saloes.filter(s => s.ativo).length === 1 ? "salão" : "salões"})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "funcionamento" && (
        <HorariosTab rid={rid} nomeRestaurante={restaurant.nome} podeEditar={podeConfig} />
      )}

      {tab === "janelas" && me && (
        <JanelasTab restaurantId={rid} podeConfig={podeConfig} pessoaId={me.id} saloes={saloes} />
      )}
    </div>
  );
}

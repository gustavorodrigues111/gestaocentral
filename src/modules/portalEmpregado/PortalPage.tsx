import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { Cargo, Empregado } from "../../core/types";
import { MinhaEscalaTab } from "./MinhaEscalaTab";
import { MinhasGorjetasTab } from "./MinhasGorjetasTab";

type Tab = "escala" | "gorjetas" | "comunicados";

export function PortalPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;

  const [empregado, setEmpregado] = useState<Empregado | null>(null);
  const [cargos, setCargos] = useState<Cargo[]>([]);
  const [loading, setLoading] = useState(true);

  // Empregado da pessoa logada nesse restaurante
  useEffect(() => {
    if (!rid || !pessoa?.id) return;
    setLoading(true);
    const q = query(
      collection(db, "empregados"),
      where("restaurantId", "==", rid),
      where("pessoaId", "==", pessoa.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Empregado);
      setEmpregado(list[0] || null);
      setLoading(false);
    });
    return () => unsub();
  }, [rid, pessoa?.id]);

  // Cargos do restaurante (pra resolver nome do cargo do empregado)
  useEffect(() => {
    if (!rid) return;
    const q = query(collection(db, "cargos"), where("restaurantId", "==", rid));
    const unsub = onSnapshot(q, (snap) => {
      setCargos(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cargo));
    });
    return () => unsub();
  }, [rid]);

  // Toggles do portal por restaurante (default true se não definido)
  const portalConfig = restaurant?.portalEmpregado || {};
  const verEscala      = portalConfig.escala !== false;
  const verGorjetas    = portalConfig.gorjetas !== false;
  const verComunicados = portalConfig.comunicados !== false;

  // Tabs disponíveis (filtradas pela config)
  const tabsDisponiveis: { id: Tab; label: string; icon: string }[] = [
    ...(verEscala      ? [{ id: "escala" as const,      label: "Minha escala",     icon: "📅" }] : []),
    ...(verGorjetas    ? [{ id: "gorjetas" as const,    label: "Minhas gorjetas",  icon: "💸" }] : []),
    ...(verComunicados ? [{ id: "comunicados" as const, label: "Comunicados",      icon: "📣" }] : []),
  ];

  const [tab, setTab] = useState<Tab>(tabsDisponiveis[0]?.id || "escala");
  // Re-sync se primeira aba mudar (ex: config trocou)
  useEffect(() => {
    if (!tabsDisponiveis.find(t => t.id === tab) && tabsDisponiveis[0]) {
      setTab(tabsDisponiveis[0].id);
    }
  }, [tabsDisponiveis, tab]);

  if (!restaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }
  if (loading) {
    return <div className="text-sm text-gray-500">Carregando...</div>;
  }
  if (!empregado) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🤷</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Você não é equipe deste restaurante
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          O Portal do Empregado é exclusivo pra quem tem vínculo de empregado.
        </p>
      </div>
    );
  }

  if (tabsDisponiveis.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Portal desabilitado
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Nenhuma seção do portal está habilitada pra este restaurante. Peça pro DP ativar.
        </p>
      </div>
    );
  }

  const cargo = cargos.find(c => c.id === empregado.cargoId);

  return (
    <div className="max-w-5xl">
      {/* Cabeçalho personalizado */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
          👤 {empregado.nome.split(" ")[0]}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {restaurant.nome}
          {cargo && <> · {cargo.nome} ({cargo.area})</>}
          {empregado.admissaoAtual && <> · admitido em {empregado.admissaoAtual}</>}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-6 overflow-x-auto">
        {tabsDisponiveis.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "escala"      && verEscala      && <MinhaEscalaTab     empregado={empregado} cargo={cargo || null} restaurantId={rid} />}
      {tab === "gorjetas"    && verGorjetas    && <MinhasGorjetasTab  empregado={empregado} restaurantId={rid} />}
      {tab === "comunicados" && verComunicados && <ComunicadosPlaceholder />}
    </div>
  );
}

function ComunicadosPlaceholder() {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
      <div className="text-4xl mb-3">📣</div>
      <p className="text-gray-700 dark:text-gray-300 font-medium">Comunicados</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
        Em breve — o módulo Comunicados ainda não foi implementado. Avisos do restaurante
        aparecerão aqui quando estiver pronto (Sprint 19).
      </p>
    </div>
  );
}

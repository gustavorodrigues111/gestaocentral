import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import type { Cargo, Empregado } from "../../core/types";
import { MinhaEscalaTab } from "./MinhaEscalaTab";
import { MeusHorariosTab } from "./MeusHorariosTab";
import { MinhasGorjetasTab } from "./MinhasGorjetasTab";
import { ComunicadosTab } from "./ComunicadosTab";

type Tab = "escala" | "horarios" | "gorjetas" | "comunicados";

export function PortalPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const restaurant = restaurants.find(r => r.id === rid) || null;
  // useCanAcao resolve perfis built-in + custom corretamente.
  const { can } = useCanAcao(rid);

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

  // Quais seções a pessoa pode ver. Decidido pelo perfil de acesso (módulo
  // "portalEmpregado" do ActionCatalog). Empregado sem perfil não vê nenhuma.
  // O toggle legado restaurant.portalEmpregado foi DESCONTINUADO — tudo via
  // perfil agora (briefing v2: pessoa nasce sem acessos, perfil concede).
  const verEscala      = !!(pessoa && rid && can("portalEmpregado", "verMinhaEscala"));
  const verHorarios    = !!(pessoa && rid && can("portalEmpregado", "verMeusHorarios"));
  const verGorjetas    = !!(pessoa && rid && can("portalEmpregado", "verMinhaGorjeta"));
  const verComunicados = !!(pessoa && rid && can("portalEmpregado", "verComunicados"));
  const podeAcessarPortal = !!(pessoa && rid && can("portalEmpregado", "acessar"));

  // Tabs disponíveis (filtradas pelas permissões). Cada seção do portal
  // tem ação própria no actionCatalog — master ativa/desativa por perfil.
  const tabsDisponiveis: { id: Tab; label: string; icon: string }[] = [
    ...(verEscala      ? [{ id: "escala" as const,      label: "Minha escala",     icon: "📅" }] : []),
    ...(verHorarios    ? [{ id: "horarios" as const,    label: "Meus horários",    icon: "🕐" }] : []),
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
  // 1º gate: sem perfil que conceda "acessar", bloqueia antes de ler dados
  if (!podeAcessarPortal) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Sem acesso ao Portal do Empregado
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Seu perfil de acesso não inclui o Portal do Empregado neste restaurante.
          Peça pro administrador atribuir o perfil <strong>Portal do Empregado</strong> pra você.
        </p>
      </div>
    );
  }
  // 2º gate: tem perfil, mas não está cadastrado como empregado (sem vínculo
  // operacional — as views de escala/gorjeta dependem do empregadoId)
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
  // 3º gate: tem acesso ao portal, é equipe, mas o perfil não habilita
  // nenhuma sub-seção. Caso raro — só se master criou um perfil custom
  // que tem "acessar" mas tira todas as views.
  if (tabsDisponiveis.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          Portal sem seções liberadas
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Seu perfil concede acesso ao portal, mas nenhuma seção (escala,
          horários, gorjeta…) está habilitada. Peça pro admin revisar.
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
      {tab === "horarios"    && verHorarios    && <MeusHorariosTab    empregado={empregado} cargo={cargo || null} />}
      {tab === "gorjetas"    && verGorjetas    && <MinhasGorjetasTab  empregado={empregado} restaurantId={rid} />}
      {tab === "comunicados" && verComunicados && <ComunicadosTab empregado={empregado} cargo={cargo || null} restaurantId={rid} />}
    </div>
  );
}

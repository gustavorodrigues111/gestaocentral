import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { useCanAcao } from "../../core/auth/useCanAcao";
import type { Cargo, Empregado } from "../../core/types";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Clock, Coins, Megaphone, MessagesSquare, Lock, SearchX } from "lucide-react";
import { MinhaEscalaTab } from "./MinhaEscalaTab";
import { MeusHorariosTab } from "./MeusHorariosTab";
import { MinhasGorjetasTab } from "./MinhasGorjetasTab";
import { ComunicadosTab } from "./ComunicadosTab";
import { FaleComDPTab } from "./FaleComDPTab";

type Tab = "escala" | "horarios" | "gorjetas" | "comunicados" | "faleDp";

export function PortalPage() {
  const { pessoa } = useAuth();
  const { restaurants } = useRestaurant();
  const { rid: ridParam, tab: tabParam } = useParams<{ rid: string; tab: string }>();
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
  const verFaleDp      = !!(pessoa && rid && can("portalEmpregado", "acessarFaleComDP"));
  const podeAcessarPortal = !!(pessoa && rid && can("portalEmpregado", "acessar"));

  // Tabs disponíveis (filtradas pelas permissões). Cada seção do portal
  // tem ação própria no actionCatalog — master ativa/desativa por perfil.
  const tabsDisponiveis: { id: Tab; label: string; icon: LucideIcon }[] = [
    ...(verEscala      ? [{ id: "escala" as const,      label: "Minha escala",     icon: CalendarDays }] : []),
    ...(verHorarios    ? [{ id: "horarios" as const,    label: "Meus horários",    icon: Clock }] : []),
    ...(verGorjetas    ? [{ id: "gorjetas" as const,    label: "Minhas gorjetas",  icon: Coins }] : []),
    ...(verComunicados ? [{ id: "comunicados" as const, label: "Comunicados",      icon: Megaphone }] : []),
    ...(verFaleDp      ? [{ id: "faleDp" as const,      label: "Fale com DP",      icon: MessagesSquare }] : []),
  ];

  // Deep-link: /portal/:rid/:tab abre direto na aba (os módulos de Minhas
  // Informações no menu apontam pra cá). Sem :tab, cai na 1ª disponível.
  const TABS_VALIDAS: Tab[] = ["escala", "horarios", "gorjetas", "comunicados", "faleDp"];
  const tabInicial = (TABS_VALIDAS.includes(tabParam as Tab) ? (tabParam as Tab) : tabsDisponiveis[0]?.id) || "escala";
  const [tab, setTab] = useState<Tab>(tabInicial);
  // Segue o param da URL quando muda (clicar em outro módulo do menu).
  useEffect(() => {
    if (tabParam && TABS_VALIDAS.includes(tabParam as Tab)) setTab(tabParam as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabParam]);
  // Re-sync se a aba atual não estiver disponível (ex: permissão/config trocou)
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
        <div className="flex justify-center mb-3"><Lock size={36} className="text-gray-400"/></div>
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
        <div className="flex justify-center mb-3"><SearchX size={36} className="text-gray-400"/></div>
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
        <div className="flex justify-center mb-3"><Lock size={36} className="text-gray-400"/></div>
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
      {/* Sem barra de abas: a navegação vem dos módulos de Minhas Informações
          no menu lateral (cada um é deep-link pra uma seção). */}
      {tab === "escala"      && verEscala      && <MinhaEscalaTab     empregado={empregado} cargo={cargo || null} restaurantId={rid} />}
      {tab === "horarios"    && verHorarios    && <MeusHorariosTab    empregado={empregado} cargo={cargo || null} restaurantId={rid} />}
      {tab === "gorjetas"    && verGorjetas    && <MinhasGorjetasTab  empregado={empregado} restaurantId={rid} />}
      {tab === "comunicados" && verComunicados && <ComunicadosTab empregado={empregado} cargo={cargo || null} restaurantId={rid} />}
      {tab === "faleDp"      && verFaleDp      && <FaleComDPTab    empregado={empregado} cargo={cargo || null} restaurantId={rid} />}
    </div>
  );
}

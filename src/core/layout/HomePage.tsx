import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { AREA_INFO, modulesByArea } from "../../config/modules";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { canUse } from "../auth/permissions";
import { useCanAcao } from "../auth/useCanAcao";
import { Button } from "../ui/Button";
import { ModuleBadge } from "../ui/ModuleBadge";
import { NewRestaurantModal } from "../../modules/configuracoes/NewRestaurantModal";
import type { ModuleArea, ModuleId } from "../types";

export function HomePage() {
  const { pessoa } = useAuth();
  const { activeRestaurant, setActiveId } = useRestaurant();
  const [showNewRest, setShowNewRest] = useState(false);
  const [params] = useSearchParams();
  const forcarCatalogo = params.get("catalogo") === "1";
  const isMaster = !!pessoa?.isMaster;
  const ridAtivo = activeRestaurant?.id || "";
  // useCanAcao já resolve perfis custom + built-ins. Usado pra decidir fallback
  // de landing — empregado-puro vai pro Portal do Empregado em vez do Gestor.
  const { can } = useCanAcao(ridAtivo);

  // Landing dinâmica baseada em permissão:
  //   1. Tem tarefas → Gestor de Tarefas (default histórico)
  //   2. Senão, tem portalEmpregado.acessar → Portal do Empregado
  //   3. Senão, fica no catálogo de módulos (esta página)
  if (activeRestaurant && pessoa && !forcarCatalogo) {
    // Tarefas virou módulo da seção "master" (ligável/desligável). Só faz
    // landing nele se estiver ATIVO no restaurante — senão cai no portal/catálogo.
    const tarefasLigado = (activeRestaurant.modulosAtivos || []).includes("tarefas");
    const podeTarefas = tarefasLigado && (isMaster || canUse(pessoa, activeRestaurant.id, "tarefas"));
    if (podeTarefas) {
      return <Navigate to={`/r/${activeRestaurant.id}/tarefas`} replace />;
    }
    const podePortal = can("portalEmpregado", "acessar");
    if (podePortal) {
      return <Navigate to={`/portal/${activeRestaurant.id}`} replace />;
    }
  }

  if (!activeRestaurant) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="text-5xl mb-4">🏠</div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          {isMaster ? "Nenhum restaurante cadastrado ainda" : "Nenhum restaurante"}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {isMaster
            ? "Cadastre o primeiro restaurante pra começar."
            : "Você ainda não tem acesso a nenhum restaurante. Peça pro administrador te dar acesso."}
        </p>
        {isMaster && (
          <Button onClick={() => setShowNewRest(true)} size="lg">+ Novo Restaurante</Button>
        )}
        {showNewRest && (
          <NewRestaurantModal
            onClose={() => setShowNewRest(false)}
            onCreated={(id) => setActiveId(id)}
          />
        )}
      </div>
    );
  }

  const rid = activeRestaurant.id;
  const modulosAtivos = activeRestaurant.modulosAtivos || [];

  function visibleModule(moduleId: ModuleId) {
    if (!pessoa) return false;
    if (pessoa.isMaster) return true;       // master vê tudo
    if (!modulosAtivos.includes(moduleId)) return false;
    return canUse(pessoa, rid, moduleId);
  }

  const areas: ModuleArea[] = ["ops", "dp", "fin", "inst"];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Restaurante</p>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{activeRestaurant.nome}</h1>
        {pessoa?.nome && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Olá, {pessoa.nome.split(" ")[0]}</p>
        )}
      </div>

      <div className="space-y-8">
        {areas.map(area => {
          const mods = modulesByArea(area).filter(m => !m.oculto && visibleModule(m.id));
          if (mods.length === 0) return null;
          const info = AREA_INFO[area];
          return (
            <section key={area}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ background: info.color }} />
                <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: info.color }}>
                  {info.label}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">— {info.desc}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {mods.map(m => {
                  const disabled = m.status !== "ativo";
                  const Card = (
                    <div className={`
                      relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800
                      rounded-xl p-4 transition-all
                      ${disabled ? "opacity-60" : "hover:shadow-md hover:-translate-y-0.5 cursor-pointer"}
                    `}>
                      {m.etapa && (
                        <div className="absolute top-2 right-2">
                          <ModuleBadge etapa={m.etapa} size="xs" />
                        </div>
                      )}
                      <div className="text-3xl mb-2">{m.icon}</div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{m.label}</div>
                      {m.desc && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{m.desc}</div>}
                      {m.status === "em-breve" && (
                        <div className="text-[10px] mt-2 text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider">
                          em breve
                        </div>
                      )}
                      {m.status === "planejado" && (
                        <div className="text-[10px] mt-2 text-gray-400 font-medium uppercase tracking-wider">
                          próximos sprints
                        </div>
                      )}
                    </div>
                  );
                  return disabled
                    ? <div key={m.id}>{Card}</div>
                    : <Link key={m.id} to={`/r/${rid}/${m.id}`}>{Card}</Link>;
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

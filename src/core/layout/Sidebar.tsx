import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { AREA_INFO, modulesByArea } from "../../config/modules";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { canUse } from "../auth/permissions";
import type { ModuleArea, ModuleId } from "../types";

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const modulosAtivos = activeRestaurant?.modulosAtivos || [];

  // Pessoa logada é equipe deste restaurante? (tem empregado com pessoaId == ela)
  const [souEquipe, setSouEquipe] = useState(false);
  useEffect(() => {
    if (!rid || !pessoa?.id) { setSouEquipe(false); return; }
    const q = query(
      collection(db, "empregados"),
      where("restaurantId", "==", rid),
      where("pessoaId", "==", pessoa.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      setSouEquipe(snap.docs.length > 0);
    });
    return () => unsub();
  }, [rid, pessoa?.id]);

  function visibleModule(moduleId: ModuleId) {
    if (!rid) return false;
    if (!modulosAtivos.includes(moduleId)) return false;
    if (!pessoa) return false;
    if (pessoa.isMaster) return true;
    return canUse(pessoa, rid, moduleId);
  }

  const areas: ModuleArea[] = ["operacao", "time", "escritorio"];

  return (
    <>
      {/* Backdrop mobile */}
      <div
        className={`fixed inset-0 bg-black/40 z-30 md:hidden transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      <aside className={`
        fixed md:static inset-y-0 left-0 z-40
        w-60 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800
        flex flex-col overflow-y-auto
        transform transition-transform md:transform-none
        ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        <nav className="flex-1 p-3 space-y-4">
          <NavLink
            to="/"
            end
            onClick={onClose}
            className={({ isActive }) => `
              block px-3 py-2 rounded-lg text-sm font-medium
              ${isActive
                ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}
            `}
          >
            🏠 Início
          </NavLink>

          {souEquipe && rid && (
            <NavLink
              to={`/portal/${rid}`}
              onClick={onClose}
              className={({ isActive }) => `
                block px-3 py-2 rounded-lg text-sm font-medium
                ${isActive
                  ? "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}
              `}
            >
              👤 Meu Portal
            </NavLink>
          )}

          {pessoa?.isMaster && (
            <NavLink
              to="/arquitetura"
              onClick={onClose}
              className={({ isActive }) => `
                block px-3 py-2 rounded-lg text-sm font-medium
                ${isActive
                  ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"}
              `}
            >
              🏗️ Arquitetura
            </NavLink>
          )}

          {areas.map(area => {
            const mods = modulesByArea(area).filter(m => visibleModule(m.id));
            if (mods.length === 0) return null;
            const info = AREA_INFO[area];
            return (
              <div key={area}>
                <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: info.color }}>
                  {info.label}
                </div>
                <div className="space-y-0.5">
                  {mods.map(m => (
                    <NavLink
                      key={m.id}
                      to={rid ? `/r/${rid}/${m.id}` : "#"}
                      onClick={onClose}
                      className={({ isActive }) => `
                        flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                        ${isActive
                          ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}
                        ${m.status !== "ativo" ? "opacity-50" : ""}
                      `}
                    >
                      <span>{m.icon}</span>
                      <span>{m.label}</span>
                      {m.status === "em-breve" && <span className="ml-auto text-[9px] text-amber-600 dark:text-amber-400">em breve</span>}
                      {m.status === "planejado" && <span className="ml-auto text-[9px] text-gray-400">próx.</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

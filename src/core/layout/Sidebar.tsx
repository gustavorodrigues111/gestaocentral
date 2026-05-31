import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { AREA_INFO, modulesByArea } from "../../config/modules";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { canUse } from "../auth/permissions";
import { ModuleBadge } from "../ui/ModuleBadge";
import type { ModuleArea, ModuleId } from "../types";

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pessoa } = useAuth();
  const { activeRestaurant } = useRestaurant();
  const rid = activeRestaurant?.id;
  const modulosAtivos = activeRestaurant?.modulosAtivos || [];

  // Seções (grupos) colapsáveis — accordion. Persiste no localStorage.
  const [colapsadas, setColapsadas] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sidebar_colapsadas") || "[]") as string[]); }
    catch { return new Set(); }
  });
  function toggleArea(area: string) {
    setColapsadas(prev => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area); else next.add(area);
      localStorage.setItem("sidebar_colapsadas", JSON.stringify([...next]));
      return next;
    });
  }

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

  // Contador GLOBAL de tarefas pendentes do usuário (responsável OU co-resp).
  // Independente do restaurante selecionado — é caixa por usuário.
  const [tarefasPendentes, setTarefasPendentes] = useState(0);
  useEffect(() => {
    if (!pessoa?.id) { setTarefasPendentes(0); return; }
    const qResp = query(collection(db, "tarefas"), where("responsavelId", "==", pessoa.id));
    const qCo = query(collection(db, "tarefas"), where("coResponsaveis", "array-contains", pessoa.id));
    let lastResp: Array<{ status: string; deletadoEm?: string | null }> = [];
    let lastCo: Array<{ status: string; deletadoEm?: string | null }> = [];
    function recompute() {
      // Dedup por id seria mais correto, mas array-contains query não retorna
      // os mesmos docs do responsavelId — só intersecção é se a pessoa é AS
      // duas coisas na mesma tarefa, o que é raro. Sum-then-dedupe via Map.
      const map = new Map<string, { status: string; deletadoEm?: string | null }>();
      [...lastResp, ...lastCo].forEach((t, i) => map.set(String(i), t));
      const pend = Array.from(map.values()).filter(t =>
        !t.deletadoEm && t.status !== "concluida" && t.status !== "cancelada"
      ).length;
      setTarefasPendentes(pend);
    }
    const u1 = onSnapshot(qResp, snap => {
      lastResp = snap.docs.map(d => ({ status: (d.data() as { status?: string }).status || "a_fazer", deletadoEm: (d.data() as { deletadoEm?: string | null }).deletadoEm }));
      recompute();
    });
    const u2 = onSnapshot(qCo, snap => {
      lastCo = snap.docs.map(d => ({ status: (d.data() as { status?: string }).status || "a_fazer", deletadoEm: (d.data() as { deletadoEm?: string | null }).deletadoEm }));
      recompute();
    });
    return () => { u1(); u2(); };
  }, [pessoa?.id]);

  function visibleModule(moduleId: ModuleId) {
    if (!rid) return false;
    if (!pessoa) return false;
    // Master vê todos os módulos definidos no catálogo — não depende de
    // modulosAtivos por restaurante (esse filtro só vale pra non-master).
    if (pessoa.isMaster) return true;
    if (!modulosAtivos.includes(moduleId)) return false;
    return canUse(pessoa, rid, moduleId);
  }

  const areas: ModuleArea[] = ["ops", "dp", "fin", "inst"];

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

          {areas.map(area => {
            const mods = modulesByArea(area).filter(m => !m.oculto && visibleModule(m.id));
            if (mods.length === 0) return null;
            const info = AREA_INFO[area];
            const fechada = colapsadas.has(area);
            return (
              <div key={area}>
                <button
                  type="button"
                  onClick={() => toggleArea(area)}
                  className="w-full flex items-center gap-1 px-3 mb-1 text-[10px] font-bold uppercase tracking-wider hover:opacity-80"
                  style={{ color: info.color }}
                  title={fechada ? "Expandir" : "Recolher"}
                >
                  <span className={`transition-transform leading-none ${fechada ? "-rotate-90" : ""}`}>▾</span>
                  <span className="flex-1 text-left">{info.label}</span>
                  <span className="opacity-60 font-semibold">{mods.length}</span>
                </button>
                {!fechada && (
                <div className="space-y-0.5">
                  {mods.map((m, idx) => {
                    // Header de subárea quando mudar de subarea (Opção A dividers)
                    const subareaAnterior = idx > 0 ? mods[idx - 1].subarea : undefined;
                    const mostrarHeader = m.subarea && m.subarea !== subareaAnterior;
                    return (
                      <div key={m.id}>
                        {mostrarHeader && (
                          <div className="px-3 pt-2 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                            {m.subarea}
                          </div>
                        )}
                        <NavLink
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
                          <span className="flex-1 truncate">{m.label}</span>
                          {m.id === "tarefas" && tarefasPendentes > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-bold">
                              {tarefasPendentes > 99 ? "99+" : tarefasPendentes}
                            </span>
                          )}
                          {m.etapa && <ModuleBadge etapa={m.etapa} size="xs" />}
                          {m.status === "em-breve" && <span className="text-[9px] text-amber-600 dark:text-amber-400">em breve</span>}
                          {m.status === "planejado" && <span className="text-[9px] text-gray-400">próx.</span>}
                        </NavLink>
                      </div>
                    );
                  })}
                  {area === "inst" && pessoa?.isMaster && (
                    <>
                      <NavLink to="/arquitetura" onClick={onClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                        <span>🏗️</span><span className="flex-1 truncate">Arquitetura</span>
                        <span className="text-[9px] text-gray-400">master</span>
                      </NavLink>
                      <NavLink to="/perfis" onClick={onClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                        <span>🛡️</span><span className="flex-1 truncate">Perfis de Acesso</span>
                        <span className="text-[9px] text-gray-400">master</span>
                      </NavLink>
                    </>
                  )}
                </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

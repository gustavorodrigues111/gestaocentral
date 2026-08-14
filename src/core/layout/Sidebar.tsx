import { useEffect, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { AREA_INFO, modulesByArea } from "../../config/modules";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { canUse } from "../auth/permissions";
import { useCanAcao } from "../auth/useCanAcao";
import { useAvisos } from "../../modules/chat/useAvisos";
import { confirmarSaida } from "../nav/unsaved";
import { ModuleBadge } from "../ui/ModuleBadge";
import { NewRestaurantModal } from "../../modules/configuracoes/NewRestaurantModal";
import type { ModuleArea, ModuleId } from "../types";

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pessoa } = useAuth();
  const { restaurants, activeRestaurant, setActiveId, subdomainLocked } = useRestaurant();
  const rid = activeRestaurant?.id;
  const navigate = useNavigate();
  const location = useLocation();
  const [showNewRest, setShowNewRest] = useState(false);
  const modulosAtivos = activeRestaurant?.modulosAtivos || [];

  // Fecha o drawer ao navegar, mas antes checa alterações não salvas (ex:
  // classificação de fatura). Se o usuário cancelar, bloqueia a navegação.
  function guardedClose(e: { preventDefault: () => void }) {
    if (!confirmarSaida()) { e.preventDefault(); return; }
    onClose();
  }

  function changeRestaurant(newRid: string) {
    if (newRid === "__novo__") { setShowNewRest(true); return; }
    if (!confirmarSaida()) return;
    setActiveId(newRid);
    // Se está em /r/{oldRid}/{moduleId}, vai pro mesmo módulo no novo restaurante.
    const m = location.pathname.match(/^\/r\/[^/]+\/(.+)$/);
    if (m) navigate(`/r/${newRid}/${m[1]}`);
  }
  // useCanAcao já lê perfis built-in + custom do Firestore — usa esse hook
  // em vez de canAcao() solto pra perfis custom funcionarem.
  const { can: canAcaoRid } = useCanAcao(rid || "");

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

  // Contador GLOBAL de tarefas pendentes do usuário (responsável, co-resp,
  // observador ou responsável de alguma subtarefa). Independente do
  // restaurante selecionado — é caixa por usuário.
  const [tarefasPendentes, setTarefasPendentes] = useState(0);
  useEffect(() => {
    if (!pessoa?.id) { setTarefasPendentes(0); return; }
    const qResp = query(collection(db, "tarefas"), where("responsavelId", "==", pessoa.id));
    const qCo = query(collection(db, "tarefas"), where("coResponsaveis", "array-contains", pessoa.id));
    const qObs = query(collection(db, "tarefas"), where("observadoresIds", "array-contains", pessoa.id));
    const qSub = query(collection(db, "tarefas"), where("subtarefaResponsaveisIds", "array-contains", pessoa.id));
    type Row = { id: string; status: string; deletadoEm?: string | null };
    let lastResp: Row[] = [];
    let lastCo: Row[] = [];
    let lastObs: Row[] = [];
    let lastSub: Row[] = [];
    function recompute() {
      const map = new Map<string, Row>();
      [...lastResp, ...lastCo, ...lastObs, ...lastSub].forEach(t => map.set(t.id, t));
      const pend = Array.from(map.values()).filter(t =>
        !t.deletadoEm && t.status !== "concluida" && t.status !== "cancelada"
      ).length;
      setTarefasPendentes(pend);
    }
    function toRow(d: { id: string; data: () => unknown }): Row {
      const data = d.data() as { status?: string; deletadoEm?: string | null };
      return { id: d.id, status: data.status || "a_fazer", deletadoEm: data.deletadoEm };
    }
    const u1 = onSnapshot(qResp, snap => { lastResp = snap.docs.map(toRow); recompute(); });
    const u2 = onSnapshot(qCo, snap => { lastCo = snap.docs.map(toRow); recompute(); });
    const u3 = onSnapshot(qObs, snap => { lastObs = snap.docs.map(toRow); recompute(); });
    const u4 = onSnapshot(qSub, snap => { lastSub = snap.docs.map(toRow); recompute(); });
    return () => { u1(); u2(); u3(); u4(); };
  }, [pessoa?.id]);

  // Badge da Central de Avisos (Chat) — usa o MESMO cálculo do feed (provider
  // no shell), então badge sempre bate com a lista de avisos.
  const avisosPendentes = useAvisos().length;

  function visibleModule(moduleId: ModuleId) {
    if (!rid) return false;
    if (!pessoa) return false;
    // modulosAtivos vale pra TODOS (inclusive master): módulo desativado nas
    // Configurações da empresa não aparece no menu. Pra reativar → Catálogo de
    // módulos (sempre disponível). Master ainda ignora só a checagem de permissão.
    if (!modulosAtivos.includes(moduleId)) return false;
    if (pessoa.isMaster) return true;
    return canUse(pessoa, rid, moduleId);
  }

  const areas: ModuleArea[] = ["planejamento", "ops", "dp", "fin", "inst"];

  // Seção Master (Tarefas + Planner): ferramentas pessoais do dono.
  // Diferente das demais áreas, RESPEITA modulosAtivos MESMO pro master —
  // assim o master liga/desliga essas ferramentas nas Configurações.
  // Default off até ser ligado. Só visível pro master.
  function masterModuloLigado(moduleId: ModuleId) {
    if (!pessoa?.isMaster) return false;
    return modulosAtivos.includes(moduleId);
  }
  // Agentes de IA e Governança de IA sobem pra Institucional (badge "master"),
  // como Caderno/Perfis — não formam mais uma seção Master própria.
  const NO_INSTITUCIONAL_MASTER = new Set<ModuleId>(["agentes", "iaGovernanca"]);
  const masterMods = modulesByArea("master").filter(m => !m.oculto && masterModuloLigado(m.id) && !NO_INSTITUCIONAL_MASTER.has(m.id));

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
        flex flex-col
        transform transition-transform md:transform-none
        ${open ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        {/* Topo FIXO: marca + seletor de restaurante (rola só os módulos abaixo) */}
        <div className="flex-none px-3 pt-3 pb-2.5 border-b border-gray-100 dark:border-gray-800">
          <div className="px-1 mb-2 font-bold text-[15px] text-gray-900 dark:text-gray-100 select-none">
            <span className="text-indigo-600 dark:text-indigo-400">⚡</span> planejamento<span className="text-gray-400 dark:text-gray-500">.app</span>
          </div>
          {!subdomainLocked && restaurants.length > 0 ? (
            <select
              value={activeRestaurant?.id || ""}
              onChange={(e) => changeRestaurant(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 cursor-pointer truncate"
            >
              {restaurants.map((r) => (<option key={r.id} value={r.id}>{r.nome}</option>))}
              {pessoa?.isMaster && <option value="__novo__">＋ Criar novo restaurante…</option>}
            </select>
          ) : (
            activeRestaurant && <div className="px-1 text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{activeRestaurant.nome}</div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Central de Avisos — tela de abertura UNIVERSAL. Primeiro item,
              fora dos agrupamentos. Aparece pra todo usuário com restaurante
              ativo (independe do módulo chat) — é o canal das Rotinas/avisos. */}
          {rid && (
            <NavLink
              to={rid ? `/r/${rid}/chat` : "/"}
              onClick={guardedClose}
              className={({ isActive }) => `
                flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                ${isActive
                  ? "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"}
              `}
            >
              <span>🎛️</span>
              <span className="flex-1">Minha Central</span>
              {avisosPendentes > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold">
                  {avisosPendentes > 99 ? "99+" : avisosPendentes}
                </span>
              )}
            </NavLink>
          )}

          {souEquipe && rid && canAcaoRid("portalEmpregado", "acessar") && (
            <NavLink
              to={`/portal/${rid}`}
              onClick={guardedClose}
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
            // Chat (Central de Avisos) é item de topo — removido dos grupos.
            // (Tarefas migrou pra seção Master.)
            const mods = modulesByArea(area).filter(m => !m.oculto && m.id !== "chat" && visibleModule(m.id));
            if (mods.length === 0) return null;
            const info = AREA_INFO[area];
            const fechada = colapsadas.has(area);
            return (
              <div
                key={area}
                className="rounded-xl border p-1.5 mb-2"
                style={{ borderColor: `${info.color}33`, background: `${info.color}0d`, boxShadow: `0 1px 7px ${info.color}22` }}
              >
                <button
                  type="button"
                  onClick={() => toggleArea(area)}
                  className="w-full flex items-center gap-1.5 px-1.5 mb-1 text-xs font-extrabold uppercase tracking-wide text-gray-900 dark:text-gray-100 hover:opacity-80"
                  title={fechada ? "Expandir" : "Recolher"}
                >
                  <span className={`transition-transform leading-none ${fechada ? "-rotate-90" : ""}`} style={{ color: info.color }}>▾</span>
                  <span className="flex-1 text-left">{info.label}</span>
                  <span className="font-bold" style={{ color: info.color }}>{mods.length}</span>
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
                          onClick={guardedClose}
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
                          {m.etapa && <ModuleBadge etapa={m.etapa} size="xs" />}
                          {m.status === "em-breve" && <span className="text-[9px] text-amber-600 dark:text-amber-400">em breve</span>}
                          {m.status === "planejado" && <span className="text-[9px] text-gray-400">próx.</span>}
                        </NavLink>
                      </div>
                    );
                  })}
                  {area === "inst" && pessoa?.isMaster && (
                    <>
                      <NavLink to="/arquitetura" onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                        <span>📓</span><span className="flex-1 truncate">Caderno</span>
                        <span className="text-[9px] text-gray-400">master</span>
                      </NavLink>
                      <NavLink to="/perfis" onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                        <span>🛡️</span><span className="flex-1 truncate">Perfis de Acesso</span>
                        <span className="text-[9px] text-gray-400">master</span>
                      </NavLink>
                      {masterModuloLigado("agentes") && (
                        <NavLink to={rid ? `/r/${rid}/agentes` : "#"} onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                          <span>🤖</span><span className="flex-1 truncate">Agentes de IA</span>
                          <span className="text-[9px] text-gray-400">master</span>
                        </NavLink>
                      )}
                      {masterModuloLigado("conectores") && (
                        <NavLink to={rid ? `/r/${rid}/conectores` : "#"} onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                          <span>🔌</span><span className="flex-1 truncate">Conectores</span>
                          <span className="text-[9px] text-gray-400">master</span>
                        </NavLink>
                      )}
                      {masterModuloLigado("iaGovernanca") && (
                        <NavLink to={rid ? `/r/${rid}/iaGovernanca` : "#"} onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                          <span>🛡️</span><span className="flex-1 truncate">Governança de IA</span>
                          <span className="text-[9px] text-gray-400">master</span>
                        </NavLink>
                      )}
                    </>
                  )}
                </div>
                )}
              </div>
            );
          })}

          {/* Seção Master — Tarefas + Planner. Respeita modulosAtivos mesmo
              pro master (ligável/desligável nas Configurações). */}
          {masterMods.length > 0 && (() => {
            const fechada = colapsadas.has("master");
            const info = AREA_INFO.master;
            return (
              <div>
                <button
                  type="button"
                  onClick={() => toggleArea("master")}
                  className="w-full flex items-center gap-1 px-3 mb-1 text-[10px] font-bold uppercase tracking-wider hover:opacity-80"
                  style={{ color: info.color }}
                  title={fechada ? "Expandir" : "Recolher"}
                >
                  <span className={`transition-transform leading-none ${fechada ? "-rotate-90" : ""}`}>▾</span>
                  <span className="flex-1 text-left">{info.label}</span>
                  <span className="opacity-60 font-semibold">{masterMods.length}</span>
                </button>
                {!fechada && (
                <div className="space-y-0.5">
                  {masterMods.map(m => {
                    const to = rid ? `/r/${rid}/${m.id}` : "#";
                    return (
                      <NavLink
                        key={m.id}
                        to={to}
                        end={m.id === "tarefas"}
                        onClick={guardedClose}
                        className={({ isActive }) => `
                          flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                          ${isActive
                            ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium"
                            : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}
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
                      </NavLink>
                    );
                  })}
                </div>
                )}
              </div>
            );
          })()}

          {/* Link discreto pro catálogo (grid) — Tarefas é a default mas
              quem quiser ver o panorama de módulos abre por aqui */}
          <div className="pt-3 mt-2 border-t border-gray-100 dark:border-gray-800">
            <NavLink
              to="/?catalogo=1"
              onClick={guardedClose}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <span>🧭</span>
              <span className="flex-1 truncate">Catálogo de módulos</span>
            </NavLink>
          </div>
        </nav>

        {showNewRest && (
          <NewRestaurantModal onClose={() => setShowNewRest(false)} onCreated={(id) => setActiveId(id)} />
        )}
      </aside>
    </>
  );
}

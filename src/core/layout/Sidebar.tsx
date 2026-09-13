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
import { ModuleIcon } from "../ui/ModuleIcon";
import { PanelLeftClose, Store, ChevronsUpDown, Check, Plus, Compass } from "lucide-react";
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
    // Só fecha o menu ao navegar no MOBILE (drawer). No desktop o menu só
    // recolhe/expande pelo botão dedicado — abrir um módulo não o esconde.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      onClose();
    }
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

  // Restaurante onde a pessoa É EMPREGADA. Ninguém é empregado de 2 empresas,
  // então há no máximo um. O Portal (Minhas Informações) fica FIXO nesse
  // restaurante — independente de qual restaurante está ativo no seletor.
  const [empRid, setEmpRid] = useState<string | null>(null);
  const [restAberto, setRestAberto] = useState(false);
  // Permissões do portal escopadas ao restaurante-empregado (não ao ativo).
  const { can: canPortalEmp } = useCanAcao(empRid || "");
  useEffect(() => {
    if (!pessoa?.id) { setEmpRid(null); return; }
    const q = query(collection(db, "empregados"), where("pessoaId", "==", pessoa.id));
    const unsub = onSnapshot(q, (snap) => {
      const d = snap.docs[0]?.data() as { restaurantId?: string } | undefined;
      setEmpRid(d?.restaurantId || null);
    });
    return () => unsub();
  }, [pessoa?.id]);

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
    // "Tarefas" virou item único: mostra pra quem tem o perfil avançado
    // (permissão tarefas) OU o simplificado (permissão planoDeAcao). O modo é
    // decidido no ProtectedShell. Ativo se qualquer um dos dois estiver ligado.
    if (moduleId === "tarefas") {
      if (!modulosAtivos.includes("tarefas") && !modulosAtivos.includes("planoDeAcao")) return false;
      if (pessoa.isMaster) return true;
      return canUse(pessoa, rid, "tarefas") || canUse(pessoa, rid, "planoDeAcao");
    }
    // Ponto (PTRP): módulo "ptrp", mas a permissão é a do catálogo "ponto/*".
    if (moduleId === "ptrp") {
      if (!modulosAtivos.includes("ptrp")) return false;
      if (pessoa.isMaster) return true;
      return canAcaoRid("ponto", "conferir") || canAcaoRid("ponto", "banco") || canAcaoRid("ponto", "sincronizar") || canAcaoRid("ponto", "regras") || canAcaoRid("ponto", "validar");
    }
    if (!modulosAtivos.includes(moduleId)) return false;
    if (pessoa.isMaster) return true;
    return canUse(pessoa, rid, moduleId);
  }

  const areas: ModuleArea[] = ["ops", "dp", "planejamento", "inst"];

  // Seção Master (Tarefas + Planner): ferramentas pessoais do dono.
  // Diferente das demais áreas, RESPEITA modulosAtivos MESMO pro master —
  // assim o master liga/desliga essas ferramentas nas Configurações.
  // Default off até ser ligado. Só visível pro master.
  function masterModuloLigado(moduleId: ModuleId) {
    if (!pessoa?.isMaster) return false;
    return modulosAtivos.includes(moduleId);
  }
  // Módulos da área "master" (hoje só Governança de IA) formam a seção Master.
  // Agentes de IA migrou pra Administrativo e Conectores pra Configurações —
  // renderizam pelas próprias áreas agora, não mais aqui.
  const masterMods = modulesByArea("master").filter(m => !m.oculto && masterModuloLigado(m.id));

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
        transform transition-transform md:transition-[width,transform] md:transform-none
        ${open ? "translate-x-0 md:w-60" : "-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-r-0"}
      `}>
        {/* Topo FIXO: marca + seletor de restaurante (rola só os módulos abaixo) */}
        <div className="flex-none px-3 pt-3 pb-2.5 border-b border-gray-100 dark:border-gray-800">
          <div className="px-1 mb-2 flex items-center gap-1">
            <div className="font-bold text-[15px] text-gray-900 dark:text-gray-100 select-none flex-1 truncate">
              <span className="text-indigo-600 dark:text-indigo-400">⚡</span> planejamento<span className="text-gray-400 dark:text-gray-500">.app</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Recolher o menu"
              className="hidden md:inline-flex items-center justify-center shrink-0 p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          {!subdomainLocked && restaurants.length > 0 ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setRestAberto(v => !v)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <Store size={15} className="text-gray-400 shrink-0" />
                <span className="flex-1 text-left truncate font-medium">{activeRestaurant?.nome || "Selecione…"}</span>
                <ChevronsUpDown size={15} className="text-gray-400 shrink-0" />
              </button>
              {restAberto && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setRestAberto(false)} />
                  <div className="absolute left-0 right-0 mt-1 z-40 max-h-72 overflow-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1">
                    {restaurants.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => { setRestAberto(false); changeRestaurant(r.id); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left ${r.id === activeRestaurant?.id ? "bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                      >
                        <Store size={15} className="text-gray-400 shrink-0" />
                        <span className="flex-1 truncate">{r.nome}</span>
                        {r.id === activeRestaurant?.id && <Check size={15} className="text-indigo-500 shrink-0" />}
                      </button>
                    ))}
                    {pessoa?.isMaster && (
                      <>
                        <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                        <button
                          type="button"
                          onClick={() => { setRestAberto(false); changeRestaurant("__novo__"); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-indigo-600 dark:text-indigo-400 hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <Plus size={15} className="shrink-0" /> Criar novo restaurante…
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            activeRestaurant && <div className="px-1 text-sm font-semibold text-gray-700 dark:text-gray-200 truncate">{activeRestaurant.nome}</div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* MINHAS INFORMAÇÕES — área pessoal do usuário. Dashboard (Central
              de Avisos, UNIVERSAL) + módulos do Portal do Empregado (deep-link
              pra PortalPage já na aba certa). */}
          {rid && (() => {
            const info = AREA_INFO.minhas;
            const fechada = colapsadas.has("minhas");
            const itemCls = ({ isActive }: { isActive: boolean }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`;
            // Portal SEMPRE aponta pro restaurante-empregado (empRid), não pro ativo.
            const podePortal = !!(empRid && canPortalEmp("portalEmpregado", "acessar"));
            const portalItens = !empRid ? [] : [
              { to: `/portal/${empRid}/escala`,      icon: "calendar-days",  label: "Minha Escala",     show: podePortal && canPortalEmp("portalEmpregado", "verMinhaEscala") },
              { to: `/portal/${empRid}/horarios`,    icon: "clock",          label: "Meus Horários",    show: podePortal && canPortalEmp("portalEmpregado", "verMeusHorarios") },
              { to: `/portal/${empRid}/gorjetas`,    icon: "hand-coins",     label: "Minhas Gorjetas",  show: podePortal && canPortalEmp("portalEmpregado", "verMinhaGorjeta") },
              { to: `/portal/${empRid}/comunicados`, icon: "megaphone",      label: "Meus Comunicados", show: podePortal && canPortalEmp("portalEmpregado", "verComunicados") },
              { to: `/portal/${empRid}/faleDp`,      icon: "message-circle", label: "Fale com DP",      show: podePortal && canPortalEmp("portalEmpregado", "acessarFaleComDP") },
            ].filter(p => p.show);
            const total = 1 + portalItens.length;
            return (
              <div className="rounded-xl border p-1.5 mb-2" style={{ borderColor: `${info.color}33`, background: `${info.color}0d`, boxShadow: `0 1px 7px ${info.color}22` }}>
                <button type="button" onClick={() => toggleArea("minhas")} className="w-full flex items-center gap-1.5 px-1.5 mb-1 text-xs font-extrabold uppercase tracking-wide text-gray-900 dark:text-gray-100 hover:opacity-80" title={fechada ? "Expandir" : "Recolher"}>
                  <span className={`transition-transform leading-none ${fechada ? "-rotate-90" : ""}`} style={{ color: info.color }}>▾</span>
                  <span className="flex-1 text-left">{info.label}</span>
                  <span className="font-bold" style={{ color: info.color }}>{total}</span>
                </button>
                {!fechada && (
                  <div className="space-y-0.5">
                    <NavLink to={`/r/${rid}/chat`} onClick={guardedClose} className={itemCls}>
                      <ModuleIcon name="layout-dashboard" size={16} />
                      <span className="flex-1 truncate">Dashboard</span>
                      {avisosPendentes > 0 && (
                        <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold">
                          {avisosPendentes > 99 ? "99+" : avisosPendentes}
                        </span>
                      )}
                    </NavLink>
                    {portalItens.map(p => (
                      <NavLink key={p.to} to={p.to} onClick={guardedClose} className={itemCls}>
                        <ModuleIcon name={p.icon} size={16} />
                        <span className="flex-1 truncate">{p.label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {areas.map(area => {
            // Chat (Central de Avisos) é item de topo — removido dos grupos.
            // (Tarefas migrou pra seção Master.)
            const mods = modulesByArea(area).filter(m => !m.oculto && m.id !== "chat" && visibleModule(m.id));
            // Configurações tem links dedicados (Dados da empresa, Módulos, Perfis)
            // além dos módulos — não colapsa a seção quando só há esses links.
            const instExtras = area === "inst" && (visibleModule("configuracoes") || pessoa?.isMaster || canAcaoRid("perfisAcesso", "ver"));
            if (mods.length === 0 && !instExtras) return null;
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
                          <ModuleIcon name={m.icon} size={16} />
                          <span className="flex-1 truncate">{m.label}</span>
                          {m.etapa && <ModuleBadge etapa={m.etapa} size="xs" />}
                          {m.status === "em-breve" && <span className="text-[9px] text-amber-600 dark:text-amber-400">em breve</span>}
                          {m.status === "planejado" && <span className="text-[9px] text-gray-400">próx.</span>}
                        </NavLink>
                      </div>
                    );
                  })}
                  {area === "inst" && visibleModule("configuracoes") && (
                    <>
                      <NavLink to={`/r/${rid}/dadosEmpresa`} onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                        <ModuleIcon name="building-2" size={16} /><span className="flex-1 truncate">Dados da empresa</span>
                      </NavLink>
                      <NavLink to={`/r/${rid}/modulos`} onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                        <ModuleIcon name="layout-grid" size={16} /><span className="flex-1 truncate">Módulos</span>
                      </NavLink>
                    </>
                  )}
                  {area === "inst" && (pessoa?.isMaster || canAcaoRid("perfisAcesso", "ver")) && (
                    <NavLink to="/perfis" onClick={guardedClose} className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                      <ModuleIcon name="user-round-cog" size={16} /><span className="flex-1 truncate">Perfis de Acesso</span>
                    </NavLink>
                  )}
                </div>
                )}
              </div>
            );
          })}


          {/* Seção Master — módulos da área master (Governança de IA) +
              ferramentas do dono (Caderno, Perfis de Acesso, Propostas). */}
          {(pessoa?.isMaster || masterMods.length > 0) && (() => {
            const fechada = colapsadas.has("master");
            const info = AREA_INFO.master;
            const total = masterMods.length + (pessoa?.isMaster ? 2 : 0);
            const extraCls = ({ isActive }: { isActive: boolean }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isActive ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-medium" : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"}`;
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
                  <span className="opacity-60 font-semibold">{total}</span>
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
                        <ModuleIcon name={m.icon} size={16} />
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
                  {pessoa?.isMaster && (
                    <>
                      <NavLink to="/arquitetura" onClick={guardedClose} className={extraCls}>
                        <ModuleIcon name="notebook-pen" size={16} /><span className="flex-1 truncate">Caderno</span>
                      </NavLink>
                      <NavLink to="/propostas" onClick={guardedClose} className={extraCls}>
                        <ModuleIcon name="file-signature" size={16} /><span className="flex-1 truncate">Propostas</span>
                      </NavLink>
                    </>
                  )}
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
              <Compass size={15} />
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

import { useState } from "react";
import { useLocation } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { MODULES } from "../../config/modules";
import { APP_COMMIT, APP_BUILD_DATE, APP_VERSION_LABEL } from "../version";

// Nome + descrição do módulo atual a partir da rota — mostrado no header
// (o "Planejamento.app" e o seletor de restaurante vivem na sidebar agora).
function moduloDoPath(pathname: string): { icon: string; label: string; desc?: string } | null {
  if (pathname === "/planner") return { icon: "🗓", label: "Planner", desc: "Pessoal · sua agenda do Google" };
  if (pathname === "/arquitetura") return { icon: "🏗️", label: "Arquitetura", desc: "Mapa de módulos do sistema" };
  if (pathname === "/perfis") return { icon: "🛡️", label: "Perfis de Acesso", desc: "Permissões por perfil" };
  if (pathname.startsWith("/portal/")) return { icon: "👤", label: "Meu Portal" };
  const m = pathname.match(/^\/r\/[^/]+\/(.+)$/);
  if (m) {
    const mod = MODULES.find((x) => x.id === m[1]);
    if (mod) return { icon: mod.icon, label: mod.label, desc: mod.desc };
    // módulos fora do catálogo MODULES (rotas especiais):
    if (m[1] === "configuracoes") return { icon: "⚙️", label: "Configurações", desc: "Configurações do restaurante" };
  }
  return null;
}

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { fbUser, pessoa, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const modulo = moduloDoPath(location.pathname);

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center px-3 sm:px-4 gap-2 sm:gap-4 [overflow-x:clip] relative z-30">
      <button onClick={onToggleSidebar} className="md:hidden text-gray-600 dark:text-gray-300 hover:text-gray-900 flex-shrink-0 text-xl leading-none">
        ☰
      </button>

      <div className="flex items-baseline gap-2 min-w-0">
        {modulo ? (
          <>
            <span className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 truncate whitespace-nowrap">{modulo.icon} {modulo.label}</span>
            {modulo.desc && <span className="hidden md:inline text-xs text-gray-500 dark:text-gray-400 truncate">{modulo.desc}</span>}
          </>
        ) : (
          <span className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 truncate">Início</span>
        )}
      </div>

      <div className="flex-1 min-w-0" />

      {/* Chip de versão — visível só do sm pra cima pra não apertar mobile
          (no mobile aparece no menu do avatar). Click hard-reload pra forçar
          atualização. Usuário lê esse número e dá pro suporte conferir se
          está na versão mais recente do deploy. */}
      <button
        type="button"
        onClick={() => window.location.reload()}
        title={`Versão do app: ${APP_VERSION_LABEL}\nClique pra atualizar`}
        className="hidden sm:inline-flex text-xs font-mono text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
      >
        v.{APP_COMMIT}
      </button>

      {/* Badge de "novos restaurantes" — pessoa foi adicionada e ainda não viu */}
      {pessoa && (pessoa.novosRestaurantes?.length || 0) > 0 && (
        <NovosRestaurantesBadge pessoaId={pessoa.id} novosRids={pessoa.novosRestaurantes!} />
      )}

      {/* Menu do usuário — flex-shrink-0 garante que o avatar SEMPRE fica visível */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-semibold flex-shrink-0">
            {(pessoa?.nome || fbUser?.email || "?")[0].toUpperCase()}
          </div>
          <span className="text-sm text-gray-700 dark:text-gray-200 hidden sm:inline">
            {pessoa?.nome || fbUser?.email || "Carregando..."}
          </span>
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-[60]" onClick={() => setMenuOpen(false)} />
            {/* Dropdown usa `fixed` pra fugir do stacking context do header
                (que tem [overflow-x:clip] e z-30). Em mobile, conteúdo de
                módulos com z-index alto estava ficando ACIMA do dropdown
                quando ele era position:absolute. */}
            <div className="fixed right-3 sm:right-4 top-14 mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-[70]">
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                {fbUser?.email}
              </div>
              <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-0.5">
                  Versão do app
                </div>
                <div className="font-mono text-xs text-gray-700 dark:text-gray-300">
                  {APP_COMMIT}
                </div>
                {APP_BUILD_DATE && (
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                    Build em {APP_BUILD_DATE}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    // Hard reload limpando o cache do bundle. Em PWA/Vercel
                    // edge, o SW pode ter cacheado a versão antiga — esse
                    // reload força o browser a buscar tudo de novo.
                    setMenuOpen(false);
                    window.location.reload();
                  }}
                  className="mt-2 w-full text-left text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  ↻ Atualizar agora
                </button>
              </div>
              <button
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
              >
                Sair
              </button>
            </div>
          </>
        )}
      </div>

    </header>
  );
}

// ── Badge "Você foi adicionada a N restaurantes" ──────────────────────────
function NovosRestaurantesBadge({ pessoaId, novosRids }: {
  pessoaId: string;
  novosRids: string[];
}) {
  const [aberto, setAberto] = useState(false);
  const { restaurants } = useRestaurant();
  const novos = novosRids
    .map(rid => restaurants.find(r => r.id === rid))
    .filter((r): r is NonNullable<typeof r> => !!r);

  async function dispensar(rid?: string) {
    try {
      const remaining = rid
        ? novosRids.filter(r => r !== rid)
        : [];
      await updateDoc(doc(db, "pessoas", pessoaId), {
        novosRestaurantes: remaining,
      });
      if (remaining.length === 0) setAberto(false);
    } catch (e) {
      console.error("Erro ao marcar como visto:", e);
    }
  }

  return (
    <div className="relative mr-2">
      <button
        onClick={() => setAberto(o => !o)}
        className="relative px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-amber-600 dark:text-amber-400"
        title={`${novos.length} restaurante(s) novo(s)`}
      >
        📨
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {novos.length}
        </span>
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20 p-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
              📨 Você foi adicionada a {novos.length} restaurante(s)
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {novos.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800"
                >
                  <span className="text-sm text-gray-900 dark:text-gray-100">{r.nome}</span>
                  <button
                    type="button"
                    onClick={() => dispensar(r.id)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    ✓ Vi
                  </button>
                </div>
              ))}
            </div>
            {novos.length > 1 && (
              <button
                type="button"
                onClick={() => dispensar()}
                className="w-full mt-2 px-3 py-1.5 rounded text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border border-gray-200 dark:border-gray-700"
              >
                Marcar todos como vistos
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

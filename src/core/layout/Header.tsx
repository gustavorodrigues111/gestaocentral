import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { NewRestaurantModal } from "../../modules/configuracoes/NewRestaurantModal";
import { APP_COMMIT, APP_BUILD_DATE, APP_VERSION_LABEL } from "../version";

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { fbUser, pessoa, signOut } = useAuth();
  const { restaurants, activeRestaurant, setActiveId, subdomainLocked } = useRestaurant();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNewRest, setShowNewRest] = useState(false);
  const isMaster = !!pessoa?.isMaster;
  const navigate = useNavigate();
  const location = useLocation();

  function changeRestaurant(newRid: string) {
    setActiveId(newRid);
    // Se está em /r/{oldRid}/{moduleId}, navega pro mesmo módulo no novo restaurante.
    const m = location.pathname.match(/^\/r\/[^/]+\/(.+)$/);
    if (m) navigate(`/r/${newRid}/${m[1]}`);
  }

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center px-3 sm:px-4 gap-2 sm:gap-4 [overflow-x:clip] relative z-30">
      <button onClick={onToggleSidebar} className="md:hidden text-gray-600 dark:text-gray-300 hover:text-gray-900 flex-shrink-0 text-xl leading-none">
        ☰
      </button>

      <div className="flex items-center gap-2 min-w-0">
        <span className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
          {subdomainLocked && activeRestaurant ? activeRestaurant.nome : "Planejamento"}
        </span>
      </div>

      {/* Seletor de restaurante — escondido quando entrou via subdomain */}
      {!subdomainLocked && restaurants.length > 0 && (
        <select
          value={activeRestaurant?.id || ""}
          onChange={(e) => changeRestaurant(e.target.value)}
          className="ml-1 sm:ml-4 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 cursor-pointer max-w-[120px] sm:max-w-none truncate min-w-0"
        >
          {restaurants.map(r => (
            <option key={r.id} value={r.id}>{r.nome}</option>
          ))}
        </select>
      )}

      {/* "+ Restaurante" — só desktop */}
      {!subdomainLocked && isMaster && (
        <button
          onClick={() => setShowNewRest(true)}
          title="Novo restaurante"
          className="hidden sm:inline-flex px-2 py-1 text-xs rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 flex-shrink-0"
        >
          + Restaurante
        </button>
      )}

      <div className="flex-1 min-w-0" />

      {/* Chip de versão — visível em mobile e desktop. Click hard-reload
          pra forçar atualização. Usuário lê esse número e dá pro suporte
          conferir se está na versão mais recente do deploy. */}
      <button
        type="button"
        onClick={() => window.location.reload()}
        title={`Versão do app: ${APP_VERSION_LABEL}\nClique pra atualizar`}
        className="text-[10px] sm:text-xs font-mono text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
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
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20">
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

      {showNewRest && (
        <NewRestaurantModal
          onClose={() => setShowNewRest(false)}
          onCreated={(id) => setActiveId(id)}
        />
      )}
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

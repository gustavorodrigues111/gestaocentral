import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useRestaurant } from "../restaurant/RestaurantContext";
import { NewRestaurantModal } from "../../modules/configuracoes/NewRestaurantModal";

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { fbUser, pessoa, signOut } = useAuth();
  const { restaurants, activeRestaurant, setActiveId } = useRestaurant();
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
    <header className="h-14 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center px-4 gap-4">
      <button onClick={onToggleSidebar} className="md:hidden text-gray-600 dark:text-gray-300 hover:text-gray-900">
        ☰
      </button>

      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Gestão Central</span>
      </div>

      {/* Seletor de restaurante */}
      {restaurants.length > 0 && (
        <select
          value={activeRestaurant?.id || ""}
          onChange={(e) => changeRestaurant(e.target.value)}
          className="ml-4 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 cursor-pointer"
        >
          {restaurants.map(r => (
            <option key={r.id} value={r.id}>{r.nome}</option>
          ))}
        </select>
      )}

      {isMaster && (
        <button
          onClick={() => setShowNewRest(true)}
          title="Novo restaurante"
          className="px-2 py-1 text-xs rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
        >
          + Restaurante
        </button>
      )}

      <div className="flex-1" />

      {/* Menu do usuário */}
      <div className="relative">
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-semibold">
            {(pessoa?.nome || fbUser?.email || "?")[0].toUpperCase()}
          </div>
          <span className="text-sm text-gray-700 dark:text-gray-200 hidden sm:inline">
            {pessoa?.nome || fbUser?.email || "Carregando..."}
          </span>
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg z-20">
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800">
                {fbUser?.email}
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

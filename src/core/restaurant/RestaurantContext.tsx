import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import { hasAnyAccess } from "../auth/permissions";
import type { Restaurant } from "../types";

type RestaurantState = {
  restaurants: Restaurant[];     // todos os que a pessoa acessa
  activeId: string | null;       // restaurante ativo
  activeRestaurant: Restaurant | null;
  setActiveId: (id: string) => void;
  loading: boolean;
};

const RestaurantCtx = createContext<RestaurantState | null>(null);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { pessoa } = useAuth();
  const [allRestaurants, setAllRestaurants] = useState<Restaurant[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(() => {
    return localStorage.getItem("gc_activeRestaurantId");
  });
  const [loading, setLoading] = useState(true);

  // Listen to restaurants in real-time
  useEffect(() => {
    if (!pessoa) { setAllRestaurants([]); setLoading(false); return; }
    const unsub = onSnapshot(collection(db, "restaurants"), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Restaurant);
      setAllRestaurants(list);
      setLoading(false);
    }, (err) => {
      console.error("Erro carregando restaurants:", err);
      setLoading(false);
    });
    return () => unsub();
  }, [pessoa]);

  // useMemo evita criar array novo toda render — estabiliza referência pra
  // dependências de outros useEffect e evita re-renders em cascata.
  const restaurants = useMemo(
    () => allRestaurants.filter(r => hasAnyAccess(pessoa, r.id) && r.ativo !== false),
    [allRestaurants, pessoa],
  );

  // Se NÃO há activeId, escolhe o primeiro disponível.
  // ⚠️ NUNCA sobrescreve activeId existente — isso causaria conflito com o
  // ModuleRouter que sincroniza activeId com :rid da URL. Se a URL tem um rid
  // que não existe na lista, simplesmente o activeRestaurant fica null e a
  // página mostra "Selecione um restaurante".
  useEffect(() => {
    if (loading) return;
    if (!activeId && restaurants[0]) {
      setActiveIdState(restaurants[0].id);
    }
  }, [restaurants, activeId, loading]);

  // Persist activeId
  useEffect(() => {
    if (activeId) localStorage.setItem("gc_activeRestaurantId", activeId);
    else localStorage.removeItem("gc_activeRestaurantId");
  }, [activeId]);

  const activeRestaurant = restaurants.find(r => r.id === activeId) || null;

  return (
    <RestaurantCtx.Provider value={{ restaurants, activeId, activeRestaurant, setActiveId: setActiveIdState, loading }}>
      {children}
    </RestaurantCtx.Provider>
  );
}

export function useRestaurant() {
  const ctx = useContext(RestaurantCtx);
  if (!ctx) throw new Error("useRestaurant deve ser usado dentro de RestaurantProvider");
  return ctx;
}

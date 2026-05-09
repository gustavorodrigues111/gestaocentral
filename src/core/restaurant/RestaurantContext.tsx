import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAuth } from "../auth/AuthContext";
import { hasAnyAccess } from "../auth/permissions";
import type { Restaurant } from "../types";
import { detectSubdomain, findRestaurantBySubdomain } from "./subdomain";

type RestaurantState = {
  restaurants: Restaurant[];     // todos os que a pessoa acessa
  activeId: string | null;       // restaurante ativo
  activeRestaurant: Restaurant | null;
  setActiveId: (id: string) => void;
  loading: boolean;
  // Quando o user entra via subdomain (ex: lobozo.planejamento.app), o
  // activeId é fixado nesse restaurante e não pode ser trocado.
  subdomain: string | null;
  subdomainLocked: boolean;
  // True se o subdomain bate com ALGUM restaurante (mesmo que a pessoa
  // logada não tenha acesso). Permite distinguir "endereço errado" vs
  // "sem permissão" na UI.
  subdomainExists: boolean;
};

const RestaurantCtx = createContext<RestaurantState | null>(null);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const { pessoa } = useAuth();
  const [allRestaurants, setAllRestaurants] = useState<Restaurant[]>([]);
  const subdomain = useMemo(() => detectSubdomain(), []);
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

  // Se há subdomain detectado, acha o restaurante correspondente em TODOS
  // os restaurantes (mesmo os que a pessoa não acessa) — pra mostrar
  // "sem acesso" certinho na tela.
  const subdomainRestaurant = useMemo(
    () => subdomain ? findRestaurantBySubdomain(allRestaurants, subdomain) : null,
    [allRestaurants, subdomain],
  );

  // useMemo evita criar array novo toda render — estabiliza referência pra
  // dependências de outros useEffect e evita re-renders em cascata.
  // Se subdomain ativo + match: restringe a lista AO restaurante do subdomain
  // (e só se a pessoa tem acesso). Senão, lista normal.
  const restaurants = useMemo(() => {
    if (subdomain && subdomainRestaurant) {
      const r = subdomainRestaurant;
      if (hasAnyAccess(pessoa, r.id) && r.ativo !== false) return [r];
      return [];
    }
    return allRestaurants.filter(r => hasAnyAccess(pessoa, r.id) && r.ativo !== false);
  }, [allRestaurants, pessoa, subdomain, subdomainRestaurant]);

  // Subdomain ativo + match → fixa activeId nesse rest (não permite trocar)
  // Senão: se NÃO há activeId, escolhe o primeiro disponível.
  useEffect(() => {
    if (loading) return;
    if (subdomain && subdomainRestaurant) {
      if (activeId !== subdomainRestaurant.id) {
        setActiveIdState(subdomainRestaurant.id);
      }
      return;
    }
    if (!activeId && restaurants[0]) {
      setActiveIdState(restaurants[0].id);
    }
  }, [restaurants, activeId, loading, subdomain, subdomainRestaurant]);

  // Persist activeId — só quando NÃO está em subdomain (evita "vazar" o
  // restaurante do subdomain pra outra aba acessada via root domain)
  useEffect(() => {
    if (subdomain) return;
    if (activeId) localStorage.setItem("gc_activeRestaurantId", activeId);
    else localStorage.removeItem("gc_activeRestaurantId");
  }, [activeId, subdomain]);

  const activeRestaurant = restaurants.find(r => r.id === activeId) || null;
  const subdomainLocked = !!(subdomain && subdomainRestaurant);

  // setActiveId: bloqueado se subdomain está ativo
  function setActiveId(id: string) {
    if (subdomainLocked) return;  // ignora trocas quando subdomain fixou
    setActiveIdState(id);
  }

  return (
    <RestaurantCtx.Provider value={{
      restaurants, activeId, activeRestaurant,
      setActiveId, loading,
      subdomain, subdomainLocked,
      subdomainExists: !!subdomainRestaurant,
    }}>
      {children}
    </RestaurantCtx.Provider>
  );
}

export function useRestaurant() {
  const ctx = useContext(RestaurantCtx);
  if (!ctx) throw new Error("useRestaurant deve ser usado dentro de RestaurantProvider");
  return ctx;
}

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import { canConfig } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { NewPessoaModal } from "./NewPessoaModal";
import type { Pessoa } from "../../core/types";

export function PessoasPage() {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  // URL é source of truth — busca o restaurante pelo rid da rota, não do contexto
  const { rid: ridParam } = useParams<{ rid: string }>();
  const rid = ridParam || "";
  const activeRestaurant = restaurants.find(r => r.id === rid) || null;
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNewPessoa, setShowNewPessoa] = useState(false);
  const podeConfig = canConfig(me, rid, "pessoas");

  useEffect(() => {
    if (!rid) return;
    setLoading(true);
    // Filtrar pessoas com acesso a este restaurante
    const q = query(collection(db, "pessoas"), where("restaurantIds", "array-contains", rid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa);
      setPessoas(list);
      setLoading(false);
    });
    return () => unsub();
  }, [rid]);

  const filtered = pessoas.filter(p => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (p.nome || "").toLowerCase().includes(s)
        || (p.email || "").toLowerCase().includes(s);
  }).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

  if (!activeRestaurant) {
    return <div className="text-gray-500">Selecione um restaurante.</div>;
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">👤 Pessoas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} pessoa(s) com acesso ao {activeRestaurant.nome}</p>
        </div>
        {podeConfig && (
          <Button onClick={() => setShowNewPessoa(true)}>+ Nova pessoa</Button>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por nome ou email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4"
      />

      {loading ? (
        <div className="text-sm text-gray-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search ? "Nenhuma pessoa encontrada" : "Nenhuma pessoa cadastrada ainda"}
          </p>
          {!search && podeConfig && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Cadastre a primeira clicando em "+ Nova pessoa"
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
          {filtered.map((p, i) => (
            <div
              key={p.id}
              className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""}`}
            >
              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold">
                {(p.nome || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100">{p.nome}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{p.email}</div>
              </div>
              <div className="text-xs text-gray-400">
                {p.isMaster && <span className="px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-semibold">Master</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewPessoa && (
        <NewPessoaModal
          onClose={() => setShowNewPessoa(false)}
          onCreated={() => { /* lista atualiza via onSnapshot */ }}
        />
      )}
    </div>
  );
}

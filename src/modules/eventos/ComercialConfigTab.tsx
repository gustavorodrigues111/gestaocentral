import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { useRestaurant } from "../../core/restaurant/RestaurantContext";
import type { Pessoa, Restaurant } from "../../core/types";

type Props = {
  rid: string;
};

// Aba "Comercial" das configs de Eventos. Master define a lista de pessoas
// que podem aparecer nos pickers do fechamento de evento ("captado por",
// "negociado por", "acompanhado por"). Salvo em
// restaurants/{rid}.eventosConfig.pessoasComerciaisIds.
export function ComercialConfigTab({ rid }: Props) {
  const { pessoa: me } = useAuth();
  const { restaurants } = useRestaurant();
  const restaurant: Restaurant | null = restaurants.find(r => r.id === rid) || null;

  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [saving, setSaving] = useState(false);

  const selecionadosIds = restaurant?.eventosConfig?.pessoasComerciaisIds || [];

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "pessoas"),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa);
        const ativas = list.filter(p => p.ativa !== false);
        ativas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        setPessoas(ativas);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  const pessoasFiltradas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return pessoas;
    return pessoas.filter(p =>
      p.nome.toLowerCase().includes(f) ||
      (p.email || "").toLowerCase().includes(f),
    );
  }, [pessoas, filtro]);

  async function toggle(pessoaId: string) {
    if (!restaurant || saving) return;
    setSaving(true);
    try {
      const set = new Set(selecionadosIds);
      if (set.has(pessoaId)) set.delete(pessoaId);
      else set.add(pessoaId);
      await updateDoc(doc(db, "restaurants", rid), {
        "eventosConfig.pessoasComerciaisIds": Array.from(set),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!me?.isMaster) {
    return (
      <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-900 dark:text-amber-200">
        🔒 Só master pode editar a lista de pessoas comerciais.
      </div>
    );
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando pessoas...</div>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Pessoas comerciais</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Selecione quem pode aparecer nos pickers de fechamento de evento
          (quem captou, quem negociou, quem acompanhou). A lista alimenta o
          modal "Fechar evento" no Kanban.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar pessoa por nome ou e-mail..."
          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
        />
        <div className="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
          {selecionadosIds.length} selecionada(s)
        </div>
      </div>

      {pessoasFiltradas.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-gray-200 dark:border-gray-700 p-4 text-center text-sm text-gray-500 dark:text-gray-400">
          Nenhuma pessoa encontrada.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
          {pessoasFiltradas.map(p => {
            const checked = selecionadosIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                  checked ? "bg-indigo-50 dark:bg-indigo-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/30"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={saving}
                  onChange={() => toggle(p.id)}
                  className="accent-indigo-600 w-4 h-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {p.nome}
                  </div>
                  {p.email && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{p.email}</div>
                  )}
                </div>
                {p.isMaster && (
                  <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                    master
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

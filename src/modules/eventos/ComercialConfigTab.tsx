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
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

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

  const selecionados = useMemo(() => {
    const byId = new Map(pessoas.map(p => [p.id, p]));
    return selecionadosIds
      .map(id => byId.get(id))
      .filter((p): p is Pessoa => !!p);
  }, [pessoas, selecionadosIds]);

  async function add(pessoaId: string) {
    if (!restaurant || saving) return;
    if (selecionadosIds.includes(pessoaId)) return;
    setSaving(true);
    try {
      const novo = [...selecionadosIds, pessoaId];
      await updateDoc(doc(db, "restaurants", rid), {
        "eventosConfig.pessoasComerciaisIds": novo,
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove(pessoaId: string) {
    if (!restaurant || saving) return;
    setSaving(true);
    try {
      const novo = selecionadosIds.filter(id => id !== pessoaId);
      await updateDoc(doc(db, "restaurants", rid), {
        "eventosConfig.pessoasComerciaisIds": novo,
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

      {selecionados.length === 0 ? (
        <div className="rounded-xl bg-gray-50 dark:bg-gray-800/30 border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center">
          <div className="text-sm text-gray-600 dark:text-gray-300 font-medium">
            Nenhuma pessoa comercial cadastrada ainda.
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Clica em "+ Adicionar pessoa" pra montar o time comercial deste restaurante.
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800 bg-white dark:bg-gray-900">
          {selecionados.map(p => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-3 py-2"
            >
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-sm font-semibold shrink-0">
                {p.nome.charAt(0).toUpperCase()}
              </div>
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
              <button
                type="button"
                onClick={() => remove(p.id)}
                disabled={saving}
                className="text-xs px-2 py-1 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50 whitespace-nowrap"
              >
                ✕ Remover
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          + Adicionar pessoa
        </button>
      </div>

      {modalOpen && (
        <AdicionarPessoaModal
          pessoas={pessoas}
          jaSelecionadosIds={selecionadosIds}
          saving={saving}
          onPick={async (id) => {
            await add(id);
            setModalOpen(false);
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

function AdicionarPessoaModal({
  pessoas,
  jaSelecionadosIds,
  saving,
  onPick,
  onClose,
}: {
  pessoas: Pessoa[];
  jaSelecionadosIds: string[];
  saving: boolean;
  onPick: (id: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [filtro, setFiltro] = useState("");

  const disponiveis = useMemo(() => {
    const jaSet = new Set(jaSelecionadosIds);
    const f = filtro.trim().toLowerCase();
    return pessoas
      .filter(p => !jaSet.has(p.id))
      .filter(p => {
        if (!f) return true;
        return (
          p.nome.toLowerCase().includes(f) ||
          (p.email || "").toLowerCase().includes(f)
        );
      });
  }, [pessoas, jaSelecionadosIds, filtro]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl w-full max-w-lg flex flex-col max-h-[85vh] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            Adicionar pessoa comercial
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Escolha uma pessoa pra incluir no time comercial. Clica no nome pra adicionar.
          </p>
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
            autoFocus
            className="w-full mt-3 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {disponiveis.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {filtro
                ? "Nenhuma pessoa encontrada com esse filtro."
                : "Todas as pessoas ativas já estão no time comercial."}
            </div>
          ) : (
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {disponiveis.map(p => (
                <button
                  key={p.id}
                  type="button"
                  disabled={saving}
                  onClick={() => onPick(p.id)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-50 transition-colors"
                >
                  <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex items-center justify-center text-sm font-semibold shrink-0">
                    {p.nome.charAt(0).toUpperCase()}
                  </div>
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
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

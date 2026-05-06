import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { canConfigurar } from "../../core/auth/permissions";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import { NewPessoaModal } from "./NewPessoaModal";
import type { Pessoa } from "../../core/types";

type Props = { restaurantId: string };

export function PessoasList({ restaurantId }: Props) {
  const { pessoa: me } = useAuth();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showNewPessoa, setShowNewPessoa] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<"ativas" | "inativas" | "todas">("ativas");
  const podeConfig = canConfigurar(me, restaurantId, "pessoas");

  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    const q = query(collection(db, "pessoas"), where("restaurantIds", "array-contains", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Pessoa);
      setPessoas(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  const filtered = pessoas.filter(p => {
    const isAtiva = p.ativa !== false;
    if (filtroStatus === "ativas"  && !isAtiva) return false;
    if (filtroStatus === "inativas" && isAtiva) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (p.nome || "").toLowerCase().includes(s)
        || (p.email || "").toLowerCase().includes(s);
  }).sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} pessoa(s)
        </p>
        {podeConfig && (
          <Button onClick={() => setShowNewPessoa(true)}>+ Nova pessoa</Button>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por nome ou email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
      />

      <div className="flex items-center gap-2 mb-4">
        {(["ativas", "inativas", "todas"] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltroStatus(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtroStatus === f
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            {f === "ativas" ? "✓ Ativas" : f === "inativas" ? "○ Inativas" : "Todas"}
          </button>
        ))}
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4 text-xs text-amber-800 dark:text-amber-300">
        🚧 <strong>Refator em andamento.</strong> Fase 2 vai trazer: filtro Equipe/Não-equipe,
        edição com abas (Identidade · Vínculos · Permissões), criação de empregados.
      </div>

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
              className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""} ${p.ativa === false ? "opacity-60" : ""}`}
            >
              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-semibold">
                {(p.nome || "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {p.nome}
                  {p.ativa === false && <span className="ml-2 text-xs text-gray-400">(inativa)</span>}
                </div>
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

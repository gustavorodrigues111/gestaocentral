import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Cliente, Reserva } from "../../core/types";
import { ClienteModal } from "./ClienteModal";
import { ClienteHistoricoModal } from "./ClienteHistoricoModal";

type Props = {
  restaurantId: string;
  podeConfig: boolean;
};

export function ClientesTab({ restaurantId, podeConfig }: Props) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [reservas, setReservas] = useState<Reserva[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filtroTag, setFiltroTag] = useState<string>("");
  const [editing, setEditing] = useState<Cliente | "new" | null>(null);
  const [verHistorico, setVerHistorico] = useState<Cliente | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, "clientes"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Cliente);
      list.sort((a, b) => a.nome.localeCompare(b.nome));
      setClientes(list);
      setLoading(false);
    });
    return () => unsub();
  }, [restaurantId]);

  useEffect(() => {
    const q = query(collection(db, "reservas"), where("restaurantId", "==", restaurantId));
    const unsub = onSnapshot(q, (snap) => {
      setReservas(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Reserva));
    });
    return () => unsub();
  }, [restaurantId]);

  // Recalcula stats por cliente baseado nas reservas (caso o snapshot tenha defasado)
  const statsPorCliente = useMemo(() => {
    const m: Record<string, { total: number; compareceu: number; noShow: number; ultima: string | null }> = {};
    for (const r of reservas) {
      if (!r.clienteId) continue;
      if (!m[r.clienteId]) m[r.clienteId] = { total: 0, compareceu: 0, noShow: 0, ultima: null };
      m[r.clienteId].total++;
      if (r.status === "chegou") {
        m[r.clienteId].compareceu++;
        if (!m[r.clienteId].ultima || r.data > m[r.clienteId].ultima!) {
          m[r.clienteId].ultima = r.data;
        }
      } else if (r.status === "no_show") {
        m[r.clienteId].noShow++;
      }
    }
    return m;
  }, [reservas]);

  // Tags disponíveis (todas as únicas)
  const tagsDisponiveis = useMemo(() => {
    const s = new Set<string>();
    clientes.forEach(c => (c.tags || []).forEach(t => s.add(t)));
    return Array.from(s).sort();
  }, [clientes]);

  const filtered = useMemo(() => {
    return clientes.filter(c => {
      if (filtroTag && !(c.tags || []).includes(filtroTag)) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        if (
          !c.nome.toLowerCase().includes(s) &&
          !(c.telefone || "").toLowerCase().includes(s) &&
          !(c.email || "").toLowerCase().includes(s)
        ) return false;
      }
      return true;
    });
  }, [clientes, search, filtroTag]);

  async function excluir(c: Cliente) {
    if (!confirm(`Excluir cliente "${c.nome}"?\n\nReservas antigas dele preservam o nome em snapshot.`)) return;
    await deleteDoc(doc(db, "clientes", c.id));
  }

  if (loading) return <div className="text-sm text-gray-500">Carregando...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {clientes.length} cliente(s) cadastrado(s)
        </div>
        {podeConfig && (
          <Button onClick={() => setEditing("new")}>+ Novo cliente</Button>
        )}
      </div>

      <Input
        placeholder="🔍 Buscar por nome, telefone, email..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {tagsDisponiveis.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Tags:</span>
          <button
            type="button"
            onClick={() => setFiltroTag("")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              !filtroTag
                ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
            }`}
          >
            Todas
          </button>
          {tagsDisponiveis.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setFiltroTag(t === filtroTag ? "" : t)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filtroTag === t
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              🏷️ {t}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="text-gray-700 dark:text-gray-300 font-medium">
            {search || filtroTag ? "Nenhum cliente encontrado" : "Sem clientes"}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(c => {
            const stats = statsPorCliente[c.id];
            const compareceu = stats?.compareceu ?? c.totalCompareceu ?? 0;
            const noShow = stats?.noShow ?? c.totalNoShow ?? 0;
            const ultima = stats?.ultima ?? c.ultimaVisita;
            const total = compareceu + noShow + (stats?.total || c.totalReservas || 0) - compareceu - noShow;
            // Aniversário hoje?
            let aniversarioHoje = false;
            if (c.aniversario) {
              const hoje = new Date();
              const mm = String(hoje.getMonth() + 1).padStart(2, "0");
              const dd = String(hoje.getDate()).padStart(2, "0");
              const aniv = c.aniversario.length === 5 ? c.aniversario : c.aniversario.slice(5); // pega MM-DD
              aniversarioHoje = aniv === `${mm}-${dd}`;
            }
            return (
              <div
                key={c.id}
                className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-gray-900 dark:text-gray-100">{c.nome}</h3>
                      {aniversarioHoje && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300">
                          🎂 Hoje!
                        </span>
                      )}
                      {(c.tags || []).map(t => (
                        <span key={t} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                          {t}
                        </span>
                      ))}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {c.telefone && <span>📞 {c.telefone}</span>}
                      {c.email && <span>✉️ {c.email}</span>}
                      {c.aniversario && (
                        <span>🎂 {c.aniversario.length === 5 ? c.aniversario.split("-").reverse().join("/") : new Date(c.aniversario + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                      )}
                    </div>
                    {c.restricoesAlimentares && (
                      <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                        ⚠ {c.restricoesAlimentares}
                      </div>
                    )}
                    {c.observacoes && (
                      <div className="text-xs text-gray-700 dark:text-gray-300 mt-0.5 italic">{c.observacoes}</div>
                    )}
                    {/* Stats */}
                    <div className="text-[11px] text-gray-500 mt-1.5 flex gap-3 flex-wrap">
                      {compareceu > 0 && <span>🪑 {compareceu} visita(s)</span>}
                      {total > 0 && <span>📅 {total} reserva(s)</span>}
                      {noShow > 0 && <span className="text-rose-600">😶 {noShow} no-show</span>}
                      {ultima && <span>· última: {new Date(ultima + "T12:00:00").toLocaleDateString("pt-BR")}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    <Button variant="secondary" size="sm" onClick={() => setVerHistorico(c)}>📊 Histórico</Button>
                    {podeConfig && (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>Editar</Button>
                        <Button variant="danger" size="sm" onClick={() => excluir(c)}>×</Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ClienteModal
          cliente={editing === "new" ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}
      {verHistorico && (
        <ClienteHistoricoModal
          cliente={verHistorico}
          reservas={reservas.filter(r => r.clienteId === verHistorico.id)}
          onClose={() => setVerHistorico(null)}
        />
      )}
    </div>
  );
}

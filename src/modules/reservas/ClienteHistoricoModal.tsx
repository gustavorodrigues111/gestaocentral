// Histórico do cliente — dois modos:
//   "recente"  — últimos 6 meses (compacto). Aberto pelo card da reserva
//                no fluxo operacional. Tem link "Ver histórico completo →"
//                que troca pro modo "completo".
//   "completo" — tudo desde sempre, com estatísticas. Aberto pelo card
//                do cliente (aba Clientes / CRM).
//
// Mostra duas seções: reservas (cronológico decrescente) + log de notas
// (cronológico decrescente).

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { useAuth } from "../../core/auth/AuthContext";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { RESERVA_STATUS_ICON, RESERVA_STATUS_LABEL } from "../../core/types";
import type { Cliente, NotaCliente, Reserva, ReservaStatus } from "../../core/types";
import { criarNotaCliente, deletarNotaCliente, ordenarNotasDesc } from "./notasCliente";

type Props = {
  cliente: Cliente;
  reservas: Reserva[];                  // todas as reservas do cliente
  mode?: "recente" | "completo";        // default "completo"
  onClose: () => void;
};

const STATUS_CLS: Record<ReservaStatus, string> = {
  pendente:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  confirmada: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  chegou:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  no_show:    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  cancelada:  "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// Limite usado no modo "recente"
const MESES_RECENTE = 6;

export function ClienteHistoricoModal({ cliente, reservas, mode = "completo", onClose }: Props) {
  const { pessoa: me } = useAuth();
  const [modo, setModo] = useState<"recente" | "completo">(mode);

  // ─── Notas do cliente (listener) ─────────────────────────────────────
  const [notas, setNotas] = useState<NotaCliente[]>([]);
  useEffect(() => {
    const q = query(collection(db, "notasCliente"), where("clienteId", "==", cliente.id));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }) as NotaCliente);
      setNotas(ordenarNotasDesc(list));
    });
    return () => unsub();
  }, [cliente.id]);

  // ─── Filtro de janela (recente = 6 meses) ────────────────────────────
  const dataLimite = useMemo(() => {
    if (modo === "completo") return null;
    const d = new Date();
    d.setMonth(d.getMonth() - MESES_RECENTE);
    return d.toISOString().slice(0, 10);
  }, [modo]);

  const reservasFiltradas = useMemo(() => {
    const ordenadas = [...reservas].sort((a, b) => {
      const ad = `${a.data} ${a.horario}`;
      const bd = `${b.data} ${b.horario}`;
      return bd.localeCompare(ad);
    });
    if (!dataLimite) return ordenadas;
    return ordenadas.filter(r => r.data >= dataLimite);
  }, [reservas, dataLimite]);

  const notasFiltradas = useMemo(() => {
    if (!dataLimite) return notas;
    return notas.filter(n => n.criadoEm.slice(0, 10) >= dataLimite);
  }, [notas, dataLimite]);

  // ─── Estatísticas (sempre sobre TODAS as reservas, não filtradas) ────
  const stats = useMemo(() => {
    const total = reservas.length;
    const compareceu = reservas.filter(r => r.status === "chegou").length;
    const noShow = reservas.filter(r => r.status === "no_show").length;
    const cancelada = reservas.filter(r => r.status === "cancelada").length;
    const upcoming = reservas.filter(r => r.status === "pendente" || r.status === "confirmada").length;
    return { total, compareceu, noShow, cancelada, upcoming };
  }, [reservas]);

  const taxaPresenca = (stats.compareceu + stats.noShow) > 0
    ? Math.round((stats.compareceu / (stats.compareceu + stats.noShow)) * 100)
    : null;

  // ─── Adicionar nota inline ────────────────────────────────────────────
  const [novaNota, setNovaNota] = useState("");
  const [salvandoNota, setSalvandoNota] = useState(false);

  async function adicionarNota() {
    if (!me || !novaNota.trim()) return;
    setSalvandoNota(true);
    try {
      await criarNotaCliente({
        restaurantId: cliente.restaurantId,
        clienteId: cliente.id,
        texto: novaNota,
        criadoPor: me.id,
        criadoPorNome: me.nome,
      });
      setNovaNota("");
    } catch (e) {
      console.error("[nota] criar falhou:", e);
      alert("Erro ao salvar nota.");
    } finally {
      setSalvandoNota(false);
    }
  }

  async function removerNota(n: NotaCliente) {
    if (!confirm(`Apagar essa nota?\n\n"${n.texto}"`)) return;
    try {
      await deletarNotaCliente(n.id);
    } catch (e) {
      console.error("[nota] delete falhou:", e);
      alert("Erro ao apagar.");
    }
  }

  const labelHeader = modo === "recente"
    ? `Últimos ${MESES_RECENTE} meses`
    : `Tudo (${stats.total} reservas)`;

  return (
    <Modal title={`📊 Histórico — ${cliente.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Header com toggle modo */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {labelHeader}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setModo("recente")}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                modo === "recente"
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              Recente
            </button>
            <button
              type="button"
              onClick={() => setModo("completo")}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                modo === "completo"
                  ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200"
              }`}
            >
              Completo
            </button>
          </div>
        </div>

        {/* Stats (sempre globais) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">Total</div>
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Visitou</div>
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{stats.compareceu}</div>
          </div>
          <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg p-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-rose-700 dark:text-rose-400">No-show</div>
            <div className="text-xl font-bold text-rose-700 dark:text-rose-400">{stats.noShow}</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 text-center">
            <div className="text-[10px] uppercase tracking-wider text-blue-700 dark:text-blue-400">Próximas</div>
            <div className="text-xl font-bold text-blue-700 dark:text-blue-400">{stats.upcoming}</div>
          </div>
        </div>

        {taxaPresenca !== null && (
          <div className={`rounded-lg p-3 text-sm text-center ${
            taxaPresenca >= 80 ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300"
            : taxaPresenca >= 50 ? "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300"
            : "bg-rose-50 dark:bg-rose-900/20 text-rose-800 dark:text-rose-300"
          }`}>
            Taxa de presença: <strong>{taxaPresenca}%</strong>
            {taxaPresenca < 50 && " — atenção a esse cliente!"}
          </div>
        )}

        {/* Reservas */}
        <div>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2">
            📅 Reservas ({reservasFiltradas.length})
          </h3>
          {reservasFiltradas.length === 0 ? (
            <div className="text-sm text-gray-500 italic">
              {modo === "recente" ? "Sem reservas nos últimos 6 meses." : "Nenhuma reserva ainda."}
            </div>
          ) : (
            <div className="space-y-1 max-h-[260px] overflow-y-auto">
              {reservasFiltradas.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">
                      📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")} · ⏰ {r.horario} · 👥 {r.pessoas}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {r.salaoNomeSnapshot && <>🏛️ {r.salaoNomeSnapshot}</>}
                      {r.mesaNomeSnapshot && <> · 🪑 {r.mesaNomeSnapshot}</>}
                      {r.ocasiao && <> · 🎉 {r.ocasiao}</>}
                      {r.observacoes && <> · 📝 {r.observacoes}</>}
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded whitespace-nowrap ${STATUS_CLS[r.status]}`}>
                    {RESERVA_STATUS_ICON[r.status]} {RESERVA_STATUS_LABEL[r.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notas — log cronológico */}
        <div>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2">
            📝 Notas ({notasFiltradas.length})
          </h3>
          <div className="space-y-1 max-h-[200px] overflow-y-auto mb-2">
            {notasFiltradas.length === 0 ? (
              <div className="text-sm text-gray-500 italic">
                {modo === "recente" ? "Sem notas nos últimos 6 meses." : "Nenhuma nota ainda."}
              </div>
            ) : (
              notasFiltradas.map(n => (
                <div
                  key={n.id}
                  className="px-3 py-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm group"
                >
                  <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
                    {n.texto}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500 mt-1">
                    <span>
                      {new Date(n.criadoEm).toLocaleDateString("pt-BR")} · {n.criadoPorNome}
                    </span>
                    <button
                      type="button"
                      onClick={() => removerNota(n)}
                      className="opacity-0 group-hover:opacity-100 hover:text-rose-600 transition-opacity"
                      title="Apagar nota"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Adicionar nota inline */}
          <div className="flex gap-2">
            <input
              value={novaNota}
              onChange={(e) => setNovaNota(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarNota(); } }}
              placeholder='+ Nova nota — ex: "gosta da mesa do canto"'
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={adicionarNota}
              disabled={salvandoNota || !novaNota.trim()}
            >
              {salvandoNota ? "..." : "Adicionar"}
            </Button>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

import { useMemo } from "react";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";
import { RESERVA_STATUS_ICON, RESERVA_STATUS_LABEL } from "../../core/types";
import type { Cliente, Reserva, ReservaStatus } from "../../core/types";

type Props = {
  cliente: Cliente;
  reservas: Reserva[];
  onClose: () => void;
};

const STATUS_CLS: Record<ReservaStatus, string> = {
  pendente:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  confirmada: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  chegou:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  no_show:    "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  cancelada:  "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export function ClienteHistoricoModal({ cliente, reservas, onClose }: Props) {
  const ordenadas = useMemo(() => {
    return [...reservas].sort((a, b) => {
      const ad = `${a.data} ${a.horario}`;
      const bd = `${b.data} ${b.horario}`;
      return bd.localeCompare(ad);
    });
  }, [reservas]);

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

  return (
    <Modal title={`📊 Histórico — ${cliente.nome}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Stats */}
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

        {/* Lista de reservas */}
        <div>
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-500 mb-2">
            Todas as reservas ({ordenadas.length})
          </h3>
          {ordenadas.length === 0 ? (
            <div className="text-sm text-gray-500 italic">Nenhuma reserva ainda.</div>
          ) : (
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {ordenadas.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-sm"
                >
                  <div className="flex-1">
                    <div className="font-medium">
                      📅 {new Date(r.data + "T12:00:00").toLocaleDateString("pt-BR")} · ⏰ {r.horario} · 👥 {r.pessoas}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {r.mesaNomeSnapshot && <>🪑 {r.mesaNomeSnapshot}</>}
                      {r.ocasiao && <> · {r.ocasiao}</>}
                      {r.observacoes && <> · {r.observacoes}</>}
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

        <div className="flex justify-end pt-3 border-t border-gray-200 dark:border-gray-800">
          <Button variant="secondary" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

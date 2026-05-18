import { useMemo, useState } from "react";
import { deleteDoc, doc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import type { Empregado, FreelaShift, Pessoa } from "../../core/types";
import { todayYmd } from "../../core/utils/date";
import { AgendarFreelaModal } from "./AgendarFreelaModal";
import { fmtBR } from "./helpers";

type Props = {
  restaurantId: string;
  shifts: FreelaShift[];
  empregados: Empregado[];
  pessoas: Pessoa[];
  podeEditar: boolean;
};

export function AgendarTab({ restaurantId, shifts, empregados, pessoas, podeEditar }: Props) {
  const [showModal, setShowModal] = useState(false);

  // Só turnos com status "agendado" e data >= hoje
  const hoje = todayYmd();
  const agendados = useMemo(
    () => shifts
      .filter((s) => s.status === "agendado" && s.date >= hoje)
      .sort((a, b) => a.date.localeCompare(b.date) || a.nomeSnapshot.localeCompare(b.nomeSnapshot)),
    [shifts, hoje],
  );

  // Agrupa por data
  const porData = useMemo(() => {
    const m = new Map<string, FreelaShift[]>();
    for (const s of agendados) {
      const arr = m.get(s.date) || [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return Array.from(m.entries());
  }, [agendados]);

  async function cancelar(s: FreelaShift) {
    if (!confirm(`Cancelar agendamento de ${s.nomeSnapshot} em ${s.date}?`)) return;
    await deleteDoc(doc(db, "freelaShifts", s.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {agendados.length === 0
            ? "Nenhum freela agendado pra frente."
            : `${agendados.length} turno(s) agendado(s) pra frente.`}
        </div>
        {podeEditar && (
          <Button size="sm" onClick={() => setShowModal(true)}>+ Agendar turno</Button>
        )}
      </div>

      {porData.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
          Nada agendado. Clique em <strong>+ Agendar turno</strong> pra planejar um freela.
        </div>
      ) : (
        <div className="space-y-4">
          {porData.map(([date, list]) => (
            <div key={date} className="rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 text-xs font-semibold text-gray-700 dark:text-gray-300">
                {formatDataBR(date)}
              </div>
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {list.map((s) => (
                  <div key={s.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-800 dark:text-gray-100 truncate">
                        {s.nomeSnapshot}
                        {s.empregadoId && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">
                            Empregado
                          </span>
                        )}
                      </div>
                      {(s.area || s.observacao) && (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {s.area && <span className="mr-2">{s.area}</span>}
                          {s.observacao && <span className="italic">"{s.observacao}"</span>}
                        </div>
                      )}
                    </div>
                    {s.valorUnit ? (
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        {fmtBR(s.valorUnit)}/{s.valorTipo === "diaria" ? "dia" : "h"}
                      </div>
                    ) : null}
                    {podeEditar && (
                      <button
                        type="button"
                        onClick={() => cancelar(s)}
                        className="text-[11px] text-red-600 dark:text-red-400 hover:underline"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AgendarFreelaModal
          restaurantId={restaurantId}
          empregados={empregados}
          pessoas={pessoas}
          onClose={() => setShowModal(false)}
          onSaved={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

function formatDataBR(ymd: string): string {
  const [a, m, d] = ymd.split("-");
  const date = new Date(parseInt(a, 10), parseInt(m, 10) - 1, parseInt(d, 10));
  return date.toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long",
  });
}
